"""agentic_rag.py 평가를 무료 등급 호출 한도에 맞춰 천천히 실행한다 (추가 파일).

Gemini 무료 등급은 모델당 분당 15회 호출로 제한된다(429 RESOURCE_EXHAUSTED).
fallback 경로 질문 하나가 router 1 + (rewrite 1 + grade 3) x 3 = 13회를 호출하므로
6개 질문을 한 번에 돌리면 한도를 넘는다. 원본 코드는 그대로 두고, 질문 사이에 쉬어 간다.

실행: python 05_agentic_rag/run_eval_paced.py
"""
import os
import time

from agentic_rag import EVAL_SET, build_app, safe_print

PAUSE_SECONDS = 65   # 분당 한도 창이 지나갈 때까지 대기

app = build_app(os.environ["GOOGLE_API_KEY"].strip())
correct, mismatches = 0, []
for i, (question, expected) in enumerate(EVAL_SET, start=1):
    if i > 1:
        print(f"\n(호출 한도 대기 {PAUSE_SECONDS}초)")
        time.sleep(PAUSE_SECONDS)
    print(f"\n=== [질문 {i}/{len(EVAL_SET)}] {question} (기대 경로: {expected}) ===")
    try:
        result = app.invoke({"question": question})
    except Exception as e:
        print(f"[오류]: {type(e).__name__}: {str(e)[:160]}")
        mismatches.append((question, expected, "error"))
        continue
    actual = result.get("path", "unknown")
    safe_print(f"최종 답변: {result['generation']}")
    print(f"실제 경로: {actual}")
    if actual == expected:
        correct += 1
    else:
        mismatches.append((question, expected, actual))

print("\n=== [평가 결과] ===")
print(f"정확도: {correct}/{len(EVAL_SET)} ({correct / len(EVAL_SET):.0%})")
for question, expected, actual in mismatches:
    print(f"  불일치: '{question}' 기대={expected}, 실제={actual}")
