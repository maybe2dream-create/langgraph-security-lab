# langgraph-security-lab

LangGraph로 상태 그래프 · 도구 에이전트 · 사람 승인(HITL) · 세션 메모리 · Agentic RAG · 실시간 대시보드를 단계별로 만들고,
**보안 관점**(과도한 권한 통제, 세션 격리, 근거 없는 답변 차단, 루프 비용)에서 무엇이 어떻게 동작하는지 확인한 실습 기록입니다.

- 과정: AI-Native 보안 엔지니어 훈련 — LangGraph 실습 (2026-11)
- 환경: macOS · Python 3.11 · `langgraph` 1.2.20 · `langchain` 1.4.9 · Google Gemini `gemini-flash-lite-latest` · Node.js 24
- [`results/`](results/)의 모든 출력과 화면 캡처는 이 저장소의 코드를 직접 실행한 결과입니다.
- 이전 단계 실습: [langchain-security-lab](https://github.com/maybe2dream-create/langchain-security-lab)

## 구성

| 폴더 | 장 | 핵심 개념 | 키 |
|---|---|---|---|
| [`01_basic/`](01_basic/) | 기초 상태 그래프 | `StateGraph`, State(TypedDict), Node, Edge, `compile()` | 불필요 |
| [`02_agent/`](02_agent/) | 도구 연동 에이전트 | `@tool`, `create_agent` (ReAct 루프) | Gemini |
| [`03_human/`](03_human/) | 승인 및 대기 (HITL) | `interrupt_before`, `MemorySaver`, `thread_id`, `invoke(None, config)` | 불필요 |
| [`04_memory/`](04_memory/) | 대화 기억·세션 격리 | `add_messages` 리듀서, thread_id별 체크포인트 | Gemini |
| [`05_agentic_rag/`](05_agentic_rag/) | Agentic RAG | 라우팅 → 검색어 재작성 → 검색 → 문서 판정 → 재검색 루프 / 답변 / fallback, 구조화 출력, 정확도 평가 | Gemini |
| [`06_visual_dashboard/`](06_visual_dashboard/) | 비주얼 대시보드 | FastAPI + WebSocket 백엔드, React Flow 프론트엔드, 동적 그래프, HITL 재개 | Gemini |

## 실행

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install langgraph langchain langchain-google-genai langchain-openai langchain-community faiss-cpu fastapi uvicorn python-dotenv
echo "GOOGLE_API_KEY=..." > .env       # .env 는 .gitignore 로 제외됨

python 01_basic/basic.py
python 02_agent/agent.py
python 03_human/human.py                  # 중간에 yes / no 입력
python 04_memory/memory.py
python 05_agentic_rag/run_eval_paced.py   # 무료 등급 한도 때문에 질문 사이 65초 대기
```

06장은 터미널 두 개에서 실행합니다.

```bash
python 06_visual_dashboard/backend/dashboard_main.py        # http://127.0.0.1:8000
(cd 06_visual_dashboard/frontend && npm install && npm run dev)   # http://localhost:5173
```

화면에서 LangGraph → 실행 모드 "백엔드" → 실습 단계 선택 → 회의 시작.

## 결과

| 장 | 결과 | 출력 |
|---|---|---|
| 01 | START → node_one → node_two → END 순차 실행 | [01_basic.txt](results/01_basic.txt) |
| 02 | 에이전트가 `calculate_add`를 스스로 골라 호출 → 1332 | [02_agent.txt](results/02_agent.txt) |
| 03 | 발송 직전 정지 → `yes`면 재개, `no`면 파기 | [03_human.txt](results/03_human.txt) |
| 04 | A 세션은 이름을 기억, B 세션은 모름 (세션 격리) | [04_memory.txt](results/04_memory.txt) |
| 05 | 평가셋 6문항 기대 경로 **6/6** (rag 3 · fallback 1 · chat 2) | [paced](results/05_agentic_rag_paced.txt), [첫 실행 5/6](results/05_agentic_rag.txt) |
| 06 | Step 3 상태 전달, Step 7 HITL 루프 (초안 → 수정 요청 → 재작성 → 승인) | [step3](results/06_dashboard_step3.jpg), [paused](results/06_dashboard_step7_paused.jpg), [revised](results/06_dashboard_step7_revised.jpg), [approved](results/06_dashboard_step7_approved.jpg) |
| 06 자유 설계 | 직접 설계한 보안 게이트: 안전 → 작성 → **재작성**(비밀번호 노출 적발) → 고쳐 쓰기 → **통과** → END | [secure_gate](results/06_free_design_secure_gate.png) |

## 자유 설계: 사내 AI 비서 보안 게이트

06 대시보드의 자유 설계 모드로 직접 설계한 그래프입니다. 예제 시나리오 `free-secure-gate`로 들어 있습니다([scenarios.js](06_visual_dashboard/frontend/src/scenarios.js)).

```
START → 입력 검사기 ─안전→ 답변 작성자 → 출력 검토자 ─통과→ END
                    │            ↑______재작성______│
                    └─위험→ 차단 안내 → END
```

- **입력 검사(분기)**: 프롬프트 인젝션이나 민감정보 탈취 요청이면 "위험"으로 보내 차단합니다 (LLM01).
- **출력 검토(루프)**: 답변에 실제 비밀번호 값이 있으면 "재작성"으로 작성자에게 되돌립니다 (LLM02 Sensitive Information Disclosure). 참고 자료에 섞인 임시 비밀번호(`Welcome!2026`, 데모용 가짜 값)가 첫 답변에 새어 나왔고, 검토자가 이를 적발했습니다.
- **fail-safe 순서**: 판정 단어가 답변에 없으면 첫 번째 선으로 가므로 "위험"과 "재작성" 선을 먼저 두었습니다.
- **노드 이름 규칙**: 답변 앞에 `[노드 이름]`이 붙어 판정 문자열에 섞이므로, 노드 이름에 선 이름(안전·위험·통과·재작성)을 넣지 않았습니다.
- **기준 조정**: 처음에는 검토자가 값 없는 "임시 비밀번호를 입력" 문구까지 거부해 루프가 길어졌고, 무료 등급 한도(분당 15회)에 걸려 429가 났습니다. 그래서 "실제 값이 있을 때만 재작성"으로 기준을 좁혔습니다. 판정 기준이 모호하면 루프 비용이 커진다는 점을 확인했습니다 (LLM10).

## 보안 관점에서 확인한 것

| LangGraph 기능 | 의미 |
|---|---|
| **interrupt · 사람 승인** (03, 06 Step 7) | 되돌릴 수 없는 행동(메일 발송·결제·삭제) 전에 사람이 확인 — OWASP **LLM06 Excessive Agency** 통제. 06에서 경량 모델의 이상한 초안("도서관의 숨은 *명곡*")을 사람이 걸러 수정시켰다 |
| **thread_id 세션 격리** (04) | 사용자별 이력이 섞이지 않음. 격리가 깨지면 교차 세션 정보 유출 |
| **문서 판정 + fallback** (05) | 근거가 없으면 지어내지 않고 "정보 없음" 안내 — **LLM09 Misinformation** 완화. 판정 실패는 "관련 없음"으로 처리(fail-safe) |
| **구조화 출력** (05) | 라우팅·판정을 `Literal` 값으로 제한해 모델 출력이 그래프 경로를 엉뚱하게 바꾸지 못하게 함 |
| **재시도 한도·호출 상한** (05, 06) | 루프는 호출을 곱한다. fallback 질문 1개 = router 1 + (rewrite 1 + grade 3) × 3 = 13회. 무료 등급(분당 15회)에서 실제로 429가 났다 — **LLM10 Unbounded Consumption** |
| **외부 코드 점검** (06) | 받은 zip의 미리 빌드된 `node_modules`·`dist`는 버리고 소스만 검사 후 새로 설치. 백엔드는 `127.0.0.1`에만 바인딩, CORS는 `localhost:5173`만 허용 |

## 원본 예제에서 바꾼 것

| 대상 | 변경 | 이유 |
|---|---|---|
| 01 | 파일명 `basic.py` | `langgraph.py`로 저장하면 `from langgraph.graph import …`가 패키지 대신 자기 자신을 import |
| 02·04·05, 06 백엔드 | `gemini-2.5-flash` → `gemini-flash-lite-latest` | 신규 사용자에게 `404 no longer available to new users` |
| 02·04 출력, 06 백엔드 반환 | `.content` → `.text` | 최신 Gemini는 `content`를 [텍스트, 서명] 블록 목록으로 반환해 목록이 그대로 출력됨 |
| 05 | `run_eval_paced.py` 추가 (원본은 그대로) | 무료 등급 호출 한도 안에서 평가하기 위해 질문 사이 65초 대기 |

변경한 줄에는 원래 값을 주석으로 남겼습니다.
