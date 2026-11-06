# 04_memory.py
# -----------
# 04 단계: LangGraph 상태 축적(Reducer) 및 스레드 격리 메모리 실습
#
# 여러 명의 유저가 동일 시스템을 사용할 때 대화가 뒤섞이지 않고 격리(Thread Isolation)되는 방식과
# 새로운 대화 메시지가 들어올 때 덮어쓰지 않고 추가로 이어지는 Reducer 개념(`add_messages`)을 이해하는 실습입니다.

from typing import Annotated
from typing_extensions import TypedDict
import os
import sys
from dotenv import load_dotenv
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages  # 메시지를 덮어쓰지 않고 이력으로 누적해 주는 Reducer 유틸
from langgraph.checkpoint.memory import MemorySaver
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

# .env 파일(GOOGLE_API_KEY 등)을 상위 폴더까지 탐색하여 환경변수로 로드
load_dotenv()

# Windows 터미널에서 한글 및 이모지 출력 시 인코딩 오류(UnicodeEncodeError) 방지
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

# [1단계] Reducer가 포함된 대화 상태 구조(TypedDict) 정의
# - `Annotated[list, add_messages]`를 선언해 두면,
#   이후 노드가 `{"messages": [신규메시지]}`를 리턴할 때, 기존 메시지 목록 맨 뒤에 차곡차곡 누적 추가됩니다.
class MessageState(TypedDict):
    messages: Annotated[list, add_messages]

def run_conversational_agent():
    # .env(또는 시스템 환경변수)에서 구글 제미나이 API 키를 읽음 (코드에 키를 직접 넣지 않음)
    GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not GOOGLE_API_KEY:
        # 키가 없으면 API 호출 전에 즉시 중단 (fail-closed)
        print("[오류]: GOOGLE_API_KEY가 설정되지 않았습니다. .env에 GOOGLE_API_KEY=... 를 추가하세요.")
        return

    # [2단계] LLM 모델 생성
    model = ChatGoogleGenerativeAI(
        model="gemini-flash-lite-latest",  # 원래 "gemini-2.5-flash" — 새 사용자에게 제공 중단(404)되어 변경
        google_api_key=GOOGLE_API_KEY,
        temperature=0.7
    )

    # 대화에 개입할 시스템 지침 프롬프트 정의
    prompt = ChatPromptTemplate.from_messages([
        ("system", "당신은 대화 상대방의 이름을 반드시 기억하고 다정하고 상냥하게 대답하는 챗봇 비서입니다."),
        MessagesPlaceholder(variable_name="messages")
    ])

    # [3단계] 입력된 대화 이력을 받아 프롬프트와 모델을 엮어 실행하는 노드 구현
    def call_model(state: MessageState):
        chain = prompt | model
        response = chain.invoke({"messages": state["messages"]})
        # 생성된 AI 답변을 리스트 형태로 래핑하여 리턴하면, add_messages에 의해 누적됩니다.
        return {"messages": [response]}

    # [4단계] 스레드 히스토리를 저장하기 위한 MemorySaver 선언
    memory = MemorySaver()

    # [5단계] 그래프 조립 및 컴파일
    workflow = StateGraph(MessageState)
    workflow.add_node("chatbot", call_model)
    workflow.add_edge(START, "chatbot")
    workflow.add_edge("chatbot", END)

    app = workflow.compile(checkpointer=memory)

    # [6단계] 멀티턴 대화 및 스레드 격리성 검증
    # - config_user_a 와 config_user_b 라는 격리된 두 세션을 생성하여 테스트를 진행합니다.
    config_user_a = {"configurable": {"thread_id": "user_a_session"}}
    config_user_b = {"configurable": {"thread_id": "user_b_session"}}

    # (메모) 답변 출력은 원래 .content — 최신 Gemini의 블록 목록 형식 때문에 .text 로 텍스트만 출력
    # [테스트 1] 사용자 A가 자기 이름을 고백합니다.
    print("=== [사용자 A] 첫 번째 질문 ===")
    q1 = [("user", "안녕! 내 이름은 홍길동이야. 기억해 줘.")]
    print(f"질문 내용: {q1[0][1]}")
    try:
        res1 = app.invoke({"messages": q1}, config_user_a)
        print(f"AI 답변: {res1['messages'][-1].text}\n")
    except Exception as e:
        print(f"[오류]: {e}\n")
        return

    # [테스트 2] 사용자 B가 방금 저장된 이름이 무엇인지 질문합니다.
    print("=== [사용자 B] 첫 번째 질문 (격리 검증) ===")
    # 사용자 B의 스레드는 완전히 독립되어 있으므로 A의 정보를 절대 공유받지 못하는 것이 정상입니다.
    q2 = [("user", "안녕! 방금 내 이름을 말한 사람의 이름이 뭐야?")]
    print(f"질문 내용: {q2[0][1]}")
    try:
        res2 = app.invoke({"messages": q2}, config_user_b)
        print(f"AI 답변: {res2['messages'][-1].text}\n")
    except Exception as e:
        print(f"[오류]: {e}\n")

    # [테스트 3] 사용자 A가 본인의 이름을 재확인하는 2차 질문을 던집니다.
    print("=== [사용자 A] 두 번째 질문 (메모리 기억 검증) ===")
    # 동일한 thread_id로 다시 쿼리를 수행하므로, 체크포인터 메모리를 활용해 이름('홍길동')을 찾아냅니다.
    q3 = [("user", "내 이름이 뭔지 다시 말해봐.")]
    print(f"질문 내용: {q3[0][1]}")
    try:
        res3 = app.invoke({"messages": q3}, config_user_a)
        print(f"AI 답변: {res3['messages'][-1].text}\n")
    except Exception as e:
        print(f"[오류]: {e}\n")

if __name__ == "__main__":
    run_conversational_agent()
