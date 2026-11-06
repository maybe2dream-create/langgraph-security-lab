# dashboard_main.py
# -----------------
# 06 단계: 멀티 에이전트 시각화 대시보드의 백엔드(FastAPI)
#
# 전체 흐름
#   1) 프론트(React)가 편집기에서 그린 노드/엣지 JSON을 POST /api/flow/execute 로 보낸다.
#   2) 이 서버가 run_flow()에서 실습 모드(step0~4, free)에 따라 실행한다.
#      - step0~2 : 고정 시나리오 (노드를 키워드로 찾아 정해진 순서로 호출)
#      - step4/free : 그린 그래프를 LangGraph StateGraph로 조립해 실행
#   3) 노드 결과는 WebSocket(/ws/chat)으로 접속자 전원에게 실시간 전송된다.
#
# 실행: python dashboard_main.py  (http://127.0.0.1:8000)
# 키  : 프로젝트 루트 .env 의 GOOGLE_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY (또는 화면에서 입력한 키).
#       코드에 키를 넣지 않는다. DeepSeek·OpenAI를 쓰려면 pip install langchain-openai 가 필요하다.

import os
import sys
import json
import asyncio
import signal
import uuid
from typing import List, Dict, Any, Annotated, Sequence, Callable, Awaitable, TypedDict, Literal
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages  # 메시지를 덮어쓰지 않고 누적해 주는 Reducer
from langgraph.errors import GraphRecursionError  # 그래프가 최대 단계(recursion_limit)를 넘었을 때 발생
from langgraph.types import interrupt, Command  # HITL: interrupt()로 실행을 멈추고, Command(resume=...)로 이어서 실행
from langgraph.checkpoint.memory import MemorySaver  # 멈춘 지점의 상태를 저장(이어하기에 필요)

# .env(GOOGLE_API_KEY 등)를 상위 폴더까지 탐색해 환경변수로 로드
load_dotenv()

# Windows 터미널에서 한글 출력 시 인코딩 오류 방지
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

app = FastAPI(title="LangGraph Multi-Agent Meeting API")

# CORS: 브라우저는 다른 출처(포트 5173 → 8000) 요청을 기본 차단한다.
# 로컬 프론트(Vite 개발 서버)만 허용하고, 외부 출처는 허용하지 않는다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# [1] 요청 데이터 모델
# ──────────────────────────────────────────────
# 프론트가 보내는 요청 본문
#   nodes   : ReactFlow 노드 목록. 각 노드의 data에 label/provider/model_name/context가 있다.
#   edges   : 노드 연결선 목록 (source → target, 선택적 label은 조건부 분기 이름으로 사용)
#   mode    : 실습 모드 (step0, step1, step2, step4, free)
#   api_keys: 화면에서 입력한 키 {"gemini": "...", "deepseek": "...", "openai": "..."} (비우면 .env 사용)
#   max_calls: LLM 호출 횟수 상한(API 비용 제한). 에이전트 노드가 실행될 때마다 1회로 세며, 서버에서 1~50으로 제한한다.
#              사람 승인 노드는 LLM을 호출하지 않으므로 세지 않는다. (step0~2 고정 시나리오는 호출 수가 정해져 있어 적용되지 않음)
class GraphData(BaseModel):
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    mode: str = "free"
    api_keys: Dict[str, str] = {}
    max_calls: int = 10


# 사람 승인(HITL)에서 사용자가 보내는 결정
#   action  : approve(승인) / revise(수정 요청) / stop(중단)
#   feedback: 수정 요청일 때의 의견 (다음 노드의 입력으로 전달됨)
class Decision(BaseModel):
    action: Literal["approve", "revise", "stop"]
    feedback: str = ""


# 실행을 안전하게 끝내기 위한 내부 예외 (오류가 아니라 정상적인 중단 사유)
class CallLimitReached(Exception):
    """LLM 호출 횟수가 상한(max_calls)에 도달 — 상한을 넘는 호출은 하지 않고 중단한다."""
    def __init__(self, limit: int):
        super().__init__(f"max_calls={limit}")
        self.limit = limit


class UserStopped(Exception):
    """사람 승인 단계에서 사용자가 '중단'을 선택."""


class ApprovalTimeout(Exception):
    """사람 승인을 기다리다 제한 시간(10분)이 지남."""


HUMAN_LABEL = "__human__"   # 노드 이름이 이 값이면 '사람 승인' 노드 (LLM 대신 사람이 결정)
APPROVAL_TIMEOUT_SEC = 600  # 승인 대기 제한 시간


# ──────────────────────────────────────────────
# [2] LLM 호출부
# ──────────────────────────────────────────────
def get_llm(provider: str, model_name: str = None, api_key: str = None):
    """provider("gemini"/"openai"/"deepseek")에 맞는 LLM 객체를 만든다. 키는 인자 우선, 없으면 환경변수."""
    if provider.lower() == "deepseek":
        # DeepSeek API는 OpenAI와 호환되므로 ChatOpenAI에 주소(base_url)만 바꿔서 쓴다.
        # 모델: deepseek-chat(일반 대화) / deepseek-reasoner(추론, 느리고 비용이 더 든다)
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_name or "deepseek-chat",
            temperature=0.7,
            base_url="https://api.deepseek.com",
            api_key=api_key or os.getenv("DEEPSEEK_API_KEY")
        )
    elif provider.lower() == "openai":
        # OpenAI를 고를 때만 import한다. (langchain-openai가 없어도 서버는 시작된다)
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_name or "gpt-4o",
            temperature=0.7,  # 0에 가까울수록 일관된 답, 높을수록 다양한 답
            api_key=api_key or os.getenv("OPENAI_API_KEY")
        )
    elif provider.lower() == "gemini":
        actual_model = model_name or "gemini-2.5-flash"
        # 종료되었거나 오래된 모델 이름은 현재 모델로 바꿔 쓴다.
        # (주의: 사용자가 고른 모델과 실제 실행 모델이 다를 수 있다)
        if actual_model in ["gemini-1.5-pro", "gemini-1.5-pro-latest", "gemini-1.5-flash", "gemini-pro"]:
            actual_model = "gemini-2.5-flash"
        # (추가) gemini-2.5-* 는 새 사용자에게 404(no longer available to new users)라 현재 응답하는 모델로 바꾼다.
        if actual_model in ["gemini-2.5-flash", "gemini-2.5-pro"]:
            actual_model = "gemini-flash-lite-latest"
        return ChatGoogleGenerativeAI(
            model=actual_model,
            temperature=0.7,
            google_api_key=api_key or os.getenv("GOOGLE_API_KEY")
        )
    else:
        raise ValueError(f"지원하지 않는 플랫폼 제공자입니다: {provider}")


def execute_agent(role: str, provider: str, model_name: str, context: str, user_input: str, api_key: str = None):
    """역할(role) 하나가 LLM을 1회 호출하고 답변 문자열을 돌려주는 공통 함수.

    - role   : 노드 이름(예: "기획자 (PM)"). 시스템 프롬프트에 역할로 들어간다.
    - context: 노드에 입력한 추가 지침(시스템 프롬프트 뒤에 이어 붙는다).
    - 키가 없으면 가짜 응답 없이 오류 문장을 돌려준다.
    - 예외 발생 시에도 raise하지 않고 "Error executing ..." 문자열로 돌려준다.
      (그래서 호출하는 쪽은 이 접두사로 실패를 판단한다. step4 종료 조건 참고)
    """
    # 키 우선순위: 화면에서 받은 키 > .env/환경변수
    actual_api_key = str(api_key).strip() if api_key else ""
    if not actual_api_key:
        env_name = {"openai": "OPENAI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}.get(provider.lower(), "GOOGLE_API_KEY")
        actual_api_key = os.getenv(env_name, "").strip()
        if not actual_api_key:
            # 키가 없으면 API 호출 전에 명확한 오류로 중단 (fail-closed)
            return f"Error executing {provider}: API 키가 없습니다. .env에 {env_name}을 설정하거나 화면에서 키를 입력하세요."
    try:
        llm = get_llm(provider, model_name, actual_api_key)
        messages = [
            SystemMessage(content=f"You are a helpful assistant acting as a {role} in a meeting. {context}"),
            HumanMessage(content=user_input)
        ]
        response = llm.invoke(messages)  # 동기 호출: 비동기 코드에서는 run_in_executor로 감싸서 쓴다
        # (수정) 원래 response.content — 최신 Gemini는 content를 [텍스트, 서명] 블록 목록으로 돌려줘
        # 화면에 목록이 그대로 찍혔다. .text 는 텍스트 블록만 이어 붙인 문자열이다.
        return response.text
    except Exception as e:
        return f"Error executing {provider} API ({model_name or 'default'}): {str(e)}"


# ──────────────────────────────────────────────
# [3] LangGraph 동적 그래프 (step4 / free 모드)
# ──────────────────────────────────────────────
# 그래프 전체가 공유하는 상태
#   messages  : 대화 이력. add_messages 리듀서라서 노드가 반환한 메시지가 뒤에 "누적"된다.
#   loop_count: 노드가 실행될 때마다 +1. step4 핑퐁의 무한 반복을 막는 안전장치.
class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], add_messages]
    loop_count: int


def build_dynamic_graph(nodes_data: List[Dict], edges_data: List[Dict], mode: str = "free", api_keys: Dict[str, str] = None, max_calls: int = 10):
    """편집기의 노드/엣지 JSON을 LangGraph StateGraph로 변환해 compile한 앱을 돌려준다.

    - step4: 노드 "1"(PM)과 "2"(개발자)를 핑퐁으로 연결 (아래 router_decision이 종료 판단)
    - 그 외: 그린 엣지를 그대로 연결. 같은 노드에서 나가는 엣지가 여러 개이거나 label이 있으면
             조건부 분기(add_conditional_edges)로 만든다.
    - 라벨이 '__human__'인 노드는 사람 승인(HITL) 노드: interrupt()로 실행을 멈추고 사용자의 결정을 기다린다.
    - max_calls: 에이전트 노드를 이 횟수보다 많이 실행하지 않는다(초과 직전에 CallLimitReached로 중단).
    """
    workflow = StateGraph(AgentState)

    # 노드 함수 팩토리: 노드마다 자기 설정(node_info)을 기억하는 함수를 만들어 돌려준다.
    # (반복문 안에서 람다/함수를 만들면 마지막 값만 쓰이는 문제를 피하려고 함수로 한 번 감쌌다)
    def make_node_func(node_info: Dict):
        def node_func(state: AgentState):
            role = node_info.get("data", {}).get("label", "Agent")
            provider = node_info.get("data", {}).get("provider", "gemini")
            model_name = node_info.get("data", {}).get("model_name", None)
            context = node_info.get("data", {}).get("context", "")
            api_key = api_keys.get(provider.lower()) if api_keys else None
            # 직전 메시지를 입력으로 삼는다. 첫 노드는 이력이 없으므로 기본 문구로 시작한다.
            last_msg = state["messages"][-1].content if state["messages"] else "회의를 시작하겠습니다."
            current_count = state.get("loop_count", 0)
            # 비용 제한: 이번 호출이 상한을 넘게 되면 LLM을 부르기 전에 중단한다
            if current_count >= max_calls:
                raise CallLimitReached(max_calls)
            reply = execute_agent(role, provider, model_name, context, last_msg, api_key)
            return {
                "messages": [AIMessage(content=f"[{role}] {reply}")],  # 리스트로 반환 → 이력 맨 뒤에 추가
                "loop_count": current_count + 1
            }
        return node_func

    # 사람 승인(HITL) 노드 함수.
    # interrupt()를 만나면 그래프가 여기서 멈추고(상태는 체크포인터에 저장), 호출한 쪽에 질문(직전 답변)을 돌려준다.
    # 사용자가 결정하면 Command(resume=결정)으로 이어서 실행되고, 이때 interrupt()가 그 결정을 반환한다.
    # 주의: 재개되면 이 함수가 처음부터 다시 실행된다. 그래서 interrupt() 앞에는 비용이 드는 작업을 두지 않는다.
    def make_human_func(node_info: Dict):
        def human_func(state: AgentState):
            last_msg = state["messages"][-1].content if state["messages"] else ""
            decision = interrupt({"node_id": node_info["id"], "question": last_msg})
            action = decision.get("action")
            if action == "stop":
                raise UserStopped()
            feedback = str(decision.get("feedback", "")).strip()
            # 결정을 대화에 남긴다. 조건부 분기의 연결선 이름('승인'/'수정')이 이 문구에 들어 있어 길이 갈린다.
            text = "승인" if action == "approve" else f"수정 요청: {feedback or '(의견 없음)'}"
            return {"messages": [AIMessage(content=f"[사람] {text}")]}   # loop_count는 올리지 않는다(LLM 호출이 아님)
        return human_func

    # __start__/__end__ 라벨은 실제 노드가 아니라 시작·끝 표시이므로 그래프 노드로 등록하지 않는다.
    node_ids = []
    start_node_ids = []
    end_node_ids = []
    for node in nodes_data:
        label = node.get("data", {}).get("label", "")
        if label == "__start__":
            start_node_ids.append(node["id"])
        elif label == "__end__":
            end_node_ids.append(node["id"])
        else:
            node_ids.append(node["id"])
            workflow.add_node(node["id"], make_human_func(node) if label == HUMAN_LABEL else make_node_func(node))

    if mode == "step4" and "1" in node_ids and "2" in node_ids:
        # ── step4: PM(1) → 개발자(2) → (조건) → PM(1) ... 핑퐁 루프 ──
        # 주의: 노드 ID "1", "2"를 PM/개발자로 가정한다. 편집기에서 노드를 지우고 새로 만들면
        #       ID가 달라져 이 분기에 들어오지 않고 아래 일반 경로로 처리된다.
        workflow.add_edge("1", "2")

        def router_decision(state: AgentState):
            # 종료 조건 3가지: ① 6회 도달 ② 호출 실패 ③ 개발자가 [승인] 표시를 남김
            if state.get("loop_count", 0) >= 6:
                return "end"
            last_msg = state["messages"][-1].content if state["messages"] else ""
            if "Error executing" in last_msg or "[승인]" in last_msg:
                return "end"
            return "continue"

        # 매핑: router_decision의 반환값 → 이동할 노드. "continue"면 PM(1)으로 되돌아가 루프가 된다.
        workflow.add_conditional_edges("2", router_decision, {"continue": "1", "end": END})
        workflow.set_entry_point("1")
    else:
        # ── free: 편집기에서 그린 그래프를 그대로 변환 ──
        # 출발 노드별로 나가는 엣지를 모아 둔다. {출발 노드 id: [엣지, ...]}
        outgoing_edges = {}
        for edge in edges_data:
            src = edge["source"]
            if src not in outgoing_edges:
                outgoing_edges[src] = []
            outgoing_edges[src].append(edge)

        # __start__ 노드가 있으면 그 노드에서 연결된 대상이 시작점이 된다.
        for sid in start_node_ids:
            for e in outgoing_edges.get(sid, []):
                tgt = e["target"]
                if tgt in end_node_ids: tgt = END
                workflow.add_edge(START, tgt)

        # __start__가 없으면 "들어오는 엣지가 없는 노드"를 시작점으로 추정한다. (모두 있으면 첫 노드)
        if not start_node_ids and node_ids:
            has_incoming = {edge["target"] for edge in edges_data}
            starts = [nid for nid in node_ids if nid not in has_incoming]
            workflow.set_entry_point(starts[0] if starts else node_ids[0])

        for nid in node_ids:
            out_edges = outgoing_edges.get(nid, [])
            if not out_edges:
                # 나가는 엣지가 없으면 그래프의 끝으로 연결
                workflow.add_edge(nid, END)
                continue
            has_labels = any(e.get("label") for e in out_edges)
            if len(out_edges) == 1 and not has_labels:
                # 단순 직선 연결
                target = out_edges[0]["target"]
                if target in end_node_ids: target = END
                workflow.add_edge(nid, target)
            else:
                # 조건부 분기: {엣지 라벨: 대상 노드} 매핑을 만든다. 라벨이 없으면 path_0, path_1 ... 로 대체
                mapping = {}
                for idx, e in enumerate(out_edges):
                    lbl = e.get("label") or f"path_{idx}"
                    tgt = e["target"]
                    if tgt in end_node_ids: tgt = END
                    mapping[lbl] = tgt

                def make_router(edge_mapping):
                    def router(state: AgentState):
                        # 직전 답변에 엣지 라벨 문구가 "포함"되어 있으면 그 경로로 간다.
                        # 주의: 부분 문자열 매칭이라 짧은 라벨은 아무 답변에나 걸릴 수 있고,
                        #       어디에도 안 맞으면 첫 번째 경로로 조용히 간다.
                        last_msg = state["messages"][-1].content.lower() if state["messages"] else ""
                        for label_str in edge_mapping.keys():
                            if label_str.lower() in last_msg:
                                return label_str
                        return list(edge_mapping.keys())[0]
                    return router

                workflow.add_conditional_edges(nid, make_router(mapping), mapping)
    # 체크포인터: 사람 승인으로 멈췄다가 이어서 실행하려면 멈춘 시점의 상태를 저장해 둬야 한다(메모리 저장, 서버 재시작 시 사라짐)
    return workflow.compile(checkpointer=MemorySaver())


# ──────────────────────────────────────────────
# [4] 모드별 실행
# ──────────────────────────────────────────────
async def run_flow(
    mode: str,
    node_data_map: Dict[str, Dict[str, Any]],   # {노드 id: label/provider/model_name/context}
    node_role_map: Dict[str, str],              # {노드 id: 화면에 표시할 역할 이름}
    edges: list,
    nodes: list,
    api_keys: Dict[str, str],
    send_callback: Callable[[Dict[str, Any]], Awaitable[None]],   # 결과를 WebSocket으로 보내는 함수
    max_calls: int = 10                                          # LLM 호출 상한 (동적 그래프에만 적용)
):
    """실습 모드에 따라 실행하고, 진행 상황을 send_callback으로 한 단계씩 전송한다.

    메시지 형식: {"type": "system"|"agent"|"error", "node_id": ..., "role": ..., "content": ...}
      - system: 안내 문구 / agent: 노드(역할)의 답변 / error: 서버 오류
    """
    loop = asyncio.get_running_loop()

    # 고정 시나리오에서 "프롬프트/모델/파서/PM/개발자" 같은 역할의 노드를 이름(키워드)으로 찾는다.
    # 못 찾으면 기본 ID를 쓴다. 그래서 노드 이름을 바꾸면 다른 노드가 선택될 수 있다.
    def find_node_by_keywords(keywords: list, default_id: str):
        for nid, ndata in node_data_map.items():
            role = str(ndata.get("role", "")).lower()
            label = str(ndata.get("label", "")).lower()
            if any(k in role or k in label for k in keywords):
                return nid, ndata
        return default_id, node_data_map.get(default_id, {})

    # execute_agent는 동기 함수(네트워크 대기)이므로, 그대로 부르면 서버 전체가 멈춘다.
    # run_in_executor로 별도 스레드에서 실행해 이벤트 루프(다른 요청/WebSocket)를 막지 않는다.
    if mode == "step0":
        # ── step0: PromptTemplate → ChatModel → StrOutputParser (LangChain 체인의 3단계) ──
        # LLM 호출은 2단계(ChatModel)에서 1번만 일어난다. 1·3단계는 설명을 보여 주는 연출이다.
        prompt_id, prompt_node = find_node_by_keywords(["prompt", "프롬프트"], "1")
        model_id, model_node = find_node_by_keywords(["model", "llm", "모델"], "2")
        parser_id, parser_node = find_node_by_keywords(["parser", "파서"], "3")
        topic = prompt_node.get("context", "").strip() or "랑체인(LangChain)과 랭그래프(LangGraph)"
        await send_callback({
            "type": "system",
            "content": f"[1단계: PromptTemplate] 입력 주제 '{topic}'에 맞춰 프롬프트를 구성합니다."
        })
        await asyncio.sleep(1.0)  # 화면에서 단계가 하나씩 보이도록 잠시 쉰다
        provider = model_node.get("provider", "gemini")
        model_name = model_node.get("model_name")
        api_key = api_keys.get(provider.lower()) if api_keys else None
        await send_callback({
            "type": "system",
            "content": f"[2단계: ChatModel] {provider.upper()} API 모델({model_name or 'default'})을 호출하여 답변 생성을 요청합니다..."
        })
        context_str = model_node.get("context", "").strip() or "당신은 어려운 IT 개념을 초등학생도 이해하기 쉽게 비유를 들어 설명해주는 친절한 선생님입니다."
        user_question = f"{topic}에 대해서 설명해주세요."
        reply = await loop.run_in_executor(
            None,
            execute_agent,
            model_node.get("label", "ChatModel"),
            provider,
            model_name,
            context_str,
            user_question,
            api_key
        )
        # ChatModel의 출력은 AIMessage 객체이므로 그 모양을 문자열로 흉내 내서 보여 준다.
        await send_callback({
            "type": "agent",
            "node_id": model_id,
            "role": model_node.get("label", "ChatModel"),
            "content": f"AIMessage(content=\"{reply}\")"
        })
        await asyncio.sleep(1.2)
        await send_callback({
            "type": "system",
            "content": "[3단계: StrOutputParser] AIMessage 객체로부터 content 필드만 깨끗하게 문자열로 파싱하여 최종 결과를 출력합니다."
        })
        await asyncio.sleep(0.8)
        # 파서 단계: 실제 파싱 호출 없이 reply(이미 문자열)를 그대로 전달한다.
        await send_callback({
            "type": "agent",
            "node_id": parser_id,
            "role": parser_node.get("label", "StrOutputParser"),
            "content": reply
        })
    elif mode == "step1":
        # ── step1: 에이전트(멘토) 1개에게 질문 1번 ──
        node_id, node_info_1 = find_node_by_keywords(["agent", "mentor", "에이전트", "멘토", "엔지니어"], "1")
        provider = node_info_1.get("provider", "gemini")
        model_name = node_info_1.get("model_name")
        # 노드의 context 칸이 "질문"으로 쓰인다. 비어 있으면 기본 질문을 사용한다.
        user_question = node_info_1.get("context", "").strip() or "파이썬에서 리스트 컴프리헨션을 쓸 때 가독성을 유지하는 규칙은 무엇인가요?"
        context = "당신은 파이썬 코딩 표준(PEP 8)을 엄격하게 준수하며, 가독성 높은 코드를 추천하는 멘토입니다."
        api_key = api_keys.get(provider.lower()) if api_keys else None
        await send_callback({
            "type": "system",
            "content": f"[{node_info_1.get('label', '엔지니어 멘토')}] 에이전트에게 멘토링 요청을 전송합니다: '{user_question}'"
        })
        reply = await loop.run_in_executor(
            None,
            execute_agent,
            node_info_1.get("label", "엔지니어 멘토"),
            provider,
            model_name,
            context,
            user_question,
            api_key
        )
        await send_callback({
            "type": "agent",
            "node_id": node_id,
            "role": node_info_1.get("label", "엔지니어 멘토"),
            "content": reply
        })
    elif mode == "step2":
        # ── step2: PM이 기획 초안 → 개발자가 그 초안을 검토 (순차 체이닝, LLM 2회) ──
        # 체이닝: 앞 단계의 출력(pm_reply)이 다음 단계의 입력(dev_question)이 된다.
        pm_id, node_info_1 = find_node_by_keywords(["pm", "planner", "기획"], "1")
        dev_id, node_info_2 = find_node_by_keywords(["dev", "developer", "개발", "리뷰"], "2")
        user_request = node_info_1.get("context", "").strip() or "바쁜 직장인들을 위한 맞춤형 식단 추천 및 정기 배송 서비스"
        await send_callback({
            "type": "system",
            "content": f"[1단계: {node_info_1.get('label', '기획자 (PM)')}] 기획안 초안 작성을 시작합니다: '{user_request}'"
        })
        provider1 = node_info_1.get("provider", "gemini")
        api_key1 = api_keys.get(provider1.lower()) if api_keys else None
        pm_context = "당신은 혁신적인 IT 서비스의 프로덕트 매니저(PM)입니다. 사용자 요청에 따른 독창적인 앱 기획안 초안을 작성하세요."
        pm_reply = await loop.run_in_executor(
            None,
            execute_agent,
            node_info_1.get("label", "기획자 (PM)"),
            provider1,
            node_info_1.get("model_name"),
            pm_context,
            user_request,
            api_key1
        )
        await send_callback({
            "type": "agent",
            "node_id": pm_id,
            "role": node_info_1.get("label", "기획자 (PM)"),
            "content": pm_reply
        })
        await asyncio.sleep(1.5)
        await send_callback({
            "type": "system",
            "content": f"[2단계: {node_info_2.get('label', '개발자 (리뷰어)')}] PM의 기획 초안을 전달받아 순차 체이닝(Chaining) 검토를 수행합니다..."
        })
        provider2 = node_info_2.get("provider", "gemini")
        api_key2 = api_keys.get(provider2.lower()) if api_keys else None
        dev_context = node_info_2.get("context", "").strip() or "당신은 풀스택 리드 개발자입니다. 주어진 앱 기획안의 기술적 실현 가능성(FE/BE 구조, DB, 예상 기술 스택)을 분석하고 한계점을 분석하세요."
        dev_question = f"이 기획안에 대해 기술 분석을 진행해줘:\n\n{pm_reply}"  # PM의 답변을 입력으로 전달
        dev_reply = await loop.run_in_executor(
            None,
            execute_agent,
            node_info_2.get("label", "개발자 (리뷰어)"),
            provider2,
            node_info_2.get("model_name"),
            dev_context,
            dev_question,
            api_key2
        )
        await send_callback({
            "type": "agent",
            "node_id": dev_id,
            "role": node_info_2["label"],
            "content": dev_reply
        })
    else:
        # ── step3~7 / free: LangGraph로 실행 ──
        # stream_mode="updates"는 노드가 하나 끝날 때마다 {노드 id: 그 노드가 반환한 상태 변경분}을 내보낸다.
        # recursion_limit: LangGraph의 최후 안전장치. 우리의 호출 상한(max_calls)이 먼저 작동하도록 여유를 둔다.
        # thread_id: 체크포인터가 이 실행의 상태를 구분하는 이름. 사람 승인 후 이어서 실행할 때 같은 값을 쓴다.
        app_graph = build_dynamic_graph(nodes, edges, mode, api_keys, max_calls)
        config = {"recursion_limit": max_calls * 2 + 10, "configurable": {"thread_id": uuid.uuid4().hex}}
        graph_input = {"messages": [], "loop_count": 0}
        approval_round = 0   # 사람 승인을 몇 번째로 요청하는지 (승인 카드에 '몇 번째 확인'으로 표시)
        while True:
            pending = None   # 사람 승인으로 멈췄다면 그 정보(질문)가 들어간다
            async for output in app_graph.astream(graph_input, stream_mode="updates", config=config):
                for node_id, state in output.items():
                    if node_id == "__interrupt__":
                        # interrupt()로 멈춘 것. state는 Interrupt 객체들의 튜플이다.
                        pending = state[0].value if state else {}
                        continue
                    # 노드가 예외로 끝나면 state가 None으로 올 수 있다(곧이어 예외가 전파되므로 건너뛴다)
                    if state and "messages" in state and state["messages"]:
                        last_msg = state["messages"][-1].content
                        role = node_role_map.get(node_id, "Agent")
                        await send_callback({
                            "type": "agent",
                            "node_id": node_id,
                            "role": role,
                            "content": last_msg
                        })
            if pending is None:
                break   # 끝까지 실행됨
            # 멈춤: 사용자에게 승인 카드를 보내고, 결정이 올 때까지 기다린 뒤 같은 상태에서 이어서 실행한다
            approval_round += 1
            decision = await wait_for_human(pending, send_callback, approval_round)
            graph_input = Command(resume=decision)


# 사람 승인 대기: 화면에 승인 카드를 보내고, /api/flow/resume 로 결정이 올 때까지 기다린다.
approval_future = None   # 대기 중인 결정(없으면 None). 한 번에 하나만 대기한다.


async def wait_for_human(pending: Dict[str, Any], send_callback, round_no: int = 1) -> Dict[str, Any]:
    global approval_future
    loop = asyncio.get_running_loop()
    approval_future = loop.create_future()
    await send_callback({
        "type": "approval",
        "node_id": pending.get("node_id"),
        "role": "사람 승인",
        "round": round_no,
        "question": pending.get("question", "")
    })
    try:
        return await asyncio.wait_for(approval_future, timeout=APPROVAL_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        raise ApprovalTimeout()
    finally:
        approval_future = None   # 중단(취소)되거나 끝나도 대기 상태를 남기지 않는다


# ──────────────────────────────────────────────
# [5] HTTP / WebSocket 엔드포인트
# ──────────────────────────────────────────────
# 서버 전역 상태 (메모리에만 있으므로 서버를 재시작하면 사라진다)
#   connected_clients  : 현재 WebSocket에 접속한 클라이언트 목록
#   active_meeting_task: 실행 중인 회의 태스크. 동시에 1개만 허용하며, 새 실행이 오면 기존 것을 취소한다.
#                        (접속자가 여러 명이면 서로의 실행을 취소할 수 있다 → 1인 로컬 사용 전제)
connected_clients = []
active_meeting_task = None


@app.get("/api/health")
async def health_check():
    """서버가 살아 있는지 확인 (프론트가 연결 상태를 점검할 때 사용)."""
    return {"status": "ok"}


# 주의: 인증이 없다. 127.0.0.1 바인딩 + CORS 제한에 의존하므로 외부에 공개하지 말 것.
@app.post("/api/server/stop")
async def stop_server():
    """서버를 종료한다. 응답을 먼저 돌려주기 위해 1초 뒤에 종료 신호(SIGTERM)를 보낸다."""
    async def shutdown():
        await asyncio.sleep(1)
        os.kill(os.getpid(), signal.SIGTERM)
    asyncio.create_task(shutdown())
    return {"status": "stopping", "message": "Server is shutting down..."}


@app.post("/api/flow/execute")
async def execute_flow(data: GraphData):
    """그래프 실행을 시작한다. 실행은 백그라운드 태스크로 돌고, 결과는 WebSocket으로 전달된다.

    이 요청의 응답은 "시작했다"는 확인일 뿐이며 LLM 결과는 포함되지 않는다.
    """
    global active_meeting_task
    # 이미 실행 중이면 취소하고 새로 시작 (겹쳐 실행되면 화면 메시지가 뒤섞인다)
    if active_meeting_task and not active_meeting_task.done():
        active_meeting_task.cancel()
        await asyncio.sleep(0.1)
    max_calls = max(1, min(50, data.max_calls))   # 화면 값이 이상해도 1~50으로 제한
    print(f"Received nodes: {len(data.nodes)}, edges: {len(data.edges)}, mode: {data.mode}, max_calls: {max_calls}")

    # 노드 목록을 id로 바로 찾을 수 있게 딕셔너리로 변환
    node_role_map = {}
    node_data_map = {}
    for node in data.nodes:
        node_id = node["id"]
        node_role_map[node_id] = "사람 승인" if node.get("data", {}).get("label") == HUMAN_LABEL else node.get("data", {}).get("label", "Agent")
        node_data_map[node_id] = {
            "label": node.get("data", {}).get("label", "Agent"),
            "provider": node.get("data", {}).get("provider", "gemini"),
            "model_name": node.get("data", {}).get("model_name", None),
            "context": node.get("data", {}).get("context", "")
        }

    # 접속한 모든 클라이언트에게 JSON 메시지를 전송한다.
    async def broadcast_json(data_obj: Dict[str, Any]):
        msg_str = json.dumps(data_obj, ensure_ascii=False)  # 한글이 \uXXXX로 바뀌지 않게
        # 순회 중 목록이 바뀔 수 있으므로 복사본으로 돌고, 전송 실패한 클라이언트는 제거
        for client in list(connected_clients):
            try:
                await client.send_text(msg_str)
            except Exception:
                if client in connected_clients:
                    connected_clients.remove(client)

    await asyncio.sleep(0.5)  # 프론트가 WebSocket을 연결할 시간을 잠깐 준다
    await broadcast_json({
        "type": "system",
        "content": f"다중 LLM 회의를 시작합니다. (실습 모드: {data.mode}, 호출 상한: {max_calls}회)"
    })

    async def run_meeting():
        try:
            await run_flow(
                mode=data.mode,
                node_data_map=node_data_map,
                node_role_map=node_role_map,
                edges=data.edges,
                nodes=data.nodes,
                api_keys=data.api_keys,
                send_callback=broadcast_json,
                max_calls=max_calls
            )
            await broadcast_json({
                "type": "system",
                "content": "시스템: 전체 시뮬레이션 및 회의 과정이 완전히 정상 종료되었습니다."
            })
        except asyncio.CancelledError:
            # /api/flow/stop 이나 새 실행이 task.cancel()을 호출하면 여기로 온다.
            await broadcast_json({
                "type": "system",
                "content": "시스템: 사용자가 강제로 회의를 중단시켰습니다."
            })
        except CallLimitReached as e:
            await broadcast_json({
                "type": "system",
                "content": f"시스템: LLM 호출 횟수 상한({e.limit}회)에 도달해 실행을 종료했습니다. 화면의 '최대 호출 횟수'에서 상한을 바꿀 수 있습니다."
            })
        except UserStopped:
            await broadcast_json({"type": "system", "content": "시스템: 사람 승인 단계에서 사용자가 실행을 중단했습니다."})
        except ApprovalTimeout:
            await broadcast_json({"type": "system", "content": "시스템: 사람 승인을 10분 동안 받지 못해 실행을 종료했습니다."})
        except GraphRecursionError:
            # 루프가 끝나지 않아 최대 단계(20)에 도달: 오류가 아니라 안전 종료로 안내한다
            await broadcast_json({
                "type": "system",
                "content": "시스템: 최대 반복 단계에 도달해 실행을 종료했습니다. 종료 조건(연결선 이름·판정 기준)을 확인하세요."
            })
        except Exception as e:
            # 주의: 예외 내용을 그대로 화면에 보낸다. 민감한 값이 섞이지 않는지 점검이 필요하다.
            await broadcast_json({
                "type": "error",
                "content": f"시스템 에러: {str(e)}"
            })

    active_meeting_task = asyncio.create_task(run_meeting())
    return {"status": "success", "message": "Flow execution started"}


@app.post("/api/flow/resume")
async def resume_flow(decision: Decision):
    """사람 승인 대기 중인 실행에 결정(승인/수정 요청/중단)을 전달해 이어서 실행하게 한다."""
    if approval_future is None or approval_future.done():
        raise HTTPException(status_code=409, detail="승인 대기 중인 실행이 없습니다.")
    approval_future.set_result(decision.model_dump())
    return {"status": "success"}


@app.post("/api/flow/stop")
async def stop_flow():
    """실행 중인 회의를 중단한다. (서버 종료가 아니라 현재 실행 태스크만 취소)"""
    global active_meeting_task
    if active_meeting_task and not active_meeting_task.done():
        active_meeting_task.cancel()
        return {"status": "success", "message": "Flow execution stopped"}
    return {"status": "ignored", "message": "No active flow running"}


@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    """실시간 결과 수신용 연결. 서버→클라이언트 방향 전송이 목적이라 클라이언트가 보낸 내용은 쓰지 않는다."""
    await websocket.accept()
    connected_clients.append(websocket)
    try:
        while True:
            # 연결이 살아 있는지 유지하려고 수신을 계속 대기한다. 끊기면 WebSocketDisconnect가 발생한다.
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


if __name__ == "__main__":
    # 127.0.0.1: 내 컴퓨터에서만 접속 가능 (0.0.0.0으로 바꾸면 같은 네트워크 전체에 열린다)
    # reload=True: 코드를 저장하면 서버가 자동 재시작 (개발용)
    uvicorn.run("dashboard_main:app", host="127.0.0.1", port=8000, reload=True)
