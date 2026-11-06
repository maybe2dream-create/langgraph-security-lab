// scenarios.js
// ------------
// 단계별 예제 시나리오 모음. FlowEditor(왼쪽 패널의 '예제 시나리오')와 ManualModal(8. 시나리오 구상하기)이 함께 쓴다.
//
// 목적: 예제를 보고 "이런 역할·입력·연결로 이런 결과를 볼 수 있구나"를 익혀 자기 시나리오를 구상하게 한다.
//
// 항목 형식
//   id       : 고유 이름
//   title    : 시나리오 제목
//   summary  : 무엇을 하는지 한 줄 설명
//   flow     : (선택) 왼쪽 패널 '연결 구조'에 보일 기본 구조. 없으면 단계 기본값을 쓴다
//   flowNote : (선택) 연결 구조 아래 한 줄 설명
//   observe  : 실행해서 무엇을 관찰하면 좋은지 (구상 포인트)
//   contexts : { 노드 id: 컨텍스트(입력·지시) }  — 단계의 기본 그래프에서 노드 내용만 바꾼다
//   graph    : { nodes, edges } — 노드 구성과 연결까지 통째로 바꾼다 (자유 설계 전용)
//
// 컨텍스트가 실행에서 쓰이는 방식 (코드 기준)
//   step0 : 노드1(프롬프트)의 컨텍스트 = "주제"(답변은 "{주제}에 대해서 설명해주세요."로 요청됨), 노드2(모델) = 말투·역할 지시
//   step1 : 노드1의 컨텍스트 = "질문" (멘토 페르소나는 코드에 고정: PEP 8 멘토)
//   step2 : 노드1(기획자)의 컨텍스트 = "요청", 노드2(개발자)의 컨텍스트 = 검토 지시
//   step3/4/free : 컨텍스트 = 그 노드의 시스템 지시. 첫 입력은 "회의를 시작하겠습니다." 이므로 주제는 지시 안에 써야 한다.
//   step4 : 개발자 노드가 답변에 [승인]을 쓰면 종료, 아니면 기획자로 되돌아간다. 승인 조건은 개발자 지시에 쓴다.
//   step7 : '__human__' 노드가 사람 승인(HITL). 이 노드에 도달하면 실행이 멈추고 결과 패널에 승인 카드가 뜬다.
//           연결선 이름은 '수정'과 '승인'을 쓰고, '수정' 선을 먼저 둔다(사람이 쓴 의견에 '승인'이 들어 있어도 '수정'으로 가도록).
//   step5/6 : 그린 연결을 그대로 실행(자유 설계와 같은 규칙). 연결선 이름(통과/재작성 등)이 판정 노드 답변에 '포함'되면 그 선으로 간다.
//             그래서 선 이름끼리 서로 포함되지 않게 하고(예: '합격'과 '불합격'은 안 됨), 판정 노드는 통과일 때만 '통과'를 쓰게 한다.
//             되돌릴 때는 판정 단어 + 부족한 점 한 줄을 함께 쓰게 해야 다음 노드가 무엇을 고칠지 알 수 있다.
//             (판정이 한 단어뿐이면 작성자가 고칠 방향을 몰라 끝나지 않는다 — 실제로 20단계까지 반복한 사례가 있었다)
//             기준은 LLM이 틀리기 쉬운 것(글자 수 세기)보다 확인하기 쉬운 것(숫자 포함, 특정 기호로 끝남)으로 정한다.

export const SCENARIOS = {
  step0: [
    {
      id: 'rag-kids',
      title: 'RAG를 초등학생에게 설명',
      summary: '어려운 개념을 일상 비유로 풀어 쓰게 합니다.',
      observe: '같은 주제라도 모델 노드의 "역할 지시"가 말투와 비유를 바꾼다는 점을 보세요.',
      contexts: {
        '1': 'RAG(검색 증강 생성)',
        '2': '당신은 어려운 IT 개념을 초등학생도 이해하게 일상 비유로 3문장 이내로 설명하는 선생님입니다.',
      },
    },
    {
      id: 'vector-cook',
      title: '벡터 DB를 요리 비유로',
      summary: '모델 노드에 "요리사" 역할을 주고 같은 방식으로 설명시킵니다.',
      observe: '역할(요리사)이 비유의 소재를 정합니다. 역할을 바꾸면 소재가 달라집니다.',
      contexts: {
        '1': '벡터 데이터베이스',
        '2': '당신은 요리사입니다. 모든 설명을 요리 재료와 조리 과정에 빗대어 3문장 이내로 합니다.',
      },
    },
    {
      id: 'api-sdk',
      title: 'API와 SDK 차이를 두 문장으로',
      summary: '길이 제한을 지시에 넣어 간결한 답을 받습니다.',
      observe: '"두 문장 이내" 같은 제약이 답변 길이에 얼마나 지켜지는지 확인하세요.',
      contexts: {
        '1': 'API와 SDK의 차이',
        '2': '당신은 신입 개발자에게 설명하는 선배입니다. 반드시 두 문장 이내로, 전문용어는 쉬운 말로 풀어 설명합니다.',
      },
    },
    {
      id: 'prompt-grumpy',
      title: '까칠한 시니어의 프롬프트 조언',
      summary: '같은 주제를 말투만 다르게 받아 봅니다.',
      observe: '모델 노드의 지시만 바꿔도 내용은 같고 말투가 완전히 달라집니다. 앞 시나리오와 비교해 보세요.',
      contexts: {
        '1': '프롬프트 엔지니어링',
        '2': '당신은 까칠한 시니어 개발자입니다. 반말로, 핵심만 짧게 3문장 이내로 말합니다.',
      },
    },
  ],

  step1: [
    {
      id: 'listcomp',
      title: '리스트 컴프리헨션 가독성',
      summary: '코딩 멘토에게 가독성 규칙을 질문합니다.',
      observe: '멘토는 PEP 8 기준으로 답하도록 고정되어 있습니다. 질문만 바뀝니다.',
      contexts: { '1': '파이썬 리스트 컴프리헨션이 길어질 때 가독성을 지키는 방법을 3가지로 알려주세요.' },
    },
    {
      id: 'naming',
      title: '함수 이름 짓는 규칙',
      summary: '이름 짓기 규칙을 예시와 함께 묻습니다.',
      observe: '"예시와 함께" 같은 요청이 답변 형식(예시 코드 포함 여부)에 영향을 줍니다.',
      contexts: { '1': '파이썬에서 함수와 변수 이름을 지을 때 지켜야 할 규칙을 좋은 예와 나쁜 예로 보여주세요.' },
    },
    {
      id: 'comment',
      title: '주석을 쓸 때와 안 쓸 때',
      summary: '판단 기준을 묻는 질문입니다.',
      observe: '답을 단정하지 않는 질문일수록 이유를 설명하는 답이 나옵니다.',
      contexts: { '1': '코드에 주석을 쓰는 것이 좋은 경우와 쓰지 않는 것이 좋은 경우의 기준을 알려주세요.' },
    },
    {
      id: 'fix-code',
      title: '코드 첨삭 요청',
      summary: '질문 안에 코드를 넣어 고쳐 달라고 합니다.',
      observe: '질문(컨텍스트) 칸에 코드를 붙여 넣을 수 있다는 점과, 수정 이유까지 설명하는지 보세요.',
      contexts: { '1': '아래 코드를 PEP 8에 맞게 고치고 무엇을 왜 바꿨는지 알려주세요.\n\ndef Add(a,b): return a+b' },
    },
  ],

  step2: [
    {
      id: 'library-bot',
      title: '도서관 책 추천 챗봇',
      summary: '기획자가 초안을 쓰고 개발자가 기술 실현 가능성을 평가합니다.',
      observe: '기획자의 답이 개발자의 입력으로 "그대로" 넘어갑니다. 개발자 답이 기획 내용을 인용하는지 보세요.',
      contexts: {
        '1': '동네 도서관 대출 기록을 바탕으로 책을 추천해 주는 챗봇 앱을 기획해 주세요.',
        '2': '기획안의 기술적 실현 가능성을 프론트엔드·백엔드·DB 관점에서 각각 한 줄로 평가하고, 가장 큰 위험 1가지를 말해 주세요.',
      },
    },
    {
      id: 'grocery',
      title: '1인 가구 장보기 목록 앱',
      summary: '개발자에게 비용·개인정보 위험을 짚게 합니다.',
      observe: '개발자 지시를 "위험 지적"으로 바꾸면 같은 기획이 다른 관점으로 평가됩니다.',
      contexts: {
        '1': '1인 가구가 일주일 식단에 맞춰 장보기 목록을 자동으로 만들어 주는 앱을 기획해 주세요.',
        '2': '기획안을 운영 비용과 개인정보 보호 관점에서 검토하고, 가장 걱정되는 점 2가지와 대응책을 각각 한 줄로 쓰세요.',
      },
    },
    {
      id: 'gym-db',
      title: '헬스장 PT 예약 앱 (DB 설계)',
      summary: '개발자가 DB 테이블 설계안까지 내게 합니다.',
      observe: '개발자 지시에 "결과물의 형태"(테이블 3개 이내)를 정하면 구체적인 산출물이 나옵니다.',
      contexts: {
        '1': '동네 헬스장의 PT 트레이너 예약과 취소를 관리하는 앱을 기획해 주세요.',
        '2': '이 기획에 필요한 DB 테이블을 3개 이내로 설계하고, 각 테이블의 주요 컬럼을 한 줄씩 적어 주세요.',
      },
    },
    {
      id: 'meeting-mvp',
      title: 'AI 회의록 요약 서비스 (MVP)',
      summary: '개발자에게 "처음 만들 범위"를 정하게 합니다.',
      observe: '기획은 욕심 많게, 개발자는 범위를 줄이게 하는 역할 대비를 관찰해 보세요.',
      contexts: {
        '1': '화상 회의 녹취를 자동으로 요약해 주는 AI 회의록 서비스를 기획해 주세요.',
        '2': '이 기획에서 가장 먼저 만들 MVP(최소 기능) 범위를 3줄로 제안하고, 뒤로 미룰 기능을 1가지 말해 주세요.',
      },
    },
  ],

  step3: [
    {
      id: 'library-state',
      title: '도서관 챗봇: 기획 → 기술 스택',
      summary: '기획자의 결과가 상태에 쌓이고 개발자가 이어받습니다.',
      observe: '개발자는 "앞선 기획"을 따로 지시받지 않았는데도 내용을 이어받습니다. 이것이 상태(State) 전달입니다.',
      contexts: {
        '1': '당신은 PM입니다. 동네 도서관 도서 추천 챗봇의 핵심 기능 3가지를 5줄 이내로 제안하세요.',
        '2': '앞선 기획의 핵심 기능을 구현할 기술 스택을 3줄로 요약하세요.',
      },
    },
    {
      id: 'onboarding',
      title: '온보딩 체크리스트 앱: 기획 → 데이터 구조',
      summary: '개발자에게 데이터 구조 요약을 맡깁니다.',
      observe: '두 노드의 지시가 서로 다른 "산출물"(기능 목록 / 데이터 구조)을 만들도록 나눠 보세요.',
      contexts: {
        '1': '당신은 PM입니다. 신입사원 온보딩 체크리스트 앱의 핵심 기능 3가지를 5줄 이내로 제안하세요.',
        '2': '앞선 기획을 구현하는 데 필요한 데이터 구조(주요 항목과 관계)를 3줄로 요약하세요.',
      },
    },
    {
      id: 'safe-pay',
      title: '중고거래 안전 결제: 제안 → 위험 지적',
      summary: '두 번째 노드를 비판자 역할로 씁니다.',
      observe: '뒤 노드를 "검토자/비판자"로 두면 앞 노드의 제안이 어떻게 걸러지는지 볼 수 있습니다.',
      contexts: {
        '1': '당신은 PM입니다. 동네 중고거래의 안전 결제 기능을 5줄 이내로 제안하세요.',
        '2': '앞선 제안을 사기 방지 관점에서 검토해 구현 시 위험 3가지를 한 줄씩 지적하세요.',
      },
    },
  ],

  step4: [
    {
      id: 'loop-basic',
      title: '기획안이 승인될 때까지 보완',
      summary: '개발자가 [승인]을 쓰면 종료, 아니면 보완을 요청합니다.',
      observe: '승인 조건이 느슨하면 한 번에 끝납니다. 아래 "엄격한 승인 조건"과 호출 횟수를 비교해 보세요.',
      contexts: {
        '1': '당신은 PM입니다. 주제는 "동네 도서관 도서 추천 챗봇"입니다. 기획안(사용자·핵심 기능·기술 스택)을 5줄 이내로 쓰고, 개발자의 보완 요청이 있으면 그 부분을 반영해 고쳐 쓰세요.',
        '2': '당신은 개발자입니다. 기획안에 사용자·핵심 기능·기술 스택이 모두 있으면 첫 줄에 [승인] 이라고만 쓰세요. 부족하면 [승인]을 쓰지 말고 부족한 점 2가지를 들어 보완을 요청하세요.',
      },
    },
    {
      id: 'loop-kpi',
      title: '엄격한 승인 조건 (측정 목표 필수)',
      summary: '"측정 가능한 목표"가 있어야만 승인하게 해 왕복을 유도합니다.',
      observe: '승인 조건이 까다로울수록 되돌림이 늘고 호출(비용)도 늘어납니다. 최대 3왕복에서 멈춥니다.',
      contexts: {
        '1': '당신은 PM입니다. 주제는 "동네 도서관 도서 추천 챗봇"입니다. 기획안을 5줄 이내로 쓰고, 개발자가 요청한 보완은 반드시 반영해 고쳐 쓰세요.',
        '2': '당신은 깐깐한 개발자입니다. 기획안에 "숫자로 측정 가능한 목표(예: 월 이용자 500명)"가 있을 때만 첫 줄에 [승인] 이라고만 쓰세요. 없으면 [승인]을 쓰지 말고 구체적인 목표를 넣도록 요청하세요.',
      },
    },
    {
      id: 'loop-slogan',
      title: '앱 소개 문구 다듬기',
      summary: '짧은 문구를 조건(숫자 포함·느낌표로 끝남)에 맞을 때까지 고칩니다.',
      observe: '결과물이 짧아 호출 비용이 작은 루프 연습입니다. 조건을 바꿔(예: 이모지 금지) 실험해 보세요.',
      contexts: {
        '1': '당신은 PM입니다. "동네 도서관 도서 추천 챗봇"의 앱 소개 문구를 한 줄로 쓰세요. 개발자의 수정 요청이 있으면 반영해 다시 쓰세요.',
        '2': '당신은 개발자입니다. 소개 문구에 숫자가 들어 있고 느낌표(!)로 끝나면 첫 줄에 [승인] 이라고만 쓰세요. 아니면 [승인]을 쓰지 말고 어느 조건이 부족한지 한 줄로 알려 주세요.',
      },
    },
  ],

  step5: [
    {
      id: 'eval-slogan',
      title: '소개 문구 다듬기 (통과할 때까지)',
      summary: '작성자가 쓰고 평가자가 "통과"/"재작성"으로 판정합니다. 통과하면 END, 아니면 작성자로 되돌아갑니다.',
      observe: '종료를 결정하는 것은 평가자의 판정입니다. 평가자의 "부족한 점" 한 줄이 작성자의 다음 수정 방향이 됩니다. 기준을 바꾸면 되돌림 횟수가 달라집니다. Step 7의 "사람이 루프를 승인"은 같은 주제에서 판정자만 사람으로 바꾼 짝입니다.',
      flow: ['START', '작성자', '평가자', '통과 → END', '재작성 ↺ 작성자'],
      flowNote: '평가자 답변에 "통과"가 있으면 끝, 아니면 작성자에게 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '"동네 도서관 도서 추천 챗봇" 앱 소개 문구를 한 줄로 쓰세요. 평가자가 부족한 점을 알려 주면 그 점만 고쳐 다시 쓰세요. 문구만 출력하세요.' },
          { id: 'ev', label: '에이전트 (평가자)', x: 400, y: 120, context: '앞선 문구를 평가하세요. 기준: 숫자가 들어 있고 느낌표(!)로 끝남. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재작성", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재작성일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'end', label: '__end__', x: 780, y: 120 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-ev', source: 'wr', target: 'ev' },
          { id: 'ev-end', source: 'ev', target: 'end', label: '통과' },
          { id: 'ev-wr', source: 'ev', target: 'wr', label: '재작성', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
        ],
      },
    },
    {
      id: 'eval-mail',
      title: '사과 이메일 다듬기',
      summary: '평가 기준을 "존댓말 + 사과 + 재발 방지"로 둡니다.',
      observe: '기준이 여러 개일수록 통과가 어려워집니다. 기준 하나를 빼서 비교해 보세요.',
      flow: ['START', '작성자', '평가자', '통과 → END', '재작성 ↺ 작성자'],
      flowNote: '평가자 답변에 "통과"가 있으면 끝, 아니면 작성자에게 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '회의에 지각한 것을 사과하는 이메일 본문을 3문장 이내로 쓰세요. 평가자가 부족한 점을 알려 주면 그 점을 고쳐 다시 쓰세요. 본문만 출력하세요.' },
          { id: 'ev', label: '에이전트 (평가자)', x: 400, y: 120, context: '앞선 이메일을 평가하세요. 기준: 존댓말이고, 사과와 재발 방지 약속이 모두 포함. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재작성", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재작성일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'end', label: '__end__', x: 780, y: 120 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-ev', source: 'wr', target: 'ev' },
          { id: 'ev-end', source: 'ev', target: 'end', label: '통과' },
          { id: 'ev-wr', source: 'ev', target: 'wr', label: '재작성', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
        ],
      },
    },
    {
      id: 'eval-code',
      title: '파이썬 함수 코드 리뷰 루프',
      summary: '타입 힌트와 docstring을 갖출 때까지 고칩니다.',
      observe: '코드처럼 검사하기 쉬운 기준은 판정이 안정적입니다. 모호한 기준("좋은 코드")과 비교해 보세요.',
      flow: ['START', '작성자', '리뷰어', '통과 → END', '재작성 ↺ 작성자'],
      flowNote: '리뷰어 답변에 "통과"가 있으면 끝, 아니면 작성자에게 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '정수 n이 짝수인지 판별하는 파이썬 함수 is_even을 가장 간단하게 작성하세요. 리뷰어가 부족한 점을 알려 주면 그 점을 고쳐 다시 쓰세요. 코드만 출력하세요.' },
          { id: 'ev', label: '에이전트 (리뷰어)', x: 400, y: 120, context: '앞선 코드를 평가하세요. 기준: 타입 힌트와 docstring이 모두 있음. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재작성", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재작성일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'end', label: '__end__', x: 780, y: 120 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-ev', source: 'wr', target: 'ev' },
          { id: 'ev-end', source: 'ev', target: 'end', label: '통과' },
          { id: 'ev-wr', source: 'ev', target: 'wr', label: '재작성', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
        ],
      },
    },
  ],

  step6: [
    {
      id: 'ticket',
      title: '고객 접수 분류 + 수정 검증 루프',
      summary: '"버그"면 개발자가 고치고 검증자가 통과시킬 때까지 반복, "문의"면 바로 답하고 끝납니다.',
      observe: '분기(분류기)와 루프(수정↔검증)가 한 그래프에 함께 있습니다. 어느 경로를 탔는지 결과 패널의 노드 순서로 확인하세요.',
      flow: ['START', '분류기', '버그 → 개발자 ↔ 검증자', '문의 → 답변', 'END'],
      flowNote: '분류기 결과(버그/문의)로 갈라지고, 버그 경로는 검증자가 "통과"할 때까지 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 190 },
          { id: 'cls', label: '에이전트 (분류기)', x: 0, y: 190, context: '다음 고객 접수를 분류하세요: "앱에서 결제 버튼을 누르면 화면이 멈춥니다." 다른 말 없이 "버그" 또는 "문의" 한 단어만 쓰세요.' },
          { id: 'fix', label: '에이전트 (개발자)', x: 400, y: 40, context: '고객 접수: "앱에서 결제 버튼을 누르면 화면이 멈춥니다." 원인 추정과 수정 방법을 3줄로 쓰세요. 검증자가 부족한 점을 알려 주면 반영해 다시 쓰세요.' },
          { id: 'chk', label: '에이전트 (검증자)', x: 800, y: 40, context: '앞선 수정안을 평가하세요. 기준: 원인 추정과 수정 방법이 모두 포함. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재수정", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재수정일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'faq', label: '에이전트 (답변)', x: 400, y: 380, context: '고객 문의에 정중하게 두 문장으로 답하세요.' },
          { id: 'end', label: '__end__', x: 1180, y: 190 },
        ],
        edges: [
          { id: 's-cls', source: 'start', target: 'cls' },
          { id: 'cls-fix', source: 'cls', target: 'fix', label: '버그' },
          { id: 'cls-faq', source: 'cls', target: 'faq', label: '문의' },
          { id: 'fix-chk', source: 'fix', target: 'chk' },
          { id: 'chk-end', source: 'chk', target: 'end', label: '통과' },
          { id: 'chk-fix', source: 'chk', target: 'fix', label: '재수정', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'faq-end', source: 'faq', target: 'end' },
        ],
      },
    },
    {
      id: 'review-reply',
      title: '후기 응답: 부정이면 사과문 검수 루프',
      summary: '긍정은 감사 인사로 바로 끝, 부정은 사과문을 검수가 통과시킬 때까지 고칩니다.',
      observe: '같은 구조에서 입력(후기)만 긍정으로 바꿔 보세요. 경로가 어떻게 달라지는지 비교할 수 있습니다.',
      flow: ['START', '분류기', '긍정 → 감사', '부정 → 사과 ↔ 검수', 'END'],
      flowNote: '부정 경로는 검수가 "통과"할 때까지 사과문을 다시 씁니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 190 },
          { id: 'cls', label: '에이전트 (분류기)', x: 0, y: 190, context: '다음 고객 후기의 감정을 판단하세요: "배송이 너무 늦고 포장이 찢어져 왔어요." 다른 말 없이 "긍정" 또는 "부정" 한 단어만 쓰세요.' },
          { id: 'sorry', label: '에이전트 (사과문)', x: 400, y: 40, context: '불만 고객에게 사과하고 환불 절차를 안내하는 답을 두 문장으로 쓰세요. 검수가 부족한 점을 알려 주면 반영해 다시 쓰세요.' },
          { id: 'qa', label: '에이전트 (검수)', x: 800, y: 40, context: '앞선 사과문을 평가하세요. 기준: 사과 표현과 환불 안내가 모두 포함. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재작성", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재작성일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'thanks', label: '에이전트 (감사)', x: 400, y: 380, context: '고객 후기에 대한 감사 인사를 두 문장으로 쓰세요.' },
          { id: 'end', label: '__end__', x: 1180, y: 190 },
        ],
        edges: [
          { id: 's-cls', source: 'start', target: 'cls' },
          { id: 'cls-sorry', source: 'cls', target: 'sorry', label: '부정' },
          { id: 'cls-thanks', source: 'cls', target: 'thanks', label: '긍정' },
          { id: 'sorry-qa', source: 'sorry', target: 'qa' },
          { id: 'qa-end', source: 'qa', target: 'end', label: '통과' },
          { id: 'qa-sorry', source: 'qa', target: 'sorry', label: '재작성', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'thanks-end', source: 'thanks', target: 'end' },
        ],
      },
    },
  ],

  step7: [
    {
      id: 'hitl-loop-slogan',
      title: '사람이 루프를 승인 (소개 문구)',
      summary: '작성자가 쓰면 매 라운드 사람이 "승인"하거나 "수정 의견"을 줍니다. AI 평가자 없이 사람이 판정자입니다.',
      observe: 'Step 5와 같은 주제에서 판정자만 AI → 사람으로 바뀐 짝입니다. 루프를 끝내는 것은 오직 사람의 "승인"이고, AI 평가 호출이 없어 비용은 적습니다. 대신 매 라운드 사람의 응답이 필요합니다.',
      flow: ['START', '작성자', '👤 사람 승인', 'END'],
      flowNote: '사람이 "승인"해야 끝나고, "수정"이면 의견을 담아 작성자에게 되돌아갑니다 (매 라운드 확인)',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '"동네 도서관 도서 추천 챗봇" 앱 소개 문구를 한 줄로 쓰세요. 사람이 수정 의견을 주면 그 점만 고쳐 다시 쓰세요. 문구만 출력하세요.' },
          { id: 'human', label: '__human__', x: 400, y: 135 },
          { id: 'end', label: '__end__', x: 620, y: 135 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-h', source: 'wr', target: 'human' },
          { id: 'h-wr', source: 'human', target: 'wr', label: '수정', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'h-end', source: 'human', target: 'end', label: '승인' },
        ],
      },
    },
    {
      id: 'hitl-mail',
      title: '이메일 초안을 사람이 검토 (발송 전 승인)',
      summary: 'AI가 초안을 쓰면 사람이 보고 승인하거나 수정 의견을 줍니다. (실제 발송은 하지 않습니다)',
      observe: '중요한 행동(발송·결제 등) 앞에 사람 승인을 두는 가장 흔한 사용법입니다. 수정 의견을 구체적으로 줄수록 다음 초안이 달라집니다.',
      flow: ['START', '작성자', '👤 사람 승인', 'END'],
      flowNote: '"승인"이면 끝, "수정"이면 의견을 담아 작성자에게 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '회의에 지각한 것을 사과하는 이메일 본문을 3문장 이내로 쓰세요. 사람이 수정 의견을 주면 그 점을 반영해 다시 쓰세요. 본문만 출력하세요.' },
          { id: 'human', label: '__human__', x: 400, y: 135 },
          { id: 'end', label: '__end__', x: 620, y: 135 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-h', source: 'wr', target: 'human' },
          { id: 'h-wr', source: 'human', target: 'wr', label: '수정', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'h-end', source: 'human', target: 'end', label: '승인' },
        ],
      },
    },
    {
      id: 'hitl-plan',
      title: '기획 → 기술 검토 → 사람이 한 바퀴를 승인',
      summary: '기획자와 개발자의 한 바퀴 결과를 사람이 보고 결정합니다. 수정 의견은 기획자에게 전달됩니다.',
      observe: '여러 에이전트가 거친 한 바퀴 전체를 사람이 승인 단위로 삼습니다. 의견을 바꿔 가며 다음 바퀴의 기획이 어떻게 달라지는지 비교해 보세요.',
      flow: ['START', '기획자', '개발자', '👤 사람 승인', 'END'],
      flowNote: '사람이 "수정" 의견을 주면 기획자부터 다시 시작합니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'pm', label: '에이전트 (기획자)', x: 0, y: 120, context: '당신은 PM입니다. 주제는 "동네 도서관 도서 추천 챗봇"입니다. 기획안을 5줄 이내로 쓰고, 사람의 수정 의견이 있으면 그것을 반영해 다시 쓰세요.' },
          { id: 'dev', label: '에이전트 (개발자)', x: 400, y: 120, context: '앞선 기획을 구현할 기술 스택을 3줄로 요약하세요.' },
          { id: 'human', label: '__human__', x: 800, y: 135 },
          { id: 'end', label: '__end__', x: 1020, y: 135 },
        ],
        edges: [
          { id: 's-pm', source: 'start', target: 'pm' },
          { id: 'pm-dev', source: 'pm', target: 'dev' },
          { id: 'dev-h', source: 'dev', target: 'human' },
          { id: 'h-pm', source: 'human', target: 'pm', label: '수정', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'h-end', source: 'human', target: 'end', label: '승인' },
        ],
      },
    },
    {
      id: 'hitl-hybrid',
      title: 'AI 루프 + 사람 최종 관문 (혼합형)',
      summary: 'AI 평가자가 "통과"시킬 때까지 루프를 돌고, 통과한 결과만 사람이 마지막에 확인합니다.',
      observe: '루프의 반복은 AI가, 최종 결정은 사람이 합니다. 위 "사람이 루프를 승인"과 비교하면 사람의 개입 횟수가 줄어드는 대신 중간 과정은 AI에 맡기게 됩니다.',
      flow: ['START', '작성자', 'AI 평가자', '👤 사람 최종 관문', 'END'],
      flowNote: 'AI가 통과시켜도 사람이 "수정"을 고르면 작성자로 되돌아갑니다',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: -170, y: 120 },
          { id: 'wr', label: '에이전트 (작성자)', x: 0, y: 120, context: '"동네 도서관 도서 추천 챗봇" 앱 소개 문구를 한 줄로 쓰세요. 평가자나 사람이 의견을 주면 그 점만 고쳐 다시 쓰세요. 문구만 출력하세요.' },
          { id: 'ev', label: '에이전트 (평가자)', x: 400, y: 120, context: '앞선 문구를 평가하세요. 기준: 숫자가 들어 있고 느낌표(!)로 끝남. 모두 만족하면 "통과" 한 단어만 쓰세요. 아니면 첫 줄에 "재작성", 둘째 줄에 부족한 점을 한 줄로 쓰세요. (재작성일 때는 "통과"라는 단어를 쓰지 마세요)' },
          { id: 'human', label: '__human__', x: 800, y: 135 },
          { id: 'end', label: '__end__', x: 1020, y: 135 },
        ],
        edges: [
          { id: 's-wr', source: 'start', target: 'wr' },
          { id: 'wr-ev', source: 'wr', target: 'ev' },
          { id: 'ev-h', source: 'ev', target: 'human', label: '통과' },
          { id: 'ev-wr', source: 'ev', target: 'wr', label: '재작성', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 } },
          { id: 'h-wr', source: 'human', target: 'wr', label: '수정', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 85, borderRadius: 14 } },
          { id: 'h-end', source: 'human', target: 'end', label: '승인' },
        ],
      },
    },
  ],

  free: [
    {
      id: 'free-basic',
      title: '스터디 카페 예약 앱 (기본 2노드)',
      summary: '가장 단순한 직선 연결입니다. 여기서 노드를 늘려 보세요.',
      observe: '노드를 추가하고 START/END를 연결해 보면서 "연결 구조"가 실행 순서가 되는 것을 확인하세요.',
      contexts: {
        '1': '당신은 PM입니다. 스터디 카페 좌석 예약 앱의 핵심 기능 3가지를 제안하세요.',
        '2': '앞선 기획의 구현 난이도를 상·중·하로 평가하고 이유를 한 줄로 쓰세요.',
      },
    },
    {
      id: 'free-three',
      title: '3단 파이프라인 (기획 → 개발 → 보안 리뷰)',
      flow: ['START', '기획자', '개발자', '보안 리뷰어', 'END'],
      flowNote: '앞 노드의 답변이 뒤 노드로 이어집니다',
      summary: 'START에서 시작해 세 노드를 거쳐 END로 끝납니다.',
      observe: '앞 노드의 답변이 뒤 노드로 계속 이어집니다. 마지막 노드가 앞선 모든 내용을 반영하는지 보세요.',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: 0, y: 40 },
          { id: 'pm', label: '에이전트 (기획자)', x: 0, y: 190, context: '당신은 PM입니다. 지역 축제 일정 알림 앱의 핵심 기능 3가지를 제안하세요.' },
          { id: 'dev', label: '에이전트 (개발자)', x: 400, y: 190, context: '앞선 기획을 구현하는 방법을 기술 스택 포함 3줄로 설명하세요.' },
          { id: 'sec', label: '에이전트 (보안 리뷰어)', x: 800, y: 190, context: '앞선 설계에서 개인정보·보안상 위험 2가지를 지적하고 대응책을 한 줄씩 쓰세요.' },
          { id: 'end', label: '__end__', x: 800, y: 40 },
        ],
        edges: [
          { id: 's-pm', source: 'start', target: 'pm' },
          { id: 'pm-dev', source: 'pm', target: 'dev' },
          { id: 'dev-sec', source: 'dev', target: 'sec' },
          { id: 'sec-end', source: 'sec', target: 'end' },
        ],
      },
    },
    {
      id: 'free-branch',
      title: '조건부 분기 (후기 감정에 따라 다른 응답)',
      flow: ['START', '분류기', '긍정 또는 부정 응답', 'END'],
      flowNote: '연결선 이름(긍정/부정)이 분류기 답변에 들어 있는 쪽으로 갑니다',
      summary: '분류기의 답변 속 단어("긍정"/"부정")에 따라 갈라집니다.',
      observe: '연결선 이름이 답변에 "포함"되는지로 길이 갈립니다. 분류기가 한 단어만 답하도록 지시한 이유를 생각해 보세요.',
      graph: {
        nodes: [
          { id: 'start', label: '__start__', x: 0, y: 190 },
          { id: 'cls', label: '에이전트 (분류기)', x: 380, y: 190, context: '다음 고객 후기의 감정을 판단하세요: "배송이 너무 늦고 포장이 찢어져 왔어요." 다른 말 없이 "긍정" 또는 "부정" 한 단어만 쓰세요.' },
          { id: 'pos', label: '에이전트 (감사 응답)', x: 800, y: 40, context: '고객 후기에 대한 감사 인사를 두 문장으로 쓰세요.' },
          { id: 'neg', label: '에이전트 (사과 응답)', x: 800, y: 340, context: '불만을 남긴 고객에게 사과하고 환불 절차를 안내하는 답을 두 문장으로 쓰세요.' },
          { id: 'end', label: '__end__', x: 1180, y: 190 },
        ],
        edges: [
          { id: 's-cls', source: 'start', target: 'cls' },
          { id: 'cls-pos', source: 'cls', target: 'pos', label: '긍정' },
          { id: 'cls-neg', source: 'cls', target: 'neg', label: '부정' },
          { id: 'pos-end', source: 'pos', target: 'end' },
          { id: 'neg-end', source: 'neg', target: 'end' },
        ],
      },
    },
  ],
};

// 단계의 기본(첫 번째) 시나리오
export const defaultScenario = (mode) => (SCENARIOS[mode] || SCENARIOS.free)[0];

// 시나리오 구상 4단계 (매뉴얼과 패널의 안내 문구)
export const DESIGN_STEPS = [
  { title: '목표 정하기', desc: '무엇을 알아내거나 만들고 싶은지 한 문장으로 적습니다. (예: 후기 감정에 따라 다른 답을 하는 흐름)' },
  { title: '역할(노드) 나누기', desc: '일을 몇 명의 역할로 나눌지 정합니다. 역할마다 하는 일이 하나여야 지시가 선명해집니다.' },
  { title: '입력과 지시 쓰기', desc: '노드의 컨텍스트에 "무엇을, 어떤 형식으로" 쓰게 할지 적습니다. 길이·형식·종료 조건을 구체적으로 쓸수록 결과가 안정됩니다.' },
  { title: '연결과 종료 조건', desc: '노드를 순서대로 잇고, 분기나 되돌림이 있다면 판단 기준(연결선 이름, [승인] 같은 표시)을 지시에 넣습니다.' },
];
