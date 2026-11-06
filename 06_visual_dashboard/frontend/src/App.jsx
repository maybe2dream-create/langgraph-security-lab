// App.jsx
// -------
// 06 단계 프론트엔드의 최상위 화면(React).
//
// 역할
//   1) 상단 헤더: 서버 상태, 실행 모드(로컬/백엔드), 설정(API 키), 카테고리·실습 단계 선택
//   2) 왼쪽 FlowEditor: 노드·엣지를 그려 그래프를 구성, '실행'을 누르면 handleStartMeeting 호출
//   3) 오른쪽 MeetingChat: 실행 결과(대화)를 실시간으로 표시
//
// 두 가지 실행 방식
//   - 로컬   : 브라우저가 OpenAI/Gemini REST API를 직접 호출 (utils/localFlowRunner.js, 화면에 입력한 키 필수)
//   - 백엔드 : FastAPI 서버(backend/dashboard_main.py)가 LangGraph로 실행하고 WebSocket으로 결과 전송
//
import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import FlowEditor from './components/FlowEditor';
import MeetingChat from './components/MeetingChat';
import ManualModal from './components/ManualModal';
import { executeLocalFlow } from './utils/localFlowRunner';

// 백엔드(FastAPI) 주소. REST는 http, 실시간 결과(WebSocket)는 ws 로 접속한다.
// 백엔드의 CORS는 이 프론트(localhost:5173)만 허용하므로, 포트를 바꾸면 양쪽을 함께 수정해야 한다.
const API_BASE = 'http://localhost:8000';
const WS_BASE = 'ws://localhost:8000';

function App() {
  // ── 상태(State) ──
  // isMeetingActive : 실행 중인지 (true면 MeetingChat이 WebSocket을 연결하고 버튼이 '중지'로 바뀐다)
  const [isMeetingActive, setIsMeetingActive] = useState(false);
  const [activeCategory, setActiveCategory] = useState('langchain'); // 'langchain' or 'langgraph'
  // tutorialMode    : 실습 단계. step0~2(LangChain), step3·step4·free(LangGraph). 백엔드로 보내는 mode 값이 된다.
  const [tutorialMode, setTutorialMode] = useState('step0');
  // apiKeys         : 설정 창에서 입력한 키. 브라우저 localStorage에 평문 저장되고, 요청 시 백엔드로도 전달된다.
  const [apiKeys, setApiKeys] = useState({ openai: '', gemini: '', deepseek: '' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'online', 'offline', 'checking'
  // executionMode   : 'local'=브라우저가 LLM API를 직접 호출(화면에 입력한 키 필수) / 'backend'=FastAPI 서버가 호출(.env 키 사용 가능)
  const [executionMode, setExecutionMode] = useState('local'); // 'backend' or 'local'
  // localMessages   : 로컬 모드의 대화 기록 (백엔드 모드는 MeetingChat이 WebSocket으로 직접 받는다)
  const [localMessages, setLocalMessages] = useState([]);
  // localApproval  : 로컬 모드에서 '사람 승인' 노드를 만나 사용자의 결정을 기다리는 중이면 {role, question, resolve}
  const [localApproval, setLocalApproval] = useState(null);
  // AbortController : 로컬 실행 중단용. abort()하면 진행 중인 fetch와 sleep이 즉시 끊긴다. (렌더와 무관해 ref에 보관)
  const localAbortControllerRef = useRef(null);
  // theme           : 'light' | 'dark'. <html>의 'light' 클래스로 화면 색을 바꾼다(styles는 light-theme.css). 선택은 localStorage에 기억
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('multiAgentTheme') || 'light'; } catch (e) { return 'light'; }
  });
  // isHelpOpen      : 상단 '?' 사용법 도움말 풍선 열림 여부
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // isManualOpen    : '📖 매뉴얼' 팝업(노드·연결·단계별 가이드) 열림 여부
  const [isManualOpen, setIsManualOpen] = useState(false);
  const helpRef = useRef(null);

  // 풍선 바깥을 클릭하면 닫는다. (헤더 안의 투명 덮개 방식은 헤더 밖 클릭을 감지하지 못해 문서 전체에서 감지한다)
  useEffect(() => {
    if (!isHelpOpen) return;
    const handleOutside = (e) => {
      if (helpRef.current && !helpRef.current.contains(e.target)) setIsHelpOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isHelpOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try { localStorage.setItem('multiAgentTheme', theme); } catch (e) {}
  }, [theme]);


  // 처음 한 번: 저장해 둔 API 키를 localStorage에서 복원
  useEffect(() => {
    const savedKeys = localStorage.getItem('multiAgentApiKeys');
    if (savedKeys) {
      try {
        // 예전에 저장된 값에 없는 제공자(deepseek 등)가 있어도 입력칸이 깨지지 않게 기본값과 합친다
        setApiKeys((prev) => ({ ...prev, ...JSON.parse(savedKeys) }));
      } catch (e) {}
    }
  }, []);

  // 설정 창의 '저장 및 닫기'. 주의: 키가 브라우저에 평문으로 남으므로 공용 PC에서는 쓰지 말 것
  const handleSaveSettings = () => {
    localStorage.setItem('multiAgentApiKeys', JSON.stringify(apiKeys));
    setIsSettingsOpen(false);
  };

  // 백엔드 생존 확인: GET /api/health (2초 안에 응답이 없으면 offline)
  const checkBackendStatus = async () => {
    setBackendStatus('checking');
    try {
      await axios.get(`${API_BASE}/api/health`, { timeout: 2000 });
      setBackendStatus('online');
    } catch (error) {
      setBackendStatus('offline');
    }
  };


  // 5초마다 서버 상태를 다시 확인한다. 화면을 닫을 때(cleanup) 타이머를 해제해 중복 실행을 막는다.
  useEffect(() => {
    checkBackendStatus();
    const interval = setInterval(() => {
      checkBackendStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isSettingsOpen) {
      checkBackendStatus();
    }
  }, [isSettingsOpen]);


  // 상단 탭(LangChain/LangGraph)을 누르면 그 카테고리의 첫 단계로 이동
  const handleCategoryChange = (category) => {
    setActiveCategory(category);
    if (category === 'langchain') {
      setTutorialMode('step0');
    } else {
      setTutorialMode('step3');
    }
  };


  // 단계 드롭다운으로 직접 바꿔도 탭(카테고리)이 맞게 따라가도록 동기화
  useEffect(() => {
    if (['step0', 'step1', 'step2'].includes(tutorialMode)) {
      setActiveCategory('langchain');
    } else if (['step3', 'step4', 'step5', 'step6', 'step7', 'free'].includes(tutorialMode)) {
      setActiveCategory('langgraph');
    }
  }, [tutorialMode]);


  // 백엔드 모드인데 서버가 꺼지면 자동으로 로컬 모드로 전환 (실행이 막히지 않도록)
  useEffect(() => {
    if (backendStatus === 'offline' && executionMode === 'backend') {
      setExecutionMode('local');
    }
  }, [backendStatus, executionMode]);

  // '실행' 버튼: FlowEditor가 현재 그래프(nodes/edges)를 넘겨 준다.
  //  - 로컬 모드: executeLocalFlow가 브라우저에서 직접 LLM을 호출하고 onMessage로 결과를 전달
  //  - 백엔드 모드: POST /api/flow/execute 로 시작만 요청하고, 결과는 WebSocket(MeetingChat)으로 받는다
  const handleStartMeeting = async (graphData) => {
    if (executionMode === 'local') {
      setIsMeetingActive(true);
      setLocalMessages([]);
      
      if (localAbortControllerRef.current) {
        localAbortControllerRef.current.abort();
      }
      localAbortControllerRef.current = new AbortController();
      
      // 이전 실행이 남아 있으면 먼저 중단하고 새 AbortController로 시작
      executeLocalFlow({
        mode: tutorialMode,
        nodes: graphData.nodes,
        edges: graphData.edges,
        apiKeys: apiKeys,
        maxCalls: graphData.maxCalls,
        // 사람 승인(HITL): 승인 카드를 띄우고 사용자의 결정이 올 때까지 Promise로 기다린다. 중지(abort)하면 카드를 닫는다.
        onApproval: (payload) => new Promise((resolve, reject) => {
          const sig = localAbortControllerRef.current.signal;
          setLocalApproval({ ...payload, resolve: (d) => { setLocalApproval(null); resolve(d); } });
          sig.addEventListener('abort', () => { setLocalApproval(null); reject(new Error('aborted')); }, { once: true });
        }),
        // 메시지 종류(system/error/agent)를 화면 표시용 {sender, text}로 바꿔 누적한다
        onMessage: (msg) => {
          setLocalMessages((prev) => {
            if (msg.type === 'system') {
              return [...prev, { sender: 'System', text: msg.content }];
            } else if (msg.type === 'error') {
              return [...prev, { sender: 'Error', text: msg.content }];
            } else if (msg.type === 'agent') {
              return [...prev, { sender: msg.role || 'Agent', text: msg.content }];
            }
            return prev;
          });
        },
        onComplete: () => {
          setIsMeetingActive(false);
        },
        onError: (err) => {
          console.error("Local execution error:", err);
          setIsMeetingActive(false);
        },
        signal: localAbortControllerRef.current.signal
      });
      return;
    }

    // 백엔드 모드: 요청 성공 = '시작됨'일 뿐이며 LLM 결과는 WebSocket으로 따로 도착한다
    try {
      setIsMeetingActive(true);
      await axios.post(`${API_BASE}/api/flow/execute`, {
        ...graphData,
        mode: tutorialMode,
        api_keys: apiKeys,
        max_calls: graphData.maxCalls
      });
    } catch (error) {
      console.error('Failed to start meeting:', error);
      alert('백엔드 서버 연결 실패. 포트 8000에서 FastAPI 서버가 실행 중인지 확인하세요.');
      setIsMeetingActive(false);
    }
  };

  // '중지' 버튼: 로컬은 abort로 끊고, 백엔드는 POST /api/flow/stop 으로 실행 태스크를 취소한다
  const handleStopMeeting = async () => {
    if (executionMode === 'local') {
      if (localAbortControllerRef.current) {
        localAbortControllerRef.current.abort();
      }
      setIsMeetingActive(false);
      return;
    }

    try {
      await axios.post(`${API_BASE}/api/flow/stop`);
      setIsMeetingActive(false);
    } catch (error) {
      console.error('Failed to stop meeting:', error);
    }
  };

  // ── 화면 구성 ──
  //   ┌──────────────────────────── 헤더(전체 폭) ────────────────────────────┐
  //   │ 로고·제목 │ 카테고리 탭 · 실습 단계 │ 서버 · 실행 모드 · 테마 · 도움말 · 설정 │
  //   ├────────────┬──────────────────────────────┬───────────────────────────┤
  //   │ 학습 패널   │ 노드·엣지 캔버스               │ 실행 결과 채팅             │
  //   │ (FlowEditor 안의 aside)                  │ (MeetingChat)             │
  //   └────────────┴──────────────────────────────┴───────────────────────────┘
  // 학습 패널은 캔버스 위에 떠 있지 않고 별도 열이라서 노드를 가리지 않는다.
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500/30">
      <header className="relative z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-2.5 border-b border-slate-800 bg-slate-900/90 backdrop-blur whitespace-nowrap">
        {/* 왼쪽: 로고와 제목 */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-500/20">
            M
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-bold tracking-tight text-slate-100">Multi-Agent Lab</h1>
            <p className="text-[11px] text-slate-500">LangChain · LangGraph 실습</p>
          </div>
        </div>

        {/* 가운데: 학습 범위 선택 (카테고리 탭 + 실습 단계) */}
        <div className="flex items-center gap-3">
            {/* 카테고리 탭 선택 (LangChain vs LangGraph) */}
            <div className="bg-slate-900/80 p-1 rounded-xl border border-slate-800 flex space-x-1">
              <button
                onClick={() => handleCategoryChange('langchain')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${activeCategory === 'langchain'
                    ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                LangChain
              </button>
              <button
                onClick={() => handleCategoryChange('langgraph')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${activeCategory === 'langgraph'
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/20'
                    : 'text-slate-400 hover:text-slate-200'
                  }`}
              >
                LangGraph
              </button>
            </div>

            {/* 단계 선택 드롭다운 */}
            <div className="flex items-center space-x-3">
              <span className="text-xs text-slate-400 font-medium">실습 단계</span>
              <select
                id="tutorial-mode-select"
                value={tutorialMode}
                onChange={(e) => setTutorialMode(e.target.value)}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-sm font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 cursor-pointer hover:bg-slate-700 transition"
              >
                {activeCategory === 'langchain' ? (
                  <>
                    <option value="step0">Step 0: LangChain LCEL 체인 기초</option>
                    <option value="step1">Step 1: 단일 에이전트 구동</option>
                    <option value="step2">Step 2: 순차 에이전트 체이닝</option>
                  </>
                ) : (
                  <>
                    <option value="step3">Step 3: LangGraph 기초 흐름</option>
                    <option value="step4">Step 4: LangGraph 루프 및 라우팅</option>
                    <option value="step5">Step 5: 평가-개선 루프</option>
                    <option value="step6">Step 6: 분기 + 루프 결합</option>
                    <option value="step7">Step 7: 사람 승인 (HITL)</option>
                    <option value="free">자유 설계 모드 (Free Design)</option>
                  </>
                )}
              </select>
            </div>
        </div>

        {/* 오른쪽: 실행 환경 (서버 상태 · 실행 모드) + 도구 (테마 · 도움말 · 설정) */}
        <div className="flex items-center gap-3 ml-auto">
            {/* 백엔드 서버 상태 및 제어 버튼 */}
            <div className="flex items-center space-x-2 bg-slate-900/80 px-3 py-1.5 rounded-xl border border-slate-800 shadow-inner animate-fade-in">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Server</span>
              <div className="flex items-center space-x-1.5 px-1">
                <div className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-emerald-500 animate-pulse' : backendStatus === 'offline' ? 'bg-rose-500' : 'bg-amber-500'}`}></div>
                <span className={`text-xs font-black tracking-wide ${backendStatus === 'online' ? 'text-emerald-400' : backendStatus === 'offline' ? 'text-rose-400' : 'text-amber-400'}`}>
                  {backendStatus === 'online' ? 'ONLINE' : backendStatus === 'offline' ? 'OFFLINE' : 'CHECKING'}
                </span>
              </div>
              {backendStatus === 'online' ? (
                <button
                  onClick={async () => {
                    if (!window.confirm("정말 백엔드 서버를 중지하시겠습니까?")) return;
                    try {
                      await axios.post(`${API_BASE}/api/server/stop`);
                      setBackendStatus('offline');
                    } catch (e) {
                      setBackendStatus('offline');
                    }
                  }}
                  className="text-[10px] bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20 font-bold transition-all"
                >
                  중지
                </button>
              ) : (
                <button
                  onClick={() => alert("백엔드 서버가 종료되었습니다.\n\n[시작 방법]\n터미널에서 다음 명령을 실행하세요:\ncd 06_visual_dashboard/backend\npython dashboard_main.py")}
                  className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded border border-slate-700 font-bold transition-all"
                >
                  시작 안내
                </button>
              )}
            </div>

            {/* 실행 방식 선택 토글 */}
            <div className="flex items-center space-x-2 bg-slate-900/80 px-2.5 py-1.5 rounded-xl border border-slate-800 shadow-inner">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider pl-1">실행 모드</span>
              <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-850">
                <button
                  onClick={() => setExecutionMode('local')}
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-black tracking-wide transition-all ${
                    executionMode === 'local'
                      ? 'bg-purple-600/90 text-white shadow-sm shadow-purple-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="브라우저 내에서 100% 로컬(시뮬레이션 및 direct API)로 실행합니다."
                >
                  로컬
                </button>
                <button
                  onClick={() => {
                    if (backendStatus !== 'online') {
                      alert("백엔드 서버가 구동 중이 아닙니다. 먼저 백엔드 서버를 시작해 주세요.");
                      return;
                    }
                    setExecutionMode('backend');
                  }}
                  className={`px-2.5 py-0.5 rounded-md text-[10px] font-black tracking-wide transition-all ${
                    executionMode === 'backend'
                      ? 'bg-indigo-600/90 text-white shadow-sm shadow-indigo-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  } ${backendStatus !== 'online' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title="로컬 Python 백엔드 서버를 호출하여 실행합니다."
                >
                  백엔드
                </button>
              </div>
            </div>

            {/* 테마 전환 (라이트/다크) */}
            <button
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="px-2.5 py-2 text-base text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors leading-none"
              title={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>

            {/* 매뉴얼: 노드·연결 방법·단계별 가이드를 자세히 설명하는 팝업 */}
            <button
              onClick={() => setIsManualOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              title="사용 매뉴얼 (노드 · 연결 · 단계별 가이드)"
            >
              📖 매뉴얼
            </button>

            {/* 사용법 도움말 풍선: '?'를 누르면 열리고, 바깥을 누르면 닫힌다 */}
            <div className="relative" ref={helpRef}>
              <button
                onClick={() => setIsHelpOpen(!isHelpOpen)}
                className="w-9 h-9 text-sm font-black text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-full transition-colors"
                title="사용법 도움말"
              >
                ?
              </button>
              {isHelpOpen && (
                <>
                  <div className="absolute right-0 top-full mt-3 w-[380px] max-w-[92vw] z-50 whitespace-normal bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-5">
                    {/* 말풍선 꼬리 */}
                    <div className="absolute -top-1.5 right-3 w-3 h-3 rotate-45 bg-slate-900 border-l border-t border-slate-700"></div>
                    <h3 className="text-sm font-bold text-slate-100 mb-3">사용법</h3>
                    <ol className="space-y-2 text-xs text-slate-300 leading-relaxed list-decimal pl-4">
                      <li><b>API 키 입력</b>: ⚙ 설정에서 Gemini · DeepSeek · OpenAI 키를 입력합니다. (백엔드 모드는 서버의 .env 키도 사용)</li>
                      <li><b>실행 모드 선택</b>: 로컬은 브라우저가 직접 호출하고, 백엔드는 FastAPI 서버(<code>python dashboard_main.py</code>)가 호출합니다.</li>
                      <li><b>실습 단계 선택</b>: LangChain(Step 0~2) 또는 LangGraph(Step 3·4·자유 설계)를 고릅니다.</li>
                      <li><b>그래프 편집</b>: 노드의 ✏ 로 역할·모델·지시사항을 바꾸고, 노드 양끝 점을 끌어 연결합니다. 엣지는 더블클릭으로 삭제합니다.</li>
                      <li><b>실행</b>: 왼쪽 카드의 실행 버튼을 누르면 오른쪽에 결과가 나옵니다. 도중에 중지할 수 있습니다.</li>
                    </ol>
                    <p className="mt-3 text-[11px] text-slate-500 leading-relaxed">호출 횟수만큼 API 비용이 듭니다. 처음에는 Step 1로 시험해 보세요.</p>
                    <button
                      onClick={() => { setIsHelpOpen(false); setIsManualOpen(true); }}
                      className="mt-3 w-full py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                    >
                      📖 노드 · 연결 방법 자세히 보기
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 설정 버튼 */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              title="설정 (API 키)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

        </div>
      </header>

      {/* 본문: [학습 패널 + 캔버스] | [실행 결과] */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-0">
          <FlowEditor
            onStartMeeting={handleStartMeeting}
            onStopMeeting={handleStopMeeting}
            isMeetingActive={isMeetingActive}
            activeMode={tutorialMode}
            activeCategory={activeCategory}
            theme={theme}
          />
        </div>

      {/* 오른쪽: 실행 결과 채팅. wsUrl은 백엔드 모드에서만 연결에 쓰이고, 로컬 모드는 localMessages를 그대로 표시한다 */}
      <div className="w-[380px] shrink-0 border-l border-slate-800 min-h-0">
        <MeetingChat 
          isActive={isMeetingActive} 
          wsUrl={`${WS_BASE}/ws/chat`} 
          category={activeCategory} 
          localMode={executionMode === 'local'}
          localMessages={localMessages}
          localApproval={localApproval}
          apiBase={API_BASE}
        />
      </div>

      </div>

      {/* 매뉴얼 팝업 */}
      {isManualOpen && <ManualModal onClose={() => setIsManualOpen(false)} />}

      {/* 설정 모달: API 키 입력(password 입력칸) + 프론트/백엔드 서버 상태 확인 */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-[400px] p-6 transform transition-all">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                ⚙️ IDE 설정 (Settings)
              </h2>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-slate-400 hover:text-slate-200 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">OpenAI API Key</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeys.openai}
                  onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">DeepSeek API Key</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  value={apiKeys.deepseek || ''}
                  onChange={(e) => setApiKeys({ ...apiKeys, deepseek: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500 transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Gemini API Key</label>
                <input
                  type="password"
                  placeholder="AIza..."
                  value={apiKeys.gemini}
                  onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-slate-500 transition-all"
                />
              </div>
            </div>

            <hr className="border-slate-800 my-6" />
            
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-200 mb-2 flex items-center justify-between">
                서버 상태 관리 (Server Status)
                <button onClick={checkBackendStatus} className="text-xs bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded text-slate-300 transition-colors">새로고침</button>
              </h3>
              
              <div className="flex flex-col space-y-3">
                {/* 프론트엔드 상태 */}
                <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="flex items-center space-x-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-sm font-medium text-slate-300">프론트엔드 (React)</span>
                  </div>
                  <div className="flex space-x-2 items-center">
                    <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 font-bold rounded">실행 중</span>
                  </div>
                </div>

                {/* 백엔드 상태 */}
                <div className="flex items-center justify-between bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${backendStatus === 'online' ? 'bg-green-500 animate-pulse' : backendStatus === 'offline' ? 'bg-red-500' : 'bg-yellow-500'}`}></div>
                    <span className="text-sm font-medium text-slate-300">백엔드 (FastAPI)</span>
                  </div>
                  <div className="flex space-x-2 items-center">
                    {backendStatus === 'checking' && <span className="text-xs text-yellow-500 font-bold px-2 py-1">확인 중...</span>}
                    {backendStatus === 'online' && <span className="text-xs px-2 py-1 bg-green-500/20 text-green-400 font-bold rounded">실행 중</span>}
                    {backendStatus === 'offline' && <span className="text-xs px-2 py-1 bg-red-500/20 text-red-400 font-bold rounded">연결 끊김</span>}
                    
                    {backendStatus === 'online' ? (
                      <button 
                        onClick={async () => {
                          if (!window.confirm("정말 백엔드 서버를 중지하시겠습니까? (터미널에서 수동으로 다시 켜야 합니다)")) return;
                          try {
                            await axios.post(`${API_BASE}/api/server/stop`);
                            setBackendStatus('offline');
                          } catch(e) {
                            setBackendStatus('offline');
                          }
                        }} 
                        className="text-xs bg-red-500/20 hover:bg-red-500/40 text-red-400 px-2 py-1 rounded transition-colors font-bold ml-2"
                      >
                        중지
                      </button>
                    ) : (
                      <button 
                        onClick={() => alert("백엔드 서버가 중지되어 있습니다. 터미널에서 06_visual_dashboard/backend 폴더로 이동한 뒤 'python dashboard_main.py' 를 실행해 서버를 다시 시작해주세요.")} 
                        className="text-xs bg-indigo-500/20 hover:bg-indigo-500/40 text-indigo-400 px-2 py-1 rounded transition-colors font-bold ml-2"
                      >
                        시작 방법
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end space-x-3">
              <button
                onClick={handleSaveSettings}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
              >
                저장 및 닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

