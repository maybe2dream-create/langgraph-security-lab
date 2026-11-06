# 03_human.py
# -----------
# 03 단계: Human-in-the-loop (사람의 승인 개입 및 실행 제어)
#
# 에이전트가 이메일 발송, 결제, 데이터베이스 삭제 등 치명적인 행동을 수행하기 전,
# 멈춰 서서 사람(Human)에게 결재를 요청하고 승인받은 경우에만 가동을 재개하는 구조를 구현합니다.
# 이를 가능하게 하려면 상태 복원을 위한 체크포인터(MemorySaver)와 interrupt_before 옵션이 핵심입니다.

from typing import TypedDict
from langgraph.graph import StateGraph, START, END
import sys

# Windows 터미널에서 한글 및 이모지 출력 시 인코딩 오류(UnicodeEncodeError) 방지
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass
from langgraph.checkpoint.memory import MemorySaver                   # 메모리 기반 영속 체크포인터

# [1단계] 상태(State) 구조 정의
class AgentState(TypedDict):
    action_type: str        # 현재 수행할 업무 종류
    user_approved: bool     # 사용자로부터 승인을 받았는지의 여부

# [2단계] 각 단계의 노드 함수 정의
def prepare_email_node(state: AgentState) -> AgentState:
    print("\n--- [시스템 노드 1] 이메일 발송 준비 완료 ---")
    # 메일 발송 전 단계이므로 승인값을 False로 둔 상태로 반환합니다.
    return {"action_type": "send_email", "user_approved": False}

def send_email_node(state: AgentState) -> AgentState:
    print("\n--- [시스템 노드 2] 메일 서버 접속 및 발송 가동! ---")
    print("👉 결과: 이메일이 목적지로 안전하게 송신되었습니다.")
    return {"user_approved": True}

def run_human_in_the_loop():
    # [3단계] 체크포인터(MemorySaver) 생성
    # - 상태를 일시 중지하고 복원하기 위해서 상태 저장이 실시간으로 보존되는 메모리 세이버가 필요합니다.
    memory = MemorySaver()

    # [4단계] 그래프 구축 및 노드 등록
    workflow = StateGraph(AgentState)
    workflow.add_node("prepare_email", prepare_email_node)
    workflow.add_node("send_email", send_email_node)

    # [5단계] 연결선 연결 (prepare_email -> send_email -> END)
    workflow.add_edge(START, "prepare_email")
    workflow.add_edge("prepare_email", "send_email")
    workflow.add_edge("send_email", END)

    # [6단계] 컴파일 시 중단점(Interrupt) 주입
    # - `interrupt_before=["send_email"]`: send_email 노드가 가동하기 바로 직전에 상태값을 체크포인터에 저장하고 실행을 멈춥니다.
    app = workflow.compile(
       checkpointer=memory,
        interrupt_before=["send_email"]
    )

    # [7단계] 1차 가동 (동작 개시)
    # - 독립된 세션으로 대화 이력 상태를 분리하기 위해 `thread_id` 값을 설정하여 호출합니다.
    config = {"configurable": {"thread_id": "session_1"}}
    print("=== [1단계 실행 시작] 메일 준비 작동 ===")

    app.invoke({"action_type": "none", "user_approved": False}, config)

    # [8단계] 중단 상태 대기 및 사용자 승인 시뮬레이션
    print("\n🚨 [승인 대기] 메일 발송 직전에 그래프가 멈추었습니다.")
    user_confirm = input("메일을 정말 발송할까요? (yes / no): ").strip().lower()

    if user_confirm == "yes":
        print("\n=== [2단계 실행 재개] 사용자가 승인했습니다. ===")
        # - invoke 함수에 첫 번째 인자로 None을 기입하고 같은 config(thread_id)를 던져주면
        #   멈췄던 시점의 상태 정보(체크포인트)를 로드하여 즉시 뒷부분을 마저 실행합니다.
        app.invoke(None, config)
    else:
        print("\n❌ 사용자가 승인을 거절하여 발송 작업이 파기되었습니다.")

if __name__ == "__main__":
    run_human_in_the_loop()
