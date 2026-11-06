# 01_basic.py
# -----------
# 01 단계: LangGraph 상태전이 기본 구조 실습
#
# 이 실습은 LangGraph의 뼈대가 되는 세 가지 핵심 요소:
# 1. State(상태): 시스템 전반에 데이터가 누적되고 공유되는 메모리 객체 (TypedDict 등)
# 2. Nodes(노드): 독립적인 가공을 처리하는 파이썬 함수
# 3. Edges(엣지): 노드와 노드 사이의 흐름을 잇는 선 (START 및 END 제어)
# 을 결합하여 기본적인 선형 제어 파이프라인 그래프를 구현하는 과정입니다.
#
# (메모) 파일 이름을 langgraph.py 로 하면 아래 import가 패키지 대신 이 파일을 불러와 실패한다. 그래서 basic.py.

from typing import TypedDict
from langgraph.graph import StateGraph, START, END
import sys

# Windows 터미널에서 한글 및 이모지 출력 시 인코딩 오류(UnicodeEncodeError) 방지
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

# [1단계] 공유 상태(State) 데이터 구조 정의
# - 그래프 내부에서 실행 주체 노드들이 가공하고 참고할 데이터들의 뼈대 스키마입니다.
class GraphState(TypedDict):
    input_text: str       # 외부에서 입력되는 최초 문자열
    processed_text: str   # 각 노드들을 거쳐 변형 가공될 문자열

# [2단계] 노드(Node) 함수들 정의
# - 각 노드는 현재 상태(state)를 매개변수로 입력받고,
#   업데이트할 내용이 담긴 새로운 상태값의 딕셔너리를 반환(return)합니다.
# - 리턴된 값은 LangGraph 프레임워크에 의해 기존의 State 정보에 병합(Merge) 처리됩니다.
def first_node(state: GraphState) -> GraphState:
    print("\n--- [Node 1] 가동 시작 ---")
    current_input = state["input_text"]
    print(f"입력값 접수: '{current_input}'")
    # 1차 가공된 내용 반환
    return {"processed_text": current_input + " ➡️ (1차 가공 완료)"}

def second_node(state: GraphState) -> GraphState:
    print("\n--- [Node 2] 가동 시작 ---")
    current_processed = state["processed_text"]
    print(f"가공 데이터 수거: '{current_processed}'")
    # 최종 가공 완료 문구를 결합하여 마감 처리
    return {"processed_text": current_processed + " ➡️ (최종 노드 컴파일)"}

def run_basic_graph():
    # [3단계] StateGraph 인스턴스 선언
    # - 앞서 정의한 GraphState 데이터 규격을 전달하며 워크플로우를 초기화합니다.
    workflow = StateGraph(GraphState)

    # [4단계] 그래프에 노드들 등록
    # - 노드의 문자열 고유 아이디("node_one" 등)와 그 노드에 해당할 파이썬 매핑 함수를 바인딩합니다.
    workflow.add_node("node_one", first_node)
    workflow.add_node("node_two", second_node)

    # [5단계] 엣지(Edge) 연결선 생성
    # - START: 그래프 가동 시 가장 최초로 진입해야 할 첫 노드를 가리키는 포인터
    # - END: 그래프를 완전히 종결시키는 종료 플래그 포인터
    workflow.add_edge(START, "node_one")       # 시작되면 node_one으로 진입
    workflow.add_edge("node_one", "node_two")   # node_one 가동 완료 후 node_two로 데이터 전달
    workflow.add_edge("node_two", END)          # node_two 작업 완료 후 종료

    # [6단계] 그래프 컴파일 (Compile)
    # - 작성된 상태 노드/엣지 연결망을 런타임용 실행 객체인 app으로 빌드해 냅니다.
    app = workflow.compile()

    # [7단계] 그래프 실행 및 출력 검증
    initial_inputs = {"input_text": "로컬 그래프 실습"}
    print(f"=== [메인 그래프 실행 시작] 초기 값: {initial_inputs['input_text']} ===")

    # app.invoke()를 통해 초기 입력을 던져 가동을 개시합니다.
    result = app.invoke(initial_inputs)
    print("\n=== [최종 실행 결과] ===")
    print(result["processed_text"])

if __name__ == "__main__":
    run_basic_graph()
