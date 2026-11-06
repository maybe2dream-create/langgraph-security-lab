// MeetingChat.jsx
// --------------
// 오른쪽 '실행 결과' 채팅 화면.
// 백엔드 모드에서는 WebSocket(/ws/chat)으로 서버가 보내 주는 메시지를 실시간으로 받아 쌓아 보여 주고,
// 로컬 모드에서는 App이 전달한 localMessages를 그대로 보여 준다.
//
import React, { useEffect, useState, useRef } from 'react';

// props
//   isActive     : 실행 중인지. true가 되면 WebSocket 연결을 열고, false가 되면 닫는다.
//   wsUrl        : 백엔드 WebSocket 주소 (예: ws://localhost:8000/ws/chat)
//   category     : 'langchain' | 'langgraph' (제목·색상·안내 문구만 바꾼다)
//   localMode    : true면 WebSocket을 쓰지 않고 localMessages를 그대로 보여 준다
//   localMessages: 로컬 모드에서 App이 모아 둔 대화 목록
//   localApproval: 로컬 모드에서 사람 승인(HITL) 대기 중이면 {role, question, resolve}
//   apiBase      : 백엔드 주소. 백엔드 모드의 승인 결정을 POST /api/flow/resume 로 보낼 때 쓴다
export default function MeetingChat({ isActive, wsUrl, category, localMode = false, localMessages = [], localApproval = null, apiBase = '' }) {
  // messages: 백엔드 모드에서 WebSocket으로 받은 대화 목록 / ws: 연결 객체(렌더와 무관하므로 ref)
  const [messages, setMessages] = useState([]);
  const ws = useRef(null);
  const endRef = useRef(null);   // 새 메시지/승인 카드가 생기면 맨 아래로 스크롤하기 위한 표식
  // approval: 백엔드 모드에서 서버가 보낸 '사람 승인' 요청 {role, question}. 결정하면 null로 돌아간다
  const [approval, setApproval] = useState(null);

  const isLangChain = category === 'langchain';

  // 모드에 따라 화면에 보여 줄 목록을 고른다
  const displayMessages = localMode ? localMessages : messages;
  // 지금 화면에 띄울 승인 요청 (로컬은 App에서, 백엔드는 WebSocket에서 온다)
  const pendingApproval = localMode ? localApproval : approval;

  // 결정 전달: 로컬은 대기 중인 Promise를 풀고, 백엔드는 서버의 /api/flow/resume 으로 보낸다
  const decide = async (decision) => {
    if (localMode) {
      localApproval?.resolve(decision);
      return;
    }
    setApproval(null);
    try {
      await fetch(`${apiBase}/api/flow/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(decision),
      });
    } catch (e) {
      setMessages((prev) => [...prev, { sender: 'Error', text: '승인 결과를 서버에 보내지 못했습니다. 서버가 켜져 있는지 확인하세요.' }]);
    }
  };

  // 메시지나 승인 카드가 늘어나면 맨 아래로 스크롤
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayMessages.length, pendingApproval]);

  // isActive가 바뀔 때마다 WebSocket을 열거나 닫는다. (로컬 모드는 연결 자체가 필요 없다)
  useEffect(() => {
    if (localMode) {

      return;
    }
    
    if (isActive) {
      ws.current = new WebSocket(wsUrl);
      
      ws.current.onopen = () => {
        const welcomeText = isLangChain 
          ? '체인 실행 서버에 연결되었습니다...' 
          : '회의 서버(LangGraph)에 연결되었습니다...';
        setMessages((prev) => [...prev, { sender: 'System', text: welcomeText }]);
      };
      
      // 서버 메시지 형식: {type: 'system'|'error'|'agent', role, content}
      // JSON이 아니거나 type이 낯설면 원문 그대로 'Agent' 말풍선으로 보여 준다.
      ws.current.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'approval') {
            // 사람 승인(HITL): 서버가 여기서 멈추고 결정을 기다린다 → 승인 카드를 띄운다
            setApproval({ role: parsed.role, question: parsed.question, round: parsed.round });
          } else if (parsed.type === 'system') {
            setMessages((prev) => [...prev, { sender: 'System', text: parsed.content }]);
          } else if (parsed.type === 'error') {
            setMessages((prev) => [...prev, { sender: 'Error', text: parsed.content }]);
          } else if (parsed.type === 'agent') {
            setMessages((prev) => [...prev, { sender: parsed.role || 'Agent', text: parsed.content }]);
          } else {
            setMessages((prev) => [...prev, { sender: 'Agent', text: event.data }]);
          }
        } catch (e) {
          setMessages((prev) => [...prev, { sender: 'Agent', text: event.data }]);
        }
      };
      
      ws.current.onclose = () => {
        setMessages((prev) => [...prev, { sender: 'System', text: '회의 통신이 종료되었습니다.' }]);
      };
    } else {
      setApproval(null);   // 실행이 끝났으면 남은 승인 카드도 정리
      if (ws.current) {
        ws.current.close();
      }
    }

    // 정리(cleanup): 화면에서 사라지거나 의존값이 바뀌면 연결을 닫아 중복 연결을 막는다
    return () => {
      if (ws.current) ws.current.close();
    };
  }, [isActive, wsUrl, isLangChain, localMode]);

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
      <div className="p-5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
        <h2 className={`text-xl font-bold ${isLangChain ? 'text-indigo-400' : 'text-purple-400'}`}>
          {isLangChain ? '파이프라인 실행 결과' : '실시간 회의 로그'}
        </h2>
        <div className="flex items-center space-x-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`}></span>
            <span className="text-xs text-slate-400 font-medium">{isActive ? (localMode ? 'Live (Local)' : 'Live') : 'Offline'}</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5 scroll-smooth">
        {displayMessages.length === 0 ? (
          <div className="text-slate-500 flex flex-col items-center justify-center h-full space-y-4">
            <svg className="w-12 h-12 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
            <span>{isLangChain ? '대화 플로우를 구성하고 체인을 실행해 보세요.' : '대화 플로우를 구성하고 회의를 시작하세요.'}</span>
          </div>
        ) : (
          // 말풍선 종류: System(안내, 가운데) / Error(빨강) / 그 외 에이전트(역할 이름 표시)
          displayMessages.map((msg, i) => {
            const isSystem = msg.sender === 'System';
            const isError = msg.sender === 'Error';
            
            let cardClass = "p-4 rounded-2xl max-w-[90%] shadow-md ";
            if (isSystem) {
              cardClass += "bg-slate-800/50 border border-slate-700/50 text-slate-400 mx-auto text-center text-sm w-full";
            } else if (isError) {
              cardClass += "bg-red-950/30 border border-red-900/50 text-red-300 mx-auto text-center text-sm w-full";
            } else {
              cardClass += "bg-slate-800 border border-slate-700 text-slate-100";
            }

            return (
              <div key={i} className={cardClass}>
                {!isSystem && !isError && (
                  <div className={`text-sm font-bold mb-2 ${isLangChain ? 'text-indigo-400' : 'text-purple-400'}`}>{msg.sender}</div>
                )}
                {isError && (
                  <div className="text-xs font-bold mb-1 text-red-400 uppercase tracking-wider">System Error</div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.text}</div>
              </div>
            );
          })
        )}
        {/* 사람 승인(HITL) 카드: 실행이 여기서 멈춰 있고, 아래 버튼으로 결정하면 이어서 진행한다 */}
        {pendingApproval && <ApprovalCard approval={pendingApproval} onDecide={decide} />}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// 사람 승인(HITL) 카드.
//  - 직전 결과(question)를 보여 주고, [승인] / [수정 요청](의견 입력) / [중단] 중 하나를 고르게 한다.
//  - 수정 요청의 의견은 그래프의 다음 노드(보통 작성자)의 입력이 된다.
function ApprovalCard({ approval, onDecide }) {
  const [feedback, setFeedback] = useState('');
  return (
    <div className="rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-4 shadow-md" role="group" aria-label="사람 승인 요청">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">👤</span>
        <span className="text-sm font-bold text-amber-400">사람 승인이 필요합니다</span>
        {approval.round && <span className="ml-auto text-[11px] font-bold text-amber-400 border border-amber-500/50 rounded-full px-2 py-0.5">{approval.round}번째 확인</span>}
      </div>
      <p className="text-[11px] text-slate-400 mb-2">실행이 여기서 멈춰 있습니다. 아래 결과를 확인하고 결정해 주세요.</p>
      <div className="max-h-40 overflow-y-auto rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-[13px] leading-relaxed p-3 whitespace-pre-wrap mb-3">
        {approval.question || '(직전 결과 없음)'}
      </div>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        rows={2}
        placeholder="수정 요청 의견 (예: 숫자를 넣어 주세요)"
        className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-amber-500 resize-none placeholder-slate-500"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onDecide({ action: 'approve', feedback: '' })}
          className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition-colors"
        >
          ✓ 승인
        </button>
        <button
          onClick={() => onDecide({ action: 'revise', feedback })}
          className="flex-1 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-bold transition-colors"
          title="입력한 의견을 담아 되돌아갑니다"
        >
          ✎ 수정 요청
        </button>
        <button
          onClick={() => onDecide({ action: 'stop', feedback: '' })}
          className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold transition-colors"
          title="실행을 중단합니다"
        >
          ■ 중단
        </button>
      </div>
    </div>
  );
}
