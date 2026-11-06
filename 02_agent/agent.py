# 02_agent.py
# -----------
# 02 단계: LangGraph prebuilt 헬퍼 기반 ReAct 순환 에이전트 구동
#
# LangGraph에서 가장 널리 사용되는 기본 에이전트인 ReAct(Reasoning + Action) 구조를 빌드합니다.
# 이 에이전트는 사용자의 수학적 계산 질문에 맞게 정의된 계산 도구를 기동하여 올바른 답을 찾아냅니다.

from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
import os
import sys
from dotenv import load_dotenv

# .env 파일의 변수(GOOGLE_API_KEY 등)를 환경변수로 로드
# - find_dotenv()가 이 파일 위치에서 상위 폴더로 올라가며 .env를 탐색하므로
#   프로젝트 루트(langgraph-1.1/.env)에 있어도 어느 경로에서 실행하든 찾아 줌
# - 이미 설정된 시스템 환경변수는 덮어쓰지 않음 (override=False 기본값)
load_dotenv()

# LangGraph 1.x: langchain.agents.create_agent 사용 (system_prompt 인자)
# 구버전 호환: 없으면 deprecated 된 langgraph.prebuilt.create_react_agent (prompt 인자)로 대체
try:
    from langchain.agents import create_agent as _create_agent

    def build_agent(model, tools, system_prompt):
        return _create_agent(model, tools, system_prompt=system_prompt)
except ImportError:
    from langgraph.prebuilt import create_react_agent as _create_agent

    def build_agent(model, tools, system_prompt):
        return _create_agent(model, tools, prompt=system_prompt)

# Windows 터미널에서 한글 및 이모지 출력 시 인코딩 오류(UnicodeEncodeError) 방지
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

# [1단계] 에이전트가 활용할 덧셈 계산 도구 정의
# - 함수의 스키마 설명(docstring)을 기준으로 모델이 계산 필요 여부를 판단하게 됩니다.
@tool
def calculate_add(a: int, b: int) -> int:
    """두 정수 a와 b를 받아서 덧셈한 최종 결과값을 반환합니다. 덧셈을 수행해야 할 때 호출하세요."""
    return a + b

tools = [calculate_add]

def run_agent():
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
        temperature=0 # 도구 호출의 오동작을 줄이기 위해 결정론적인 0 설정
    )

    # [3단계] 랭그래프 prebuilt 헬퍼를 이용해 ReAct 순환 에이전트 조립 및 컴파일
    # - prompt 옵션으로 에이전트의 페르소나 및 시스템 지침 프롬프트를 바인딩합니다.
    system_prompt = "당신은 사용자의 덧셈 계산 질문에 맞춰 calculate_add 도구를 기동해주는 수학 계산 도우미입니다."
    print(f"=== 설정된 시스템 프롬프트 ===\n{system_prompt}\n=============================\n")
    agent_app = build_agent(model, tools, system_prompt)

    # [4단계] 질문 실행
    query = "345 더하기 987은 몇이야?"
    print(f"=== 사용자 질문: {query} ===")

    inputs = {"messages": [("user", query)]}
    try:
        response = agent_app.invoke(inputs)
        print("\n=== 에이전트 단계별 실행 내역 ===")
        # 결과 대화 리스트들의 타입(USER, TOOL, AI 등)과 그 본문 텍스트 내용을 한 눈에 대조 출력합니다.
        for msg in response["messages"]:
            # 원래 msg.content — 최신 Gemini는 content를 [텍스트, 서명] 블록 목록으로 돌려줘 .text 로 텍스트만 출력
            print(f"[{msg.type.upper()}]: {msg.text}")
    except Exception as e:
        # 원인을 가리지 않도록 예외 종류와 내용을 먼저 출력 (API 키 값은 출력하지 않음)
        print(f"\n[오류 발생]: {type(e).__name__}: {e}")
        print("API 키 오류라면 GOOGLE_API_KEY 값이 올바른지 확인해 주세요.")

if __name__ == "__main__":
    run_agent()
