// ManualModal.jsx
// ---------------
// 사용 매뉴얼 팝업. 헤더의 '📖 매뉴얼' 버튼(또는 도움말 풍선의 링크)으로 연다.
// 왼쪽 목차 / 오른쪽 본문 구조이며, 내용은 아래 SECTIONS 배열에서 관리한다.
// 주의: 내용은 실제 동작(App.jsx, FlowEditor.jsx, localFlowRunner.js, backend/dashboard_main.py)을 기준으로 적었다.
//       동작을 바꾸면 이 설명도 함께 고쳐야 한다.
import React, { useState } from 'react';
import { SCENARIOS, DESIGN_STEPS } from '../scenarios';

// 노드 이름 칩 (연결 구조 그림용)
const Chip = ({ children, tone = 'indigo' }) => {
  const tones = {
    indigo: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    green: 'bg-green-500/20 text-green-300 border-green-500/30',
    purple: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    orange: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    red: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-bold ${tones[tone]}`}>{children}</span>;
};

// 연결 구조 한 줄: [노드] → [노드] → ...  (loop=true면 마지막에 되돌림 표시)
const Flow = ({ items, loop }) => (
  <div className="flex flex-wrap items-center gap-2 my-2">
    {items.map((it, i) => (
      <React.Fragment key={i}>
        <Chip tone={it.tone}>{it.name}</Chip>
        {i < items.length - 1 && <span className="text-slate-400 font-bold">→</span>}
      </React.Fragment>
    ))}
    {loop && <span className="text-xs text-purple-400 font-bold">↺ {loop}</span>}
  </div>
);

const H = ({ children }) => <h3 className="text-sm font-bold text-slate-100 mt-5 mb-2 first:mt-0">{children}</h3>;
const P = ({ children }) => <p className="text-sm text-slate-300 leading-relaxed mb-2">{children}</p>;
const Li = ({ children }) => <li className="text-sm text-slate-300 leading-relaxed">{children}</li>;
const Note = ({ children, tone = 'info' }) => (
  <div className={`text-xs leading-relaxed rounded-lg border px-3 py-2 my-3 ${tone === 'warn' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-300'}`}>
    {children}
  </div>
);

const SECTIONS = [
  {
    id: 'start',
    title: '1. 시작하기',
    body: (
      <>
        <H>5단계로 첫 실행</H>
        <ol className="list-decimal pl-5 space-y-1.5">
          <Li><b>API 키 준비</b>: 오른쪽 위 ⚙ 설정에 Gemini · DeepSeek · OpenAI 중 쓸 키를 입력합니다. 백엔드 모드는 서버의 <code>.env</code> 키도 쓸 수 있습니다.</Li>
          <Li><b>실행 모드 선택</b>: <b>로컬</b>은 브라우저가 직접 LLM을 호출하고(입력한 키 필수), <b>백엔드</b>는 FastAPI 서버가 호출합니다.</Li>
          <Li><b>실습 단계 선택</b>: 상단에서 LangChain 또는 LangGraph 탭을 고른 뒤 단계를 고릅니다. 처음에는 <b>Step 1</b>(호출 1번)이 가장 간단합니다.</Li>
          <Li><b>그래프 확인·편집</b>: 단계마다 기본 그래프가 채워집니다. 그대로 실행해도 됩니다.</Li>
          <Li><b>실행</b>: 왼쪽 패널의 실행 버튼을 누르면 오른쪽에 결과가 한 줄씩 나타납니다.</Li>
        </ol>
        <Note>호출 횟수만큼 API 비용이 듭니다. Step 4와 자유 설계는 여러 번 호출하므로 먼저 Step 1로 키가 동작하는지 확인하세요.</Note>
      </>
    ),
  },
  {
    id: 'screen',
    title: '2. 화면 구성',
    body: (
      <>
        <H>세 영역</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>상단 헤더</b>: 학습 범위(LangChain / LangGraph, 실습 단계), 서버 상태(ONLINE/OFFLINE), 실행 모드, 테마(🌙/☀️), 도움말(?), 매뉴얼(📖), 설정(⚙).</Li>
          <Li><b>왼쪽 학습 패널</b>: 현재 단계의 설명, <b>연결 구조</b>(기본 구조와 지금 그려진 연결 목록), 노드 추가 버튼, 실행·중지 버튼.</Li>
          <Li><b>가운데 캔버스</b>: 노드와 연결선을 그리는 곳입니다. 드래그로 이동하고, 휠로 확대·축소합니다. 왼쪽 아래 버튼의 ⛶ 은 전체 맞춤입니다.</Li>
          <Li><b>오른쪽 결과 패널</b>: 실행 로그. 로컬 모드는 브라우저가, 백엔드 모드는 WebSocket으로 받은 메시지를 보여 줍니다.</Li>
        </ul>
        <H>서버 상태</H>
        <P>헤더의 <b>ONLINE</b>은 백엔드(<code>python dashboard_main.py</code>)가 켜져 있다는 뜻입니다. OFFLINE이면 백엔드 모드를 쓸 수 없고, 로컬 모드만 가능합니다. 실행 중에 서버가 꺼지면 자동으로 로컬 모드로 바뀝니다.</P>
      </>
    ),
  },
  {
    id: 'nodes',
    title: '3. 노드',
    body: (
      <>
        <H>노드란</H>
        <P>노드는 "역할 하나"를 맡은 칸입니다. 실행하면 노드 이름(역할)과 지시사항을 담아 LLM을 한 번 호출하고, 그 답을 다음 노드로 넘깁니다.</P>
        <H>노드 종류</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>LangChain 탭</b>: <Chip tone="green">프롬프트</Chip> <Chip tone="indigo">모델</Chip> <Chip tone="orange">파서</Chip> — 왼쪽 패널의 컴포넌트 추가 버튼으로 만듭니다.</Li>
          <Li><b>LangGraph 탭</b>: <Chip tone="purple">에이전트</Chip>(LLM 호출), <Chip tone="green">START</Chip>(시작 표시), <Chip tone="red">END</Chip>(끝 표시), 기능(validate 등 보조 노드).</Li>
        </ul>
        <Note>START/END 노드는 LLM을 호출하지 않는 "표시"(작은 알약 모양)입니다. 에이전트 노드만 호출됩니다. 예제 시나리오를 고르면 START/END가 항상 함께 표시됩니다. Step 0~2·4는 연결선이 아니라 노드 이름/ID로 실행되므로 이 단계의 START/END는 구조를 이해하기 위한 표시입니다.</Note>
        <H>노드 카드의 버튼</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>카드 클릭</b>: 이 노드를 LangChain 코드로 옮긴 예시를 보여 줍니다(보기용).</Li>
          <Li><b>✏ 편집</b>: 이름, 제공자(Gemini/DeepSeek/OpenAI), 모델, 컨텍스트를 바꿉니다. 오른쪽에 코드 미리보기가 즉시 바뀝니다.</Li>
          <Li><b>✕ 삭제</b>: 노드와 거기 연결된 선을 함께 지웁니다.</Li>
          <Li><b>배지에 마우스</b>: 노드 역할 설명이 뜹니다.</Li>
        </ul>
        <H>노드 속성</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>이름(역할)</b>: 시스템 프롬프트에 "당신은 ○○ 역할"로 들어갑니다. <b>Step 0~2는 이 이름의 키워드(프롬프트·모델·파서·기획·개발·멘토 등)로 노드를 찾습니다.</b> 이름을 크게 바꾸면 다른 노드가 선택될 수 있습니다.</Li>
          <Li><b>제공자 / 모델</b>: 노드마다 다르게 정할 수 있어 Gemini와 DeepSeek를 섞어 쓸 수 있습니다. DeepSeek의 <code>reasoner</code>는 느리고 비용이 더 듭니다.</Li>
          <Li><b>컨텍스트</b>: 지시사항입니다. Step 0은 프롬프트 노드의 컨텍스트가 "주제", Step 1·2는 첫 노드의 컨텍스트가 "질문/요청"으로 쓰입니다.</Li>
        </ul>
      </>
    ),
  },
  {
    id: 'edges',
    title: '4. 노드 연결 (엣지)',
    body: (
      <>
        <H>연결 방법</H>
        <ol className="list-decimal pl-5 space-y-1.5">
          <Li>노드의 <b>오른쪽 점</b>(출력)에 마우스를 올리고 누른 채로 끕니다.</Li>
          <Li>다른 노드의 <b>왼쪽 점</b>(입력)에서 놓으면 연결선이 생깁니다. 기본 이름은 <code>EDGE</code>입니다.</Li>
          <Li>연결선을 <b>더블클릭</b>하면 삭제됩니다. 지금 연결된 목록은 왼쪽 패널의 <b>연결 구조</b>에서 보고 ✕ 로도 지울 수 있습니다.</Li>
        </ol>
        <Flow items={[{ name: 'A 노드', tone: 'indigo' }, { name: 'B 노드', tone: 'purple' }]} />
        <P>화살표 방향이 실행 순서입니다. A의 답변이 B의 입력이 됩니다.</P>
        <H>아래쪽 점 (되돌림)</H>
        <P>노드 아래의 <b>보라색 점 두 개</b>는 "앞 노드로 되돌아가는" 연결(루프)용입니다. Step 4의 "보완 요청"이 이 점을 씁니다. 오른쪽 점으로 되돌리면 선이 노드 글자를 가로지르므로 아래쪽 점을 쓰세요.</P>
        <H>실행 규칙 (자유 설계·Step 3·4)</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li><b>시작점</b>: START 노드에 연결된 노드. START가 없으면 "들어오는 연결이 없는 노드"에서 시작합니다.</Li>
          <Li><b>끝</b>: END에 연결되거나, 나가는 연결이 없는 노드에서 끝납니다.</Li>
          <Li><b>한 노드에서 선이 둘 이상</b>(분기): 이전 답변에 <b>연결선 이름이 들어 있으면</b> 그 선을 따라갑니다. 해당이 없으면 첫 번째 선으로 갑니다. (이름은 화면에서 바꿀 수 없고 기본값은 <code>EDGE</code>)</Li>
          <Li><b>무한 반복 방지</b>: 로컬은 최대 10번, 백엔드는 LangGraph의 <code>recursion_limit=20</code>에서 멈춥니다.</Li>
        </ul>
        <Note tone="warn">연결선이 없는 노드는 순서가 정해지지 않습니다. 왼쪽 패널의 연결 구조에 "연결 안 된 노드"로 표시되니 확인하세요.</Note>
      </>
    ),
  },
  {
    id: 'steps',
    title: '5. 단계별 연결 가이드',
    body: (
      <>
        <H>Step 0 — LCEL 체인 기초 (LangChain)</H>
        <Flow items={[{ name: '프롬프트', tone: 'green' }, { name: '언어 모델', tone: 'indigo' }, { name: '출력 파서', tone: 'orange' }]} />
        <P>LLM 호출은 <b>모델 노드에서 1번</b>입니다. 프롬프트·파서 단계는 흐름을 보여 주는 설명입니다. 이 단계는 그린 연결선이 아니라 <b>노드 이름의 키워드</b>로 순서가 정해집니다.</P>
        <H>Step 1 — 단일 에이전트</H>
        <Flow items={[{ name: '에이전트 1개', tone: 'purple' }]} />
        <P>노드 하나에 질문(컨텍스트)을 보내고 답을 받습니다. 연결선이 필요 없습니다.</P>
        <H>Step 2 — 순차 체이닝</H>
        <Flow items={[{ name: '기획자', tone: 'purple' }, { name: '개발자', tone: 'indigo' }]} />
        <P>기획자의 답변이 개발자의 입력이 됩니다(LLM 2회). 이 단계도 이름 키워드(기획·개발)로 찾으니 이름을 유지하세요.</P>
        <H>Step 3 — LangGraph 기초</H>
        <Flow items={[{ name: '기획자', tone: 'purple' }, { name: '개발자', tone: 'indigo' }]} />
        <P>상태(State)가 노드 사이로 전달됩니다. <b>로컬 모드</b>는 기획자→개발자 순서로 고정, <b>백엔드 모드</b>는 그린 연결을 그대로 LangGraph로 실행합니다.</P>
        <H>Step 4 — 루프와 라우팅</H>
        <Flow items={[{ name: '기획자', tone: 'purple' }, { name: '개발자', tone: 'indigo' }]} loop="보완 요청 (아래쪽 점)" />
        <P>개발자가 답변에 <b>[승인]</b>을 쓰면 끝나고, 아니면 기획자에게 되돌아갑니다. 최대 3왕복(노드 6회)입니다.</P>
        <Note>Step 4의 <b>[승인]</b>은 사람이 아니라 <b>개발자 노드(AI)가 쓰는 판정 문구</b>입니다. 사람이 직접 승인하는 단계는 Step 7(사람 승인 노드)입니다.</Note>
        <Note tone="warn">백엔드 모드의 Step 4는 노드 ID가 <b>"1"(기획자), "2"(개발자)</b>여야 동작합니다. 노드를 지우고 새로 만들면 ID가 바뀌어 일반 경로로 실행됩니다. 로컬 모드의 종료 판정은 "승인"이 들어 있기만 해도 끝납니다.</Note>
        <H>Step 5 — 평가-개선 루프</H>
        <Flow items={[{ name: '작성자', tone: 'purple' }, { name: '평가자', tone: 'indigo' }, { name: '통과 → END', tone: 'green' }]} loop="재작성 → 작성자 (아래쪽 점)" />
        <P>평가자가 <b>"통과"</b> 한 단어를 쓰면 END로 끝나고, <b>"재작성"</b>이면 작성자에게 되돌아갑니다. 종료를 정하는 것은 <b>연결선 이름</b>이라서 평가자가 한 단어만 쓰게 지시해야 합니다.</P>
        <Note tone="warn">연결선 이름끼리 서로 포함되면 안 됩니다. ("합격"과 "불합격"은 "불합격"에 "합격"이 들어 있어 잘못 갈라집니다.) 끝나지 않으면 로컬은 10번, 백엔드는 20단계에서 멈추고 안내 메시지가 나옵니다.</Note>
        <H>Step 6 — 분기 + 루프 결합</H>
        <Flow items={[{ name: '분류기', tone: 'orange' }, { name: '버그 → 개발자 ↔ 검증자', tone: 'purple' }, { name: '문의 → 답변', tone: 'indigo' }]} />
        <P>분류기의 한 단어(버그/문의)로 길이 갈리고, 한 길에는 수정↔검증 루프가 있습니다. 결과 패널에 나오는 노드 순서로 어느 경로를 탔는지 확인하세요.</P>
        <H>Step 7 — 사람 승인 (HITL)</H>
        <Flow items={[{ name: '작성자', tone: 'purple' }, { name: 'AI 평가자', tone: 'indigo' }, { name: '👤 사람 승인', tone: 'orange' }, { name: 'END', tone: 'red' }]} loop="수정 → 작성자 (아래쪽 점)" />
        <P>실행이 <b>사람 승인 노드에서 멈추고</b>, 결과 패널의 승인 카드에서 <b>승인 / 수정 요청 / 중단</b>을 고르면 이어집니다. 자세한 내용은 <b>10번</b>을 보세요.</P>
        <H>자유 설계</H>
        <Flow items={[{ name: 'START', tone: 'green' }, { name: '에이전트 …', tone: 'purple' }, { name: 'END', tone: 'red' }]} />
        <P>노드를 마음대로 추가하고 연결합니다. 위 "실행 규칙"이 그대로 적용됩니다. 순환(되돌림)을 만들면 최대 횟수까지 계속 호출하므로 비용에 주의하세요.</P>
      </>
    ),
  },
  {
    id: 'run',
    title: '6. 실행과 API 키',
    body: (
      <>
        <H>로컬 모드와 백엔드 모드</H>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-slate-300 border-collapse">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="py-1.5 pr-3 border-b border-slate-700">항목</th>
                <th className="py-1.5 pr-3 border-b border-slate-700">로컬</th>
                <th className="py-1.5 border-b border-slate-700">백엔드</th>
              </tr>
            </thead>
            <tbody>
              <tr><td className="py-1.5 pr-3 border-b border-slate-800">호출 주체</td><td className="pr-3 border-b border-slate-800">브라우저</td><td className="border-b border-slate-800">FastAPI 서버(LangGraph)</td></tr>
              <tr><td className="py-1.5 pr-3 border-b border-slate-800">API 키</td><td className="pr-3 border-b border-slate-800">⚙ 설정 입력 필수</td><td className="border-b border-slate-800">설정 입력 또는 서버 <code>.env</code></td></tr>
              <tr><td className="py-1.5 pr-3 border-b border-slate-800">서버 필요</td><td className="pr-3 border-b border-slate-800">없음</td><td className="border-b border-slate-800">필요 (ONLINE)</td></tr>
              <tr><td className="py-1.5 pr-3">키 노출</td><td className="pr-3">브라우저 저장, 요청 주소에 포함될 수 있음(Gemini)</td><td>서버 환경변수에 보관 가능</td></tr>
            </tbody>
          </table>
        </div>
        <H>API 키</H>
        <ul className="list-disc pl-5 space-y-1.5">
          <Li>⚙ 설정에 입력한 키는 <b>이 브라우저에 평문으로 저장</b>됩니다. 공용 PC에서는 사용하지 마세요.</Li>
          <Li>키가 없으면 가짜 응답 없이 <code>Error executing … API 키가 없습니다</code> 오류가 나옵니다.</Li>
          <Li>백엔드 모드는 프로젝트 루트 <code>.env</code>의 <code>GOOGLE_API_KEY</code> / <code>DEEPSEEK_API_KEY</code> / <code>OPENAI_API_KEY</code>를 읽습니다.</Li>
        </ul>
        <H>중지</H>
        <P>실행 중에는 같은 위치의 버튼이 <b>중지</b>로 바뀝니다. 이미 요청한 LLM 호출의 과금은 취소되지 않을 수 있습니다.</P>
      </>
    ),
  },
  {
    id: 'faq',
    title: '7. 문제 해결',
    body: (
      <>
        <H>자주 묻는 문제</H>
        <ul className="space-y-3">
          <Li><b>"API 키가 없습니다"가 나와요.</b><br />로컬 모드는 ⚙ 설정에 키를 입력해야 합니다. 백엔드 모드는 서버 <code>.env</code>에 키가 있는지, 노드의 제공자(Gemini/DeepSeek/OpenAI)와 키가 맞는지 확인하세요.</Li>
          <Li><b>서버가 OFFLINE이에요.</b><br />터미널에서 <code>cd 06_visual_dashboard/backend</code> 후 <code>python dashboard_main.py</code>를 실행하세요. 헤더에 5초마다 상태가 갱신됩니다.</Li>
          <Li><b>백엔드 모드 버튼이 눌리지 않아요.</b><br />서버가 ONLINE일 때만 선택할 수 있습니다.</Li>
          <Li><b>"Error executing …"가 나와요.</b><br />키가 잘못되었거나, 모델 이름이 맞지 않거나, 호출 한도·네트워크 문제입니다. 메시지 뒤쪽의 오류 내용을 확인하세요. Step 4는 이 오류가 나오면 바로 종료합니다.</Li>
          <Li><b>노드가 화면에서 안 보여요.</b><br />캔버스 왼쪽 아래 ⛶(전체 맞춤) 버튼을 누르세요. 단계를 바꾸면 기본 그래프로 다시 초기화됩니다.</Li>
          <Li><b>단계를 바꿨더니 편집한 내용이 사라졌어요.</b><br />단계를 바꾸면 그 단계의 기본 그래프로 다시 시작합니다. 편집은 저장되지 않습니다.</Li>
          <Li><b>START/END가 호출되나요?</b><br />아니요. 시작과 끝을 표시할 뿐입니다.</Li>
          <Li><b>화면이 어두워서 보기 어려워요.</b><br />오른쪽 위 🌙/☀️ 버튼으로 라이트·다크를 전환하세요.</Li>
        </ul>
      </>
    ),
  },
];

// 8. 시나리오 구상하기: 구상 4단계 + 단계별 예제 목록 (예제는 scenarios.js에서 가져와 항상 화면과 일치)
const STEP_NAMES = { step0: 'Step 0 · LCEL 체인', step1: 'Step 1 · 단일 에이전트', step2: 'Step 2 · 순차 체이닝', step3: 'Step 3 · LangGraph 기초', step4: 'Step 4 · 루프와 라우팅', step5: 'Step 5 · 평가-개선 루프', step6: 'Step 6 · 분기 + 루프 결합', step7: 'Step 7 · 사람 승인(HITL)', free: '자유 설계' };
SECTIONS.push({
  id: 'design',
  title: '8. 시나리오 구상하기',
  body: (
    <>
      <P>왼쪽 패널의 <b>예제 시나리오</b>를 골라 적용하고 실행해 보면서, 마음에 드는 부분을 고쳐 나만의 시나리오를 만들 수 있습니다.</P>
      <H>구상하는 4단계</H>
      <ol className="list-decimal pl-5 space-y-1.5">
        {DESIGN_STEPS.map((d) => (<Li key={d.title}><b>{d.title}</b>: {d.desc}</Li>))}
      </ol>
      <Note>예제를 적용하면 캔버스가 그 구성으로 바뀌고 직접 편집한 내용은 사라집니다. 마음에 드는 편집은 따로 메모해 두세요(저장 기능은 없습니다).</Note>
      <H>단계별 예제 목록</H>
      <div className="space-y-4">
        {Object.entries(SCENARIOS).map(([step, list]) => (
          <div key={step}>
            <div className="text-xs font-bold text-indigo-400 mb-1.5">{STEP_NAMES[step]}</div>
            <ul className="space-y-1.5">
              {list.map((sc) => (
                <li key={sc.id} className="text-sm text-slate-300 leading-relaxed border-l-2 border-slate-700 pl-3">
                  <b className="text-slate-100">{sc.title}</b> — {sc.summary}
                  <div className="text-xs text-slate-500">👀 {sc.observe}</div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  ),
});

// 9. LangChain과 LangGraph의 차이 (자세한 설명). 내용은 이 프로젝트의 실제 구현(백엔드 LangGraph, 로컬 while 반복문)을 기준으로 적었다.
const Code = ({ children }) => (
  <pre className="bg-slate-800 border border-slate-700 rounded-lg p-3 my-2 text-xs font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">{children}</pre>
);

SECTIONS.push({
  id: 'compare',
  title: '9. LangChain과 LangGraph 차이',
  body: (
    <>
      <H>한 줄 요약</H>
      <P><b>LangChain</b>은 LLM·프롬프트·도구 같은 <b>부품</b>과 그것을 한 방향으로 잇는 방법을 주고, <b>LangGraph</b>는 그 부품들을 <b>노드와 연결선(그래프)</b>으로 묶어 <b>상태 공유 · 분기 · 되돌아가기(루프) · 중단/재개</b>를 다루게 해 줍니다. 서로 경쟁하는 도구가 아니라 위아래 층입니다. (최근 LangChain의 에이전트도 내부적으로 LangGraph 위에서 동작합니다.)</P>

      <Note>멀티에이전트라도 <b>A → B → C 직선</b>이라면 둘의 차이는 거의 없습니다. 차이는 흐름이 <b>갈라지거나 되돌아갈 때</b> 커집니다. 그래서 이 대시보드에서도 Step 2와 Step 3은 결과가 비슷하고, Step 4~6부터 차이가 드러납니다.</Note>

      <H>비교표</H>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-slate-300 border-collapse">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1.5 pr-3 border-b border-slate-700">항목</th>
              <th className="py-1.5 pr-3 border-b border-slate-700">LangChain</th>
              <th className="py-1.5 border-b border-slate-700">LangGraph</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">핵심 개념</td><td className="pr-3 border-b border-slate-800">프롬프트 · 모델 · 파서 · 도구 같은 부품</td><td className="border-b border-slate-800">노드 · 엣지 · 상태(State)로 만든 그래프</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">흐름 표현</td><td className="pr-3 border-b border-slate-800"><code>A | B | C</code> 처럼 한 방향 파이프</td><td className="border-b border-slate-800">연결선으로 선언. 순서·갈림길·되돌림 모두 표현</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">상태 공유</td><td className="pr-3 border-b border-slate-800">앞 단계 출력이 다음 입력으로 전달</td><td className="border-b border-slate-800">모든 노드가 같은 상태를 읽고 갱신 (이력 누적)</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">분기</td><td className="pr-3 border-b border-slate-800">코드의 <code>if</code>로 직접 구현</td><td className="border-b border-slate-800">조건부 엣지로 선언</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">루프</td><td className="pr-3 border-b border-slate-800"><code>while</code>과 종료 조건을 직접 관리</td><td className="border-b border-slate-800">연결선 + 반복 상한(<code>recursion_limit</code>)</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">중단 · 재개</td><td className="pr-3 border-b border-slate-800">직접 구현해야 해서 어려움</td><td className="border-b border-slate-800">체크포인트로 지원 (사람 승인 대기 등)</td></tr>
            <tr><td className="py-1.5 pr-3 font-bold">잘 맞는 상황</td><td className="pr-3">단순 변환, 한 번에 끝나는 체인</td><td>여러 에이전트가 주고받고, 갈라지고, 반복하는 업무 흐름</td></tr>
          </tbody>
        </table>
      </div>

      <H>코드로 보는 차이</H>
      <P><b>① 직선 (Step 0~2에 해당)</b> — LangChain 파이프 하나, 또는 함수 두 번 호출이면 충분합니다.</P>
      <Code>{`chain = prompt | llm | parser          # LangChain: 부품을 파이프로 연결
result = chain.invoke({"topic": "RAG"})

plan   = llm.invoke("기획안을 써 줘")        # 에이전트 2개 직선도
review = llm.invoke(f"검토해 줘:\\n{plan}")  # 그냥 두 번 호출`}</Code>
      <P><b>② 같은 직선을 그래프로 (Step 3)</b> — 호출은 같은 2번입니다. 구조가 "선언"으로 바뀝니다.</P>
      <Code>{`g = StateGraph(State)
g.add_node("기획자", planner)
g.add_node("개발자", developer)
g.add_edge(START, "기획자")
g.add_edge("기획자", "개발자")
g.add_edge("개발자", END)
app = g.compile()                       # 결과는 ①과 거의 같다`}</Code>
      <P><b>③ 통과할 때까지 되돌아가기 (Step 4~6)</b> — 여기서 차이가 커집니다.</P>
      <Code>{`# 직접 구현: 반복문 + 종료 조건을 코드로 관리
while True:
    draft = writer(feedback)
    verdict = reviewer(draft)
    if "통과" in verdict: break
    feedback = verdict                  # 상한·상태·로그도 직접 챙겨야 함

# LangGraph: 같은 흐름을 연결선으로 선언
g.add_conditional_edges("평가자", route, {"통과": END, "재작성": "작성자"})
# 반복 상한(recursion_limit), 상태 누적, 단계별 스트리밍을 프레임워크가 처리`}</Code>
      <Note>LangGraph 없이 <code>while</code>과 <code>if</code>로도 같은 일을 할 수 있습니다. 그래프가 해 주는 일은 이 제어 흐름을 <b>눈에 보이는 구조로 선언하고 관리하기 쉽게</b> 하는 것입니다. 이 화면의 캔버스가 바로 그 구조를 그림으로 보여 줍니다.</Note>

      <H>이 대시보드에서는 어떻게 다른가</H>
      <ul className="list-disc pl-5 space-y-1.5">
        <Li><b>Step 0~2 (LangChain 탭)</b>: 직선 흐름의 개념을 보여 주는 <b>고정 시나리오</b>입니다. 실제 LangChain 체인 객체가 아니라 정해진 순서로 LLM을 호출하며, 그려진 연결선은 쓰지 않습니다(노드 이름으로 순서 결정).</Li>
        <Li><b>Step 3</b>: 호출 수(2번)와 결과는 Step 2와 비슷합니다. 다른 점은 <b>상태가 노드 사이로 전달되는 그래프 구조</b>라는 것입니다.</Li>
        <Li><b>Step 4~6, 자유 설계</b>: 되돌림·분기·루프가 있어 그래프의 장점이 실제로 드러납니다. 연결선 이름으로 갈림길을, 아래쪽 점으로 되돌림을 표현합니다.</Li>
        <Li><b>로컬 vs 백엔드</b>: <b>LangGraph를 실제로 쓰는 것은 백엔드 모드</b>(FastAPI 서버)뿐입니다. 로컬 모드는 같은 규칙을 브라우저의 <code>while</code> 반복문으로 흉내 냅니다. 그래서 반복 상한(로컬 10번 / 백엔드 20단계)과 Step 4 종료 판정이 조금 다릅니다.</Li>
      </ul>

      <H>그래서 언제 무엇을 쓰나</H>
      <ul className="list-disc pl-5 space-y-1.5">
        <Li><b>LangChain만으로 충분</b>: 흐름이 직선이고 한 번에 끝나는 경우 (요약, 번역, 변환, 간단한 질의응답).</Li>
        <Li><b>LangGraph를 고려</b>: 갈림길이 있거나, 결과를 보고 되돌아가야 하거나, 여러 에이전트가 상태를 공유하거나, 중간에 멈췄다 이어가거나 사람의 승인을 기다려야 하는 경우.</Li>
        <Li>처음엔 직선으로 시작하고, <code>if</code>와 <code>while</code>이 코드 곳곳에 늘어나기 시작하면 그래프로 옮기는 것이 자연스럽습니다.</Li>
      </ul>
    </>
  ),
});

// 10. 호출 상한과 사람 승인(HITL)
SECTIONS.push({
  id: 'hitl',
  title: '10. 호출 상한 · 사람 승인(HITL)',
  body: (
    <>
      <H>최대 호출 횟수 (API 비용 제한)</H>
      <P>왼쪽 패널 아래의 <b>최대 호출 횟수</b>는 LLM을 부르는 횟수의 상한입니다. 루프가 길어져 비용이 커지는 것을 막습니다. 값은 브라우저에 기억됩니다. (기본 10, 1~50)</P>
      <ul className="list-disc pl-5 space-y-1.5">
        <Li><b>세는 방식</b>: 에이전트 노드가 실행될 때마다 1회입니다. <b>사람 승인 노드와 START/END는 세지 않습니다</b>(LLM을 부르지 않음).</Li>
        <Li><b>넘으면</b>: 상한을 넘는 호출은 <b>하지 않고</b> "호출 횟수 상한에 도달해 종료"라는 안내와 함께 안전하게 끝납니다. 오류가 아닙니다.</Li>
        <Li><b>적용 범위</b>: Step 3~7과 자유 설계입니다. Step 0~2는 호출이 1~2회로 정해져 있어 입력이 비활성(고정)입니다.</Li>
        <Li><b>정하는 요령</b>: 예제를 한 번 돌려 보고 필요한 횟수에 여유를 조금 더한 값으로 정하세요. Step 4는 최대 6회, Step 5·6은 되돌림 횟수에 따라 다릅니다.</Li>
      </ul>
      <Note>백엔드 모드는 서버가 한 번 더 검증합니다(1~50으로 제한). 화면 값을 조작해도 50회를 넘는 호출은 일어나지 않습니다.</Note>

      <H>HITL(Human-in-the-Loop)이란</H>
      <P>자동으로 도는 흐름 <b>중간에 사람의 확인을 넣는 방식</b>입니다. 발송·결제·삭제처럼 <b>되돌리기 어려운 행동 앞</b>에서 특히 중요합니다. Step 4~6의 <b>"통과"/"[승인]"은 AI의 판정</b>이고, <b>사람의 결정은 Step 7의 "사람 승인" 노드</b>에서만 일어납니다.</P>

      <H>사람을 루프의 어디에 둘까 — 두 가지 배치</H>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-slate-300 border-collapse">
          <thead>
            <tr className="text-left text-xs text-slate-400">
              <th className="py-1.5 pr-3 border-b border-slate-700">항목</th>
              <th className="py-1.5 pr-3 border-b border-slate-700">① 사람이 루프를 승인</th>
              <th className="py-1.5 border-b border-slate-700">② AI 루프 + 사람 최종 관문</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">구조</td><td className="pr-3 border-b border-slate-800">작성자 ↔ 사람</td><td className="border-b border-slate-800">작성자 ↔ AI 평가자 → 사람</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">루프를 끝내는 주체</td><td className="pr-3 border-b border-slate-800">사람의 "승인"</td><td className="border-b border-slate-800">AI 평가자의 "통과" + 사람의 "승인"</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">사람의 개입</td><td className="pr-3 border-b border-slate-800">매 라운드</td><td className="border-b border-slate-800">AI가 통과시킨 뒤 마지막에</td></tr>
            <tr><td className="py-1.5 pr-3 border-b border-slate-800 font-bold">LLM 호출 비용</td><td className="pr-3 border-b border-slate-800">적음 (평가 호출 없음)</td><td className="border-b border-slate-800">평가 호출이 더해짐</td></tr>
            <tr><td className="py-1.5 pr-3 font-bold">잘 맞는 상황</td><td className="pr-3">품질 기준을 사람만 판단할 수 있을 때, 되돌리기 어려운 행동 앞</td><td>AI가 걸러 줄 수 있는 기준이 있고 사람 부담을 줄이고 싶을 때</td></tr>
          </tbody>
        </table>
      </div>
      <P>HITL의 핵심은 <b>"루프를 계속할지 끝낼지를 사람이 정한다"</b>는 점이며, ①이 가장 기본 형태입니다. 승인 카드의 <b>"N번째 확인"</b> 표시로 지금 몇 번째 라운드인지 알 수 있습니다. Step 5(AI 평가자)와 Step 7 첫 예제(사람)는 <b>같은 주제에서 판정자만 바꾼 짝</b>이라 비교해 보기 좋습니다.</P>

      <H>사용 방법</H>
      <ol className="list-decimal pl-5 space-y-1.5">
        <Li>Step 7을 고르고 예제를 적용합니다. (또는 LangGraph 탭의 <b>👤 사람 승인 (HITL)</b> 버튼으로 노드를 직접 추가)</Li>
        <Li>실행하면 그래프가 <b>사람 승인 노드에서 멈추고</b>, 결과 패널에 <b>승인 카드</b>가 뜹니다. 카드에는 직전 결과가 보입니다.</Li>
        <Li><b>✓ 승인</b>: 다음으로 진행합니다. <b>✎ 수정 요청</b>: 입력한 의견을 담아 앞 노드로 되돌아갑니다. <b>■ 중단</b>: 실행을 끝냅니다.</Li>
      </ol>
      <H>연결 규칙</H>
      <ul className="list-disc pl-5 space-y-1.5">
        <Li>사람 승인 노드에서 나가는 연결선 이름은 <b>"승인"</b>(다음 노드 또는 END)과 <b>"수정"</b>(되돌림, 아래쪽 점)을 씁니다.</Li>
        <Li><b>"수정" 선을 먼저 그리세요.</b> 사람이 쓴 의견에 "승인"이라는 단어가 들어 있어도 "수정"으로 가게 하기 위해서입니다.</Li>
        <Li>수정 의견은 <b>되돌아간 노드의 다음 입력</b>이 됩니다. 그래서 그 노드의 지시에 "의견이 있으면 반영해 다시 쓰세요"를 적어 두세요.</Li>
      </ul>

      <H>구현 방식 (로컬 vs 백엔드)</H>
      <ul className="list-disc pl-5 space-y-1.5">
        <Li><b>백엔드 모드</b>: LangGraph의 <code>interrupt()</code>로 그래프를 멈추고 체크포인터에 상태를 저장합니다. 결정이 오면 <code>Command(resume=…)</code>으로 <b>같은 상태에서 이어서</b> 실행합니다. (프로젝트의 03단계와 같은 방식)</Li>
        <Li><b>로컬 모드</b>: 브라우저의 반복문이 버튼을 누를 때까지 기다립니다. 같은 화면과 규칙이지만 LangGraph를 쓰지는 않습니다.</Li>
      </ul>
      <Note tone="warn">승인 대기는 백엔드에서 <b>10분</b>이 지나면 종료됩니다. 대기 중에 서버를 재시작하면 멈춘 상태가 사라지고(메모리 저장), 이어서 실행할 수 없습니다. 이 대시보드의 "승인"은 <b>실제 발송이나 결제를 하지 않는 모의</b>입니다.</Note>
    </>
  ),
});

export default function ManualModal({ onClose }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const current = SECTIONS.find((s) => s.id === active);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-[920px] max-w-full h-[80vh] flex flex-col overflow-hidden whitespace-normal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 제목줄 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-lg">📖</span>
            <h2 className="text-base font-bold text-slate-100">사용 매뉴얼</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors" title="닫기">✕</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 목차 */}
          <nav className="w-48 shrink-0 border-r border-slate-800 p-3 space-y-1 overflow-y-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                  active === s.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {s.title}
              </button>
            ))}
          </nav>

          {/* 본문 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            <h2 className="text-lg font-bold text-slate-100 mb-4">{current.title}</h2>
            {current.body}
          </div>
        </div>
      </div>
    </div>
  );
}
