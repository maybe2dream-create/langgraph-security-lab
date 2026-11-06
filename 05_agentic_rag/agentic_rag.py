# agentic_rag.py
# =============================================================================
# 05 단계: 실무형 Agentic RAG (Adaptive + Corrective RAG)
# =============================================================================
#
# [목표]
#   질문 유형 분류 → 검색어 재작성 → 검색 → 문서별 관련성 판정 → (재검색 | 답변 | 안내)
#   를 LangGraph의 조건부 엣지와 순환(loop)으로 구현하고, 정확도를 직접 측정한다.
#
# [용어]
#   - RAG (Retrieval-Augmented Generation): 검색한 문서를 근거로 LLM이 답변하는 방식
#   - Adaptive RAG : 질문 유형에 따라 경로를 바꿈 (일상 대화는 검색 생략)
#   - Corrective RAG: 검색 결과를 점검하고, 부족하면 질문을 바꿔 다시 검색
#
# [실행 흐름도]   (구조도: agentic_rag.svg 참고)
#
#   START ─▶ router ─┬─ chat ─▶ general_chat ───────────────────────────────▶ END
#                    └─ rag  ─▶ rewrite_query ─▶ retrieve ─▶ grade_documents
#                                    ▲                              │
#                                    │ 관련 문서 없음 + 재시도 한도 이내
#                                    └──────────────────────────────┤
#                                         관련 문서 있음 ─▶ generate ─▶ END
#                                         한도 초과     ─▶ fallback ─▶ END
#
# [실무 요소 - 이 파일에 구현된 것]
#   1) 구조화 출력(Pydantic): 라우터·판정 응답을 스키마로 강제 → 응답 형식 오류 제거
#   2) 문서별 판정 + 재검색 루프: 관련 문서만 남기고, 없으면 질문을 바꿔 최대 MAX_RETRIES회 재검색
#   3) fallback: 끝까지 근거가 없으면 일반론으로 지어내지 않고 "정보 없음"을 안내
#   4) 출처 표시: 답변에 근거 문서의 출처를 붙임
#   5) 타임아웃·재시도: LLM 호출에 timeout, max_retries 설정
#   6) 평가: 질문과 기대 경로를 정해 두고 정확도를 측정
#
# [실무에서 추가로 필요한 것 - 이 파일에는 없음]
#   - 체크포인터 메모리(thread_id별 이력, 04단계 참고), 영속 벡터 DB(Chroma/pgvector 등)
#   - 트레이싱·모니터링(LangSmith 등), 답변 근거성 검증, router/grade용 경량 모델 분리
#
# [주의] router·grade도 LLM의 판단이므로 결과가 100% 확정적이지는 않다.
#        그래서 마지막에 질문셋으로 정확도를 측정해 직접 확인한다.
#
# [실행 준비]
#   - .env 에 GOOGLE_API_KEY=... 설정
#   - pip install langgraph langchain-google-genai langchain-community faiss-cpu python-dotenv

import os
import sys
from typing import TypedDict, List, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_community.vectorstores import FAISS  # 인메모리 벡터 DB (필요 패키지: faiss-cpu)
from langchain_google_genai import GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser  # LLM 응답(AIMessage)을 순수 문자열로 변환
from langgraph.graph import StateGraph, START, END

# -----------------------------------------------------------------------------
# [환경 설정]
# -----------------------------------------------------------------------------
# Windows 터미널은 기본 인코딩이 cp949 등인 경우가 많아 한글/이모지 출력 시
# UnicodeEncodeError가 발생할 수 있다. stdout을 UTF-8로 재설정하여 이를 방지한다.
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

# .env 파일(GOOGLE_API_KEY 등)을 상위 폴더까지 탐색하여 환경변수로 로드
load_dotenv()

# -----------------------------------------------------------------------------
# [설정값]
# -----------------------------------------------------------------------------
MAX_RETRIES = 2   # 관련 문서를 못 찾았을 때 질문을 바꿔 다시 검색하는 최대 횟수 (무한 루프 방지)
TOP_K = 3         # 한 번에 가져오는 문서 수 (아래 문서가 4건이므로 전체가 아닌 일부만 가져옴)
FALLBACK_MESSAGE = "죄송합니다. 문의하신 내용은 확인된 정보에 없습니다. 매장으로 직접 문의해 주세요."

# 검색 대상 문서: (출처 ID, 본문)  ※ 주차·예약 문서는 실습용 가상 데이터
DOCUMENTS = [
    ("store_info#hours", "이 프로젝트 피자 가게의 영업시간은 매일 오전 11시부터 오후 10시까지입니다."),
    ("store_info#menu", "대표 메뉴인 페퍼로니 피자의 가격은 18,000원이며, 치즈 추가는 2,000원입니다."),
    ("store_info#parking", "가게 앞 전용 주차장이 있으며, 방문 손님은 2시간까지 무료로 주차할 수 있습니다."),
    ("store_info#reservation", "예약은 전화로만 가능하며, 4인 이상 단체 손님은 하루 전까지 예약해 주셔야 합니다."),
]


# -----------------------------------------------------------------------------
# [구조화 출력 스키마] LLM 응답을 이 형식으로 강제한다. (Literal 에 없는 값은 허용되지 않음)
# -----------------------------------------------------------------------------
class Route(BaseModel):
    route: Literal["rag", "chat"] = Field(
        description="가게 정보(영업시간·메뉴·가격·주차·예약·배달 등) 질문이면 rag, 일상 대화·인사·일반 상식이면 chat"
    )


class Grade(BaseModel):
    relevant: Literal["yes", "no"] = Field(
        description="문서에 질문의 답이 되는 정보가 있으면 yes, 없으면 no"
    )


# =============================================================================
# [1단계] 그래프 공유 상태(State) 정의
# =============================================================================
# 각 노드는 "자기가 바꾼 키만" 반환한다. 리듀서가 없는 키는 덮어쓰기된다.
class GraphState(TypedDict):
    question: str            # 사용자 원래 질문
    route: str               # router 결과 ("rag" / "chat")
    search_query: str        # 검색에 사용할 재작성된 질문
    attempts: int            # rewrite_query 실행 횟수 (첫 검색 포함)
    documents: List[dict]    # 검색 결과 [{"text", "source", "score"}]
    relevant_docs: List[dict]  # 판정을 통과한 문서
    generation: str          # 최종 답변
    path: str                # 최종 경로 기록 ("rag" / "chat" / "fallback") - 평가에 사용


def safe_print(text: str):
    # 터미널 인코딩으로 표현할 수 없는 문자(이모지 등)가 있어도 중단되지 않도록 대체 문자로 출력
    try:
        print(text)
    except UnicodeEncodeError:
        print(text.encode(sys.stdout.encoding, errors='replace').decode(sys.stdout.encoding))


def build_app(api_key: str):
    """벡터 DB·모델을 준비하고 컴파일된 그래프(app)를 반환한다."""

    # =========================================================================
    # [2단계] 벡터 DB 준비
    # =========================================================================
    # 임베딩: 문장을 숫자 벡터로 바꿔 "의미가 비슷한 문장"을 거리로 찾게 해 주는 모델
    # - text-embedding-004 는 2026-01-14 폐기되어 gemini-embedding-001 로 대체됨
    # - 실패 시 가짜(랜덤) 임베딩으로 넘어가지 않고 예외를 그대로 올려 중단한다.
    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001",
        google_api_key=api_key
    )
    embeddings.embed_query("test")  # 연결·모델명이 올바른지 미리 한 번 호출해 검증
    print("[INFO] Google Generative AI embeddings connected successfully.")

    # FAISS 인메모리 벡터 DB: 문서를 임베딩하여 저장 (metadata 에 출처를 함께 저장)
    # ※ 실무에서는 영속 벡터 DB(Chroma, pgvector 등)를 사용해 재실행 시 다시 만들지 않는다.
    vectorstore = FAISS.from_texts(
        [text for _, text in DOCUMENTS],
        embeddings,
        metadatas=[{"source": source} for source, _ in DOCUMENTS],
    )

    # =========================================================================
    # [3단계] LLM 모델 생성
    # =========================================================================
    # - temperature=0: 분류·판정의 일관성을 위해 무작위성을 없앤 설정
    # - timeout / max_retries: 응답 지연·일시적 API 오류에 대비한 실무 설정
    # ※ 실무에서는 router·grade 에 저렴한 경량 모델을 따로 쓰는 경우가 많다. (여기서는 하나로 통일)
    model = ChatGoogleGenerativeAI(
        model="gemini-flash-lite-latest",  # 원래 "gemini-2.5-flash" — 새 사용자에게 제공 중단(404)되어 변경
        google_api_key=api_key,
        temperature=0,
        timeout=60,
        max_retries=3,
    )
    router_llm = model.with_structured_output(Route)   # 응답을 Route 스키마로 강제
    grader_llm = model.with_structured_output(Grade)   # 응답을 Grade 스키마로 강제

    # =========================================================================
    # [4단계] 노드(Node) 함수 정의
    # =========================================================================
    # (a) Router : 질문 유형을 분류 (Adaptive RAG). 일상 대화는 검색 없이 바로 답변하도록 보낸다.
    def route_question(state: GraphState) -> GraphState:
        question = state["question"]
        print(f"[Router] 질문 분류: '{question}'")
        router_prompt = ChatPromptTemplate.from_template(
            "사용자 질문을 분류하세요.\n"
            "- 피자 가게의 영업시간·메뉴·가격·주차·예약·배달·이벤트 등 가게 정보를 묻는 질문이면 rag\n"
            "- 인사, 잡담, 일반 상식 질문이면 chat\n"
            "- 애매하면 rag\n\n질문: {question}"
        )
        result = (router_prompt | router_llm).invoke({"question": question})
        route = result.route if result is not None else "rag"  # 파싱 실패 시 검색 경로(안전한 쪽)로
        print(f"[*] 분류 결과: {route.upper()}")
        return {"route": route, "attempts": 0}

    # (b) General Chat : 검색 없이 LLM 이 바로 답변 (route == "chat")
    def generate_general_answer(state: GraphState) -> GraphState:
        print("[General Chat] 검색 없이 일반 답변 생성 중...")
        answer = (model | StrOutputParser()).invoke(state["question"])
        return {"generation": answer, "path": "chat"}

    # (c) Rewrite Query : 질문을 검색에 적합한 문장으로 다시 쓴다. (재시도 시에는 다른 표현으로)
    def rewrite_query(state: GraphState) -> GraphState:
        attempts = state.get("attempts", 0)
        if attempts == 0:
            prompt = ChatPromptTemplate.from_template(
                "다음 질문을 피자 가게 정보 문서에서 검색하기 좋은 짧은 한 문장으로 바꾸세요. "
                "바꾼 문장만 출력하세요.\n\n질문: {question}"
            )
            query = (prompt | model | StrOutputParser()).invoke({"question": state["question"]})
        else:
            prompt = ChatPromptTemplate.from_template(
                "다음 질문에 맞는 문서를 찾지 못했습니다. 이전 검색어와 다른 표현·키워드로 "
                "피자 가게 정보 검색용 한 문장을 만드세요. 만든 문장만 출력하세요.\n\n"
                "질문: {question}\n이전 검색어: {previous}"
            )
            query = (prompt | model | StrOutputParser()).invoke(
                {"question": state["question"], "previous": state["search_query"]}
            )
        query = query.strip()
        print(f"[Rewrite] 검색어 ({attempts + 1}번째 시도): '{query}'")
        return {"search_query": query, "attempts": attempts + 1}

    # (d) Retrieve : 벡터 DB 에서 유사한 문서 TOP_K 건과 유사도 점수를 가져온다.
    #     - 점수는 L2 거리(작을수록 유사). 여기서는 로그로만 쓰고 판정은 다음 노드가 한다.
    #     - 검색은 관련 문서가 없어도 항상 가장 가까운 문서를 돌려주기 때문에 판정이 필요하다.
    def retrieve_info(state: GraphState) -> GraphState:
        results = vectorstore.similarity_search_with_score(state["search_query"], k=TOP_K)
        documents = [
            {"text": doc.page_content, "source": doc.metadata.get("source", "unknown"), "score": float(score)}
            for doc, score in results
        ]
        print("[Retrieve] 검색 결과: " + ", ".join(f"{d['source']}({d['score']:.2f})" for d in documents))
        return {"documents": documents}

    # (e) Grade : 문서마다 "이 문서에 질문의 답이 있는가"를 판정하고, 통과한 문서만 남긴다.
    #     - 구조화 출력(Grade)이라 "네", "**yes**" 같은 형식 오류가 생기지 않는다.
    #     - batch(): 여러 문서를 한 번에 병렬로 판정한다.
    def grade_documents(state: GraphState) -> GraphState:
        grade_prompt = ChatPromptTemplate.from_template(
            "아래 [문서]에 [질문]에 대한 답이 되는 정보가 들어 있으면 relevant=yes, 없으면 no 입니다. "
            "문서가 질문과 주제만 비슷하고 답이 되는 내용이 없으면 no 입니다.\n\n"
            "[문서]\n{document}\n\n[질문]\n{question}"
        )
        inputs = [{"document": d["text"], "question": state["question"]} for d in state["documents"]]
        grades = (grade_prompt | grader_llm).batch(inputs)
        # 파싱에 실패한 응답(None)은 no 로 처리 → 불확실하면 문서를 믿지 않는 안전한 방향
        relevant_docs = [
            d for d, g in zip(state["documents"], grades) if g is not None and g.relevant == "yes"
        ]
        print(f"[Grade] 관련 문서 {len(relevant_docs)}/{len(state['documents'])}건: "
              + (", ".join(d["source"] for d in relevant_docs) or "없음"))
        return {"relevant_docs": relevant_docs}

    # (f) Generate : 판정을 통과한 문서만 근거로 답변하고 출처를 붙인다. (RAG 의 핵심)
    def generate_rag_answer(state: GraphState) -> GraphState:
        print("[Generate] 관련 문서를 근거로 답변 생성 중...")
        context = "\n".join(f"[출처: {d['source']}] {d['text']}" for d in state["relevant_docs"])
        rag_prompt = ChatPromptTemplate.from_template(
            "당신은 피자 가게 친절한 점원입니다. 아래 [참고 정보]에 있는 내용만 사용해 질문에 답하세요. "
            "참고 정보에 없는 내용은 지어내지 마세요. 답변 끝에 사용한 출처를 (출처: ID) 형태로 적으세요.\n\n"
            "[참고 정보]\n{context}\n\n질문: {question}"
        )
        answer = (rag_prompt | model | StrOutputParser()).invoke(
            {"context": context, "question": state["question"]}
        )
        return {"generation": answer, "path": "rag"}

    # (g) Fallback : 재시도 한도까지 근거를 못 찾으면 LLM 을 부르지 않고 정해진 안내문을 돌려준다.
    #     - 일반론으로 지어내는 것보다 "모른다"고 알리는 편이 실무에서 안전하다.
    def fallback_answer(state: GraphState) -> GraphState:
        print("[Fallback] 근거 문서를 찾지 못해 안내문으로 응답합니다.")
        return {"generation": FALLBACK_MESSAGE, "path": "fallback"}

    # 조건부 엣지 함수 1: router 결과에 따라 경로 이름을 반환
    def decide_after_route(state: GraphState) -> str:
        return "rag" if state["route"] == "rag" else "chat"

    # 조건부 엣지 함수 2: 판정 결과에 따라 경로 이름을 반환
    #   관련 문서 있음                     → generate
    #   없음 + 재시도 여유(attempts <= MAX_RETRIES) → rewrite (질문을 바꿔 재검색)
    #   없음 + 한도 초과                   → fallback
    #   attempts 는 첫 검색을 1로 세므로, MAX_RETRIES=2 이면 최대 3번 검색한다.
    def decide_after_grade(state: GraphState) -> str:
        if state["relevant_docs"]:
            return "generate"
        if state["attempts"] <= MAX_RETRIES:
            return "rewrite"
        return "fallback"

    # =========================================================================
    # [5단계] 그래프 조립
    # =========================================================================
    workflow = StateGraph(GraphState)

    # 노드 등록: add_node(노드 이름, 실행 함수)
    workflow.add_node("router", route_question)
    workflow.add_node("general_chat", generate_general_answer)
    workflow.add_node("rewrite_query", rewrite_query)
    workflow.add_node("retrieve", retrieve_info)
    workflow.add_node("grade_documents", grade_documents)
    workflow.add_node("generate", generate_rag_answer)
    workflow.add_node("fallback", fallback_answer)

    # 고정 엣지
    workflow.add_edge(START, "router")
    workflow.add_edge("rewrite_query", "retrieve")
    workflow.add_edge("retrieve", "grade_documents")

    # 조건부 엣지 1: router 이후 → 검색 경로 또는 일반 대화 경로
    workflow.add_conditional_edges(
        "router", decide_after_route,
        {"rag": "rewrite_query", "chat": "general_chat"}
    )
    # 조건부 엣지 2: 판정 이후 → 답변 / 재검색(rewrite_query 로 되돌아가는 순환) / fallback
    workflow.add_conditional_edges(
        "grade_documents", decide_after_grade,
        {"generate": "generate", "rewrite": "rewrite_query", "fallback": "fallback"}
    )

    # 종료 엣지: 세 갈래 모두 답변 생성 후 종료
    workflow.add_edge("general_chat", END)
    workflow.add_edge("generate", END)
    workflow.add_edge("fallback", END)

    # =========================================================================
    # [6단계] 컴파일
    # =========================================================================
    # 노드·엣지 정의를 검증하고 실행 가능한 객체로 만든다. (이후 구조 변경 불가)
    return workflow.compile()


# =============================================================================
# [7단계] 평가: 질문 × 기대 경로로 정확도 측정
# =============================================================================
# 기대 경로: rag(문서 기반 답변) / chat(검색 없는 일반 답변) / fallback(근거 없음 안내)
EVAL_SET = [
    ("피자 가격 알려주세요.", "rag"),
    ("몇 시까지 영업하나요?", "rag"),
    ("주차 가능한가요?", "rag"),
    ("배달도 되나요?", "fallback"),        # 가게 질문이지만 문서에 답이 없음
    ("아인슈타인이 누구야?", "chat"),
    ("안녕하세요!", "chat"),
]


def run_agentic_rag():
    # .env(또는 시스템 환경변수)에서 키를 읽는다. 코드에 키를 직접 적지 않는다.
    api_key = os.environ.get("GOOGLE_API_KEY", "").strip()
    if not api_key:
        # 키가 없으면 API 호출 전에 즉시 중단 (fail-closed)
        print("[오류]: GOOGLE_API_KEY가 설정되지 않았습니다. .env에 GOOGLE_API_KEY=... 를 추가하세요.")
        return

    try:
        app = build_app(api_key)
    except Exception as e:
        print(f"[오류]: 초기화 실패 - {type(e).__name__}: {e}")
        print("API 키와 모델명을 확인해 주세요.")
        return

    correct = 0
    mismatches = []
    for i, (question, expected) in enumerate(EVAL_SET, start=1):
        print(f"\n=== [질문 {i}/{len(EVAL_SET)}] {question} (기대 경로: {expected}) ===")
        try:
            # invoke: START부터 END까지 실행하고 최종 State 를 반환 (question 만 초기값으로 전달)
            result = app.invoke({"question": question})
        except Exception as e:
            print(f"[오류]: {type(e).__name__}: {e}")
            mismatches.append((question, expected, "error"))
            continue

        actual = result.get("path", "unknown")
        safe_print(f"최종 답변: {result['generation']}")
        print(f"실제 경로: {actual}")
        if actual == expected:
            correct += 1
        else:
            mismatches.append((question, expected, actual))

    # 결과 요약: 기대 경로와 일치한 비율과 틀린 질문 목록
    print("\n=== [평가 결과] ===")
    print(f"정확도: {correct}/{len(EVAL_SET)} ({correct / len(EVAL_SET):.0%})")
    for question, expected, actual in mismatches:
        print(f"  불일치: '{question}' 기대={expected}, 실제={actual}")


# 이 파일을 직접 실행했을 때만 동작 (다른 모듈에서 import 시에는 실행되지 않음)
if __name__ == "__main__":
    run_agentic_rag()
