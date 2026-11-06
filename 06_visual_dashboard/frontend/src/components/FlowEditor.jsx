// FlowEditor.jsx
// --------------
// 노드·엣지로 에이전트 대화 흐름(그래프)을 그리는 편집 화면 (ReactFlow = @xyflow/react).
//
// 구성
//   - tutorialConfigs : 실습 단계(step0~4, free)별 초기 그래프와 설명
//   - TabNode         : 코드 에디터 탭 모양의 커스텀 노드 카드
//   - NodeEditModal   : 노드 설정 편집 + 실시간 예시 코드 프리뷰
//   - CodeModal       : 노드의 예시 코드 보기
//   - FlowEditor      : 위를 묶는 메인 컴포넌트. '실행' 시 nodes/edges를 App에 전달
//
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SCENARIOS, defaultScenario } from '../scenarios';

// ── 표시용 변환 함수: 노드 이름(label)을 보고 '파일명/클래스명/도움말/예시 코드'를 만들어 노드 카드에 보여 준다.
// 실제 실행과는 무관하며, 학습자가 "이 노드는 어떤 코드에 해당하는가"를 보게 하는 장식이다.

// 노드 이름 → 가상의 파일명 (예: '기획자' → planner.py)
// 영문 이름이면 " (…)" 괄호 부분을 떼고 소문자·밑줄로 바꾼다. 한글 이름은 agent_<id>.py 로 만든다.
const getFileName = (label, id) => {
  if (label.includes('기획자')) return 'planner.py';
  if (label.includes('개발자')) return 'developer.py';
  if (label.includes('프롬프트')) return 'prompt.py';
  if (label.includes('모델')) return 'model.py';
  if (label.includes('파서')) return 'parser.py';
  if (label.includes('에이전트') || label.includes('엔지니어')) return 'agent.py';

  if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(label)) {
    return `agent_${id}.py`;
  }

  return `${label.replace(/ \(.+\)/, '').replace(/ /g, '_').toLowerCase()}.py`;
};

// 노드 이름 → 가상의 파이썬 클래스명 (예: '개발자' → Developer)
const getClassName = (label, id) => {
  if (label.includes('기획자')) return 'Planner';
  if (label.includes('개발자')) return 'Developer';
  if (label.includes('프롬프트')) return 'PromptTemplate';
  if (label.includes('모델')) return 'ChatModel';
  if (label.includes('파서')) return 'StrOutputParser';
  if (label.includes('에이전트') || label.includes('엔지니어')) return 'Agent';

  if (/[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(label)) {
    return `Agent_${id.replace(/-/g, '_')}`;
  }

  return label.replace(/ \(.+\)/, '').replace(/ /g, '');
};

// 노드 배지에 마우스를 올렸을 때 보이는 한 줄 설명
const getNodeHelpText = (label) => {
  if (label.includes('프롬프트')) return "프롬프트 템플릿: 변수를 포함한 템플릿 문장으로 사용자 입력을 감쌉니다.";
  if (label.includes('모델') || label.includes('LLM')) return "언어 모델: 프롬프트를 입력받아 LLM(AI)이 판단하고 응답을 생성합니다.";
  if (label.includes('파서') || label.includes('Parser')) return "출력 파서: AI의 복잡한 메시지 객체에서 실제 텍스트 결과만 추출합니다.";
  if (label.includes('기획자')) return "기획 에이전트: 기획자 페르소나를 부여받아 요구사항을 분석하고 기획안을 작성합니다.";
  if (label.includes('개발자')) return "개발 에이전트: 개발자 페르소나를 부여받아 기술 스택 및 구현 가능성을 검토합니다.";
  return "에이전트 노드: 시스템 프롬프트를 통해 지정된 역할(Role)을 자율적으로 수행합니다.";
};

// 제공자별 기본 모델 (제공자를 바꾸면 이 모델로 함께 바뀐다)
const DEFAULT_MODELS = { gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', openai: 'gpt-4o' };

// 노드 설정(역할·제공자·모델·컨텍스트)을 LangChain 파이썬 예시 코드 문자열로 만든다.
// 노드 편집창의 '실시간 코드 프리뷰'와 코드 보기 창에 쓰인다. (보여 주기용 예시이며 서버가 실행하는 코드가 아니다)
const getCodeSnippet = (nodeLabel, provider = 'gemini', model_name = null, context = '') => {
  const isGemini = provider === 'gemini';
  const isDeepSeek = provider === 'deepseek';
  // DeepSeek는 OpenAI 호환 API라서 ChatOpenAI에 base_url만 바꿔 쓴다
  const importLLM = isGemini 
    ? 'from langchain_google_genai import ChatGoogleGenerativeAI' 
    : 'from langchain_openai import ChatOpenAI';
  
  const finalModel = model_name || (isGemini ? 'gemini-2.5-flash' : isDeepSeek ? 'deepseek-chat' : 'gpt-4o');
  
  const initLLM = isGemini
    ? `llm = ChatGoogleGenerativeAI(model="${finalModel}")`
    : isDeepSeek
      ? `llm = ChatOpenAI(model="${finalModel}", base_url="https://api.deepseek.com")`
      : `llm = ChatOpenAI(model="${finalModel}", temperature=0.7)`;

  if (nodeLabel.includes('기획자') || nodeLabel.includes('개발자') || nodeLabel.includes('에이전트') || nodeLabel.includes('엔지니어')) {
    let role = 'agent';
    let promptDesc = 'prompt';
    if (nodeLabel.includes('기획자')) {
      role = 'planner';
      promptDesc = 'f"기획자로서 다음을 기획하세요: {prompt}"';
    } else if (nodeLabel.includes('개발자')) {
      role = 'developer';
      promptDesc = 'f"개발자로서 다음 기획을 검토하고 아키텍처를 설계하세요: {prompt}"';
    }

    return `# 역할: ${nodeLabel}
# 컨텍스트: ${context || '역할에 따른 작업을 수행합니다.'}
from langchain.agents import initialize_agent, AgentType
${importLLM}

${initLLM}
agent = initialize_agent(
    tools=[], 
    llm=llm, 
    agent=AgentType.CHAT_CONVERSATIONAL_REACT_DESCRIPTION, 
    verbose=True
)

def run_${role}(prompt):
    return agent.run(${promptDesc})`;
  } else if (nodeLabel.includes('프롬프트')) {
    const finalPrompt = context || "주제 '{topic}'에 대한 흥미로운 이야기를 작성해주세요.";
    return `# 역할: ${nodeLabel}
from langchain.prompts import PromptTemplate

prompt = PromptTemplate.from_template(
    "${finalPrompt}"
)
# prompt.format(topic="인공지능")`;
  } else if (nodeLabel.includes('모델') || nodeLabel.includes('LLM')) {
    const modelInit = isGemini
      ? `ChatGoogleGenerativeAI(model="${finalModel}")`
      : isDeepSeek
        ? `ChatOpenAI(model="${finalModel}", base_url="https://api.deepseek.com")`
        : `ChatOpenAI(model="${finalModel}")`;
    return `# 역할: ${nodeLabel}
# 설명: ${context || '언어 모델을 활용하여 답변을 생성합니다.'}
${importLLM}

model = ${modelInit}
# response = model.invoke("안녕, 넌 누구니?")`;
  } else if (nodeLabel.includes('파서')) {
    return `# 역할: ${nodeLabel}
# 설명: ${context || '출력 결과값을 깨끗한 문자열로 파싱합니다.'}
from langchain.schema.output_parser import StrOutputParser

parser = StrOutputParser()
# chain = prompt | model | parser
# chain.invoke({"topic": "우주"})`;
  }
  return `# 관련 코드가 등록되지 않은 노드입니다.\n# 노드 이름: ${nodeLabel}`;
};

// 예시 코드에서 LangChain 핵심 용어(Model/Prompt/Parser/Chain/Agent/Memory)를 색 배지로 강조한다.
// dangerouslySetInnerHTML로 HTML을 직접 넣으므로 먼저 < > 를 이스케이프한다.
// (주의: & 는 이스케이프하지 않는다. 사용자 입력이 코드에 섞이는 구조라 신뢰할 수 없는 입력을 넣지 말 것)
const highlightLangChain = (code) => {
  let highlighted = code
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");


  highlighted = highlighted.replace(/\b(ChatOpenAI|ChatGoogleGenerativeAI|llm|model)\b/g, '<span class="bg-blue-500/20 text-blue-300 px-1 rounded border border-blue-500/30" title="1. Model (언어 모델)">$1</span>');


  highlighted = highlighted.replace(/\b(PromptTemplate|prompt|template)\b/g, '<span class="bg-green-500/20 text-green-300 px-1 rounded border border-green-500/30" title="2. Prompt (프롬프트)">$1</span>');


  highlighted = highlighted.replace(/\b(StrOutputParser|parser)\b/g, '<span class="bg-orange-500/20 text-orange-300 px-1 rounded border border-orange-500/30" title="3. Output Parser (출력 파서)">$1</span>');


  highlighted = highlighted.replace(/\b(chain)\b/g, '<span class="bg-purple-500/20 text-purple-300 px-1 rounded border border-purple-500/30" title="4. Chain (체인)">$1</span>');
  highlighted = highlighted.replace(/(\|)/g, '<span class="text-purple-400 font-black px-1" title="LCEL Chain Operator">$1</span>');


  highlighted = highlighted.replace(/\b(initialize_agent|AgentType|agent|tools)\b/g, '<span class="bg-rose-500/20 text-rose-300 px-1 rounded border border-rose-500/30" title="5. Agent & Tools (에이전트/도구)">$1</span>');


  highlighted = highlighted.replace(/\b(ConversationBufferMemory|memory|VectorStore|Retriever)\b/g, '<span class="bg-teal-500/20 text-teal-300 px-1 rounded border border-teal-500/30" title="6. Memory & Indexes (기억 및 색인)">$1</span>');


  highlighted = highlighted.replace(/(#.*)/g, '<span class="text-slate-500 italic">$1</span>');

  return { __html: highlighted };
};

// 노드 카드를 클릭하면 뜨는 '예시 코드 보기' 팝업. 바깥을 클릭하면 닫히고, 안쪽 클릭은 전파를 막아 유지한다.
const CodeModal = ({ node, onClose }) => {
  if (!node) return null;
  const codeSnippet = getCodeSnippet(node.data.label, node.data.provider, node.data.model_name, node.data.context);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl shadow-2xl w-[650px] max-w-[90vw] overflow-hidden flex flex-col transform transition-all" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 bg-[#2d2d2d] border-b border-[#111111]">
          <div className="flex items-center space-x-3">
            <span className="bg-indigo-500 text-white text-[10px] px-2.5 py-0.5 rounded uppercase font-black tracking-widest shadow-sm">
              {node.data.label}
            </span>
            <span className="text-sm font-mono text-gray-300 tracking-wider">
              {getFileName(node.data.label, node.id)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-5 bg-[#1e1e1e] overflow-auto max-h-[60vh] custom-scrollbar">
          <pre className="text-sm font-mono text-indigo-100 whitespace-pre-wrap leading-relaxed">
            <code dangerouslySetInnerHTML={highlightLangChain(codeSnippet)} />
          </pre>
        </div>

        <div className="px-4 py-3 bg-[#2d2d2d] border-t border-[#111111] flex justify-end">
          <button
            onClick={() => navigator.clipboard.writeText(codeSnippet)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded transition-colors mr-2"
          >
            코드 복사
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};

// 노드 편집 팝업: 이름·제공자·모델·컨텍스트를 수정하고 [저장]하면 해당 노드의 data에 반영된다.
// 왼쪽 폼을 바꾸면 오른쪽 코드 프리뷰가 즉시 갱신된다. (저장 전에는 노드가 바뀌지 않는다)
const NodeEditModal = ({ nodeId, nodes, setNodes, onClose }) => {
  const node = nodes.find(n => n.id === nodeId);

  const [formData, setFormData] = useState({
    label: node?.data?.label || '',
    provider: node?.data?.provider || 'gemini',
    model_name: node?.data?.model_name || DEFAULT_MODELS[node?.data?.provider] || 'gemini-2.5-flash',
    context: node?.data?.context || ''
  });

  if (!node) return null;

  // 제공자를 바꾸면 모델도 그 제공자의 기본 모델로 함께 바꾼다 (OpenAI 모델을 Gemini에 쓰는 실수 방지)
  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'provider') {
      setFormData(prev => ({ ...prev, provider: value, model_name: DEFAULT_MODELS[value] }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSave = () => {
    setNodes(nds => nds.map(n =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...formData } } : n
    ));
    onClose();
  };


  const liveCodeSnippet = getCodeSnippet(formData.label, formData.provider, formData.model_name, formData.context);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1e1e1e] border border-[#333333] rounded-xl shadow-2xl w-[850px] max-w-[95vw] flex flex-col transform transition-all overflow-hidden" onClick={e => e.stopPropagation()}>
        
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#2d2d2d] border-b border-[#111111]">
          <span className="text-sm font-bold text-gray-200">노드 설정 및 코드 미리보기 (Editor & Code Preview)</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">✕</button>
        </div>

        {/* 바디: 2열 구조 (폼 설정 vs 코드 프리뷰) */}
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#333333] bg-[#1e1e1e] overflow-y-auto max-h-[70vh]">
          {/* 폼 설정 영역 (왼쪽) */}
          <div className="w-full md:w-1/2 p-5 space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">노드 이름 (역할)</label>
              <input name="label" value={formData.label} onChange={handleChange} className="w-full bg-[#111111] border border-[#333333] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">LLM 제공자 (Provider)</label>
              <select name="provider" value={formData.provider} onChange={handleChange} className="w-full bg-[#111111] border border-[#333333] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="gemini">Gemini</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">상세 모델 (Model)</label>
              <select name="model_name" value={formData.model_name} onChange={handleChange} className="w-full bg-[#111111] border border-[#333333] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {formData.provider === 'openai' ? (
                  <>
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </>
                ) : formData.provider === 'deepseek' ? (
                  <>
                    <option value="deepseek-chat">deepseek-chat (추천)</option>
                    <option value="deepseek-reasoner">deepseek-reasoner (추론·느림)</option>
                  </>
                ) : (
                  <>
                    <option value="gemini-2.5-flash">gemini-2.5-flash (추천)</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-1">컨텍스트 (프롬프트 지시사항)</label>
              <textarea name="context" value={formData.context} onChange={handleChange} rows={4} className="w-full bg-[#111111] border border-[#333333] text-gray-200 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"></textarea>
            </div>
          </div>

          {/* 코드 프리뷰 영역 (오른쪽) */}
          <div className="w-full md:w-1/2 p-5 bg-[#151515] flex flex-col justify-between overflow-auto">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] bg-slate-800 text-indigo-300 font-bold px-2 py-0.5 rounded-full uppercase tracking-wider font-mono">
                  실시간 코드 프리뷰 ({getFileName(formData.label, node.id)})
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(liveCodeSnippet)}
                  className="text-xs text-gray-400 hover:text-white transition-colors underline"
                >
                  코드 복사
                </button>
              </div>
              <pre className="text-xs font-mono text-indigo-100 whitespace-pre-wrap leading-relaxed select-text">
                <code dangerouslySetInnerHTML={highlightLangChain(liveCodeSnippet)} />
              </pre>
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="px-4 py-3 bg-[#2d2d2d] border-t border-[#111111] flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded transition-colors mr-2">취소</button>
          <button onClick={handleSave} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors">저장</button>
        </div>
      </div>
    </div>
  );
};


// ReactFlow에 등록하는 커스텀 노드: 코드 에디터 탭 모양의 카드.
//  - 헤더: 역할 배지(+도움말), 가상 파일명, 편집/삭제 버튼
//  - 본문: 노드 설정을 파이썬 클래스처럼 보여 줌 (역할·컨텍스트·provider)
//  - Handle: 엣지를 연결하는 왼쪽(입력)·오른쪽(출력) 점
// 편집/삭제 버튼은 window 커스텀 이벤트('edit-node','delete-node')로 FlowEditor에 알린다.
// (노드 컴포넌트가 FlowEditor의 상태 함수를 직접 받지 못하기 때문)
const TabNode = ({ id, data, selected }) => {
  // 사람 승인(HITL) 노드: LLM 대신 사람이 결정하는 칸. 실행이 여기서 멈추고 결과 패널에 승인 카드가 뜬다.
  //  나가는 연결선 이름은 '승인'(다음으로)과 '수정'(앞 노드로 되돌림)을 쓴다. 되돌림은 아래쪽 점을 쓴다.
  if (data.label === '__human__') {
    return (
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-full border-2 shadow-md bg-amber-500/20 border-amber-500 text-amber-400 ${selected ? 'ring-2 ring-indigo-500' : ''}`} title="사람 승인 (HITL): 여기서 실행이 멈추고 사람이 승인/수정 요청/중단을 선택합니다. LLM 호출 없음.">
        <span className="text-xs font-black tracking-wider">👤 사람 승인</span>
        <button
          className="text-slate-400 hover:text-red-400 transition-colors text-xs leading-none"
          title="노드 삭제"
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('delete-node', { detail: { id } })); }}
        >
          ✕
        </button>
        <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />
        <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />
        <Handle id="b-in" type="target" position={Position.Bottom} style={{ left: '30%' }} className="w-2.5 h-2.5 bg-fuchsia-500 border-2 border-[#1e1e1e]" />
        <Handle id="b-out" type="source" position={Position.Bottom} style={{ left: '70%' }} className="w-2.5 h-2.5 bg-fuchsia-500 border-2 border-[#1e1e1e]" />
      </div>
    );
  }

  // START/END는 LLM을 호출하지 않는 '표시'라서 코드 카드 대신 작은 알약 모양으로 그린다.
  //  START: 출력(오른쪽)만 / END: 입력(왼쪽)만 가진다
  if (data.label === '__start__' || data.label === '__end__') {
    const isStart = data.label === '__start__';
    return (
      <div className={`flex items-center gap-2 px-4 py-2 rounded-full border-2 shadow-md ${isStart ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-red-500/20 border-red-500 text-red-400'} ${selected ? 'ring-2 ring-indigo-500' : ''}`} title={isStart ? '시작 표시 (LLM 호출 없음)' : '끝 표시 (LLM 호출 없음)'}>
        <span className="text-xs font-black tracking-wider">{isStart ? '▶ START' : 'END ■'}</span>
        <button
          className="text-slate-400 hover:text-red-400 transition-colors text-xs leading-none"
          title="노드 삭제"
          onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('delete-node', { detail: { id } })); }}
        >
          ✕
        </button>
        {isStart
          ? <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />
          : <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />}
      </div>
    );
  }

  const badgeColor = data.label === '__start__' ? 'bg-green-600' :
    data.label === '__end__' ? 'bg-red-600' :
      data.label.includes('기능') ? 'bg-blue-600' : 'bg-indigo-500';

  return (
    <div className={`flex flex-col bg-[#1e1e1e] border border-[#333333] shadow-xl w-[300px] transition-all ${selected ? 'ring-2 ring-indigo-500 shadow-indigo-500/30' : 'hover:border-[#555555]'}`}>
      {/* 탭 헤더 영역 (노드 명칭 명시) */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#2d2d2d] border-b border-[#111111] cursor-pointer">
        <div className="flex items-center space-x-2">
          {/* Node 뱃지 및 툴팁 */}
          <div className="relative group flex items-center">
            <span className={`${badgeColor} text-white text-[10px] px-2 py-0.5 rounded font-black tracking-wider shadow-sm max-w-[120px] truncate cursor-help`}>
              {data.label}
            </span>
            <div className="absolute left-0 top-full mt-1.5 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-2.5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[100] pointer-events-none">
              <span className="text-[11px] font-medium text-indigo-100 leading-tight block whitespace-pre-wrap">
                {getNodeHelpText(data.label)}
              </span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-gray-300 tracking-wider">
            {getFileName(data.label, id)}
          </span>
        </div>
        <div className="flex space-x-1.5 items-center">
          <button
            className="text-gray-400 hover:text-white transition-colors p-0.5"
            title="노드 편집"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('edit-node', { detail: { id } }));
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
            </svg>
          </button>
          <button
            className="text-gray-400 hover:text-red-400 transition-colors p-0.5 mr-1"
            title="노드 삭제"
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent('delete-node', { detail: { id } }));
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="w-2 h-2 rounded-full bg-slate-500 hover:bg-red-400 transition-colors ml-1"></div>
        </div>
      </div>

      {/* 에이전트 본문 */}
      <div className="p-4 bg-[#1e1e1e] text-sm flex flex-col justify-center border-t border-white/5">
        <div className="text-slate-500 text-[10px] font-mono mb-1"># 역할: {data.label}</div>
        <div className="text-indigo-400 font-bold mb-1 font-mono text-xs">class <span className="text-green-400">{getClassName(data.label, id)}</span>:</div>
        <div className="text-gray-400 text-[10px] font-mono pl-4 opacity-80 leading-relaxed">
          def run(self):
          <div className="pl-4 whitespace-pre-wrap break-words text-yellow-100/70 line-clamp-3" title={data.context}>
            """{data.context}"""
          </div>
          <div className="pl-4">
            provider = "{data.provider}"
          </div>
        </div>
      </div>

      {/* 기본 연결점: 왼쪽=입력, 오른쪽=출력 (엣지를 직접 연결할 때 사용) */}
      <Handle type="target" position={Position.Left} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />
      <Handle type="source" position={Position.Right} className="w-3 h-3 bg-indigo-500 border-2 border-[#1e1e1e]" />
      {/* 아래쪽 연결점: '되돌아가는' 엣지(step4 보완 요청 루프)를 노드 아래로 돌려 글자와 겹치지 않게 한다 */}
      <Handle id="b-in" type="target" position={Position.Bottom} style={{ left: '30%' }} className="w-2.5 h-2.5 bg-fuchsia-500 border-2 border-[#1e1e1e]" />
      <Handle id="b-out" type="source" position={Position.Bottom} style={{ left: '70%' }} className="w-2.5 h-2.5 bg-fuchsia-500 border-2 border-[#1e1e1e]" />
    </div>
  );
};


// 엣지 라벨의 공통 스타일 (배경·글자색·굵기)
const edgeStyleProps = {
  labelBgStyle: { fill: '#1e293b', fillOpacity: 0.8 },
  labelStyle: { fill: '#818cf8', fontWeight: 800, fontSize: 11 },
};


// 실습 단계(mode)별 초기 그래프와 설명. 단계를 바꾸면 이 설정으로 캔버스가 다시 채워진다.
//   nodes/edges: 시작 그래프 / title·desc: 카드에 표시할 제목·설명 / helpTips: 물음표 아이콘의 학습 포인트
// 주의: 엣지 라벨 'EDGE'는 백엔드에서 "라벨이 있는 엣지"로 취급되어 조건부 분기가 된다.
//       (답변에 'edge'가 없으면 첫 경로로 가므로 직선처럼 동작하지만, 로컬 모드는 'EDGE'를 라벨로 보지 않는다)
const tutorialConfigs = {
  step5: {
    nodes: [],
    edges: [],
    flow: ['작성자', '평가자', '통과 → END', '재작성 ↺ 작성자'],
    flowNote: '평가자의 한 단어("통과"/"재작성")가 종료를 결정합니다',
    title: 'Step 5: 평가-개선 루프',
    desc: '작성자가 쓰고 평가자가 "통과" 또는 "재작성"으로 판정합니다. 통과하면 END로 끝나고, 재작성이면 작성자로 되돌아가 다시 씁니다. 종료를 정하는 것은 연결선 이름입니다.',
    helpTips: [
      "평가-개선 루프(Evaluator–Optimizer): 결과가 기준을 만족할 때까지 고쳐 쓰게 하는 대표적인 반복 패턴입니다.",
      "종료 조건: 평가자의 답변에 연결선 이름('통과')이 들어 있으면 END로 나갑니다.",
      "안전 장치: 끝나지 않으면 로컬은 10번, 백엔드는 20단계에서 멈춥니다. 평가 기준이 너무 까다로우면 비용만 늘어납니다.",
      "판정 노드는 한 단어만 쓰게 하세요. '통과'와 '불통과'처럼 서로 포함되는 선 이름은 쓰면 안 됩니다."
    ]
  },
  step6: {
    nodes: [],
    edges: [],
    flow: ['분류기', '버그 → 개발자 ↔ 검증자', '문의 → 답변', 'END'],
    flowNote: '분기와 루프가 한 그래프에 함께 있습니다',
    title: 'Step 6: 분기 + 루프 결합',
    desc: '분류기가 입력을 분기하고, 한 경로에는 "수정 ↔ 검증" 루프가 있습니다. 실제 업무 흐름처럼 갈라지는 길과 되돌아가는 길이 함께 있는 구조를 익힙니다.',
    helpTips: [
      "분기: 분류기의 한 단어 답변이 어느 길로 갈지 정합니다.",
      "루프: 검증자가 통과시킬 때까지 개발자로 되돌아갑니다. 되돌림 선은 노드 아래쪽 점을 씁니다.",
      "경로 확인: 결과 패널에 찍히는 노드 순서로 어느 경로를 탔는지 볼 수 있습니다.",
      "비용: 경로마다 호출 수가 다릅니다. 루프 경로는 되돌아갈수록 호출이 늘어납니다."
    ]
  },
  step7: {
    nodes: [],
    edges: [],
    flow: ['작성자', '👤 사람 승인', 'END'],
    flowNote: '사람이 승인해야 루프가 끝나고, 수정 의견은 작성자에게 전달됩니다',
    title: 'Step 7: 사람 승인 (HITL)',
    desc: '루프를 계속할지 끝낼지를 사람이 결정합니다. 그래프가 "사람 승인" 노드에서 멈추고, 사람이 승인 · 수정 요청 · 중단을 선택해야 이어집니다. 매 라운드 사람이 확인하는 방식과, AI 루프 뒤에 사람이 마지막에만 확인하는 방식(혼합형)을 비교해 봅니다.',
    helpTips: [
      "HITL(Human-in-the-Loop): 루프 안에 사람을 넣어 계속/종료를 사람이 정하는 방식입니다. 되돌리기 어려운 행동 앞에서 특히 중요합니다.",
      "두 가지 배치: ① 사람이 루프를 승인(매 라운드 확인, AI 평가 없음) ② AI 루프 + 사람 최종 관문(마지막에만 확인). 예제에서 비교해 보세요.",
      "멈춤과 이어하기: 백엔드는 LangGraph의 interrupt()와 체크포인터로 상태를 저장해 두었다가 결정이 오면 이어서 실행합니다.",
      "연결선 이름: 사람 승인 노드에서 나가는 선은 '승인'(다음으로)과 '수정'(되돌림)을 씁니다. 수정 의견은 다음 노드의 입력이 됩니다.",
      "비용: 사람 승인 노드는 LLM을 호출하지 않아 호출 횟수에 세지 않습니다. 단, 수정을 반복하면 에이전트 호출이 늘어납니다."
    ]
  },
  free: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '기획자', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '당신은 PM입니다. 스터디 카페 좌석 예약 앱의 핵심 기능 3가지를 제안하세요.' } },
      { id: '2', type: 'tabNode', position: { x: 400, y: 120 }, data: { label: '개발자', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '앞선 기획의 구현 난이도를 상·중·하로 평가하고 이유를 한 줄로 쓰세요.' } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2', label: 'EDGE', ...edgeStyleProps }],
    flow: ['기획자','개발자'],
    flowNote: 'START → 노드들 → END 로 직접 연결해 보세요',
    title: '자유 설계 모드 (Free Design)',
    desc: '원하는 노드를 연결하여 자유로운 대화 흐름을 시뮬레이션하세요. 순환(Cycle) 엣지 생성 시 무한 루프에 주의하세요.',
    helpTips: [
      "[+ 노드 추가] 버튼을 눌러 에이전트를 마음껏 추가해 보세요.",
      "노드 상단의 편집(✏️) 버튼으로 역할을 자유롭게 바꿀 수 있습니다.",
      "복잡한 다중 에이전트 시스템을 직접 기획하고 테스트해 보세요."
    ]
  },
  step0: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '프롬프트 (Prompt)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: 'RAG(검색 증강 생성)' } },
      { id: '2', type: 'tabNode', position: { x: 400, y: 120 }, data: { label: '언어 모델 (LLM)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '당신은 어려운 IT 개념을 초등학생도 이해하게 일상 비유로 3문장 이내로 설명하는 선생님입니다.' } },
      { id: '3', type: 'tabNode', position: { x: 800, y: 120 }, data: { label: '출력 파서 (Parser)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '생성된 메시지를 문자열로 파싱' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2', label: '| 파이프', animated: true, ...edgeStyleProps },
      { id: 'e2-3', source: '2', target: '3', label: '| 파이프', animated: true, ...edgeStyleProps }
    ],
    flow: ['프롬프트','언어 모델','출력 파서'],
    flowNote: '이 단계는 연결선이 아니라 노드 이름 키워드로 순서가 정해집니다',
    title: 'Step 0: LangChain LCEL 체인 기초',
    desc: 'LangGraph를 다루기 전 필수인 LCEL (LangChain Expression Language)의 기초 구조(Prompt | Model | Parser)를 시각적으로 확인합니다.',
    helpTips: [
      "프롬프트(PromptTemplate): 변수를 포함한 템플릿 문장으로 사용자 입력을 감쌉니다.",
      "모델(ChatModel): 프롬프트를 입력받아 LLM(AI)이 판단하고 응답합니다.",
      "파서(OutputParser): AI의 복잡한 메시지 객체에서 실제 텍스트 결과만 추출합니다.",
      "LCEL 문법: 파이프(|) 기호로 각 컴포넌트를 물 흐르듯 연결합니다."
    ]
  },
  step1: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '단일 에이전트 (Agent)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '파이썬 리스트 컴프리헨션이 길어질 때 가독성을 지키는 방법을 3가지로 알려주세요.' } },
    ],
    edges: [],
    flow: ['단일 에이전트'],
    flowNote: '이 단계는 연결선이 아니라 노드 이름 키워드로 순서가 정해집니다',
    title: 'Step 1: 단일 에이전트 구동',
    desc: '단 하나의 에이전트 노드에 역할(Role)과 성격(Context)을 지정한 후 직접 호출하여 독립적인 피드백을 수신합니다.',
    helpTips: [
      "단일 에이전트: 시스템 프롬프트를 통해 AI에게 특정 역할(페르소나)을 부여합니다.",
      "프롬프트 엔지니어링: Context 필드에 구체적인 행동 강령을 입력할수록 정확도가 높아집니다.",
      "단순 응답: 다른 에이전트의 개입 없이 한 번의 요청과 응답으로 종료됩니다."
    ]
  },
  step2: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '에이전트 (기획자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '동네 도서관 대출 기록을 바탕으로 책을 추천해 주는 챗봇 앱을 기획해 주세요.' } },
      { id: '2', type: 'tabNode', position: { x: 400, y: 120 }, data: { label: '에이전트 (개발자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '기획안의 기술적 실현 가능성을 프론트엔드·백엔드·DB 관점에서 각각 한 줄로 평가하고, 가장 큰 위험 1가지를 말해 주세요.' } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2', label: 'EDGE', animated: true, ...edgeStyleProps }],
    flow: ['기획자','개발자'],
    flowNote: '이 단계는 연결선이 아니라 노드 이름 키워드로 순서가 정해집니다',
    title: 'Step 2: 순차 에이전트 체이닝',
    desc: 'LangGraph 없이 순수 파이썬 상에서 에이전트 1(기획자)의 출력 결과를 에이전트 2(개발자)의 입력 변수로 직접 체이닝하여 실행합니다.',
    helpTips: [
      "순차적 연결: 첫 번째 AI의 결과물을 두 번째 AI가 입력받아 검토(Review)합니다.",
      "코드 레벨 체이닝: 단순 함수 호출처럼 체이닝되어 있어 분기 처리가 어렵습니다.",
      "LangGraph 도입의 필요성을 이해하기 위한 중간 실습 단계입니다.",
      "다음 Step 3과 결과는 거의 같습니다(둘 다 2번 호출). 달라지는 것은 구조이며, 분기·루프가 생기는 Step 4부터 차이가 드러납니다. (📖 매뉴얼 9번 참고)"
    ]
  },
  step3: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '에이전트 (기획자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '당신은 PM입니다. 동네 도서관 도서 추천 챗봇의 핵심 기능 3가지를 5줄 이내로 제안하세요.' } },
      { id: '2', type: 'tabNode', position: { x: 400, y: 120 }, data: { label: '에이전트 (개발자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '앞선 기획의 핵심 기능을 구현할 기술 스택을 3줄로 요약하세요.' } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2', label: 'EDGE', animated: true, ...edgeStyleProps }],
    flow: ['기획자','개발자'],
    title: 'Step 3: LangGraph 기초 흐름',
    desc: 'StateGraph of State를 기반으로 기획자 노드 -> 개발자 노드로 상태 데이터가 이전되며 순차 실행되는 그래프를 실습합니다.',
    helpTips: [
      "상태 관리(State): LangGraph에서 대화 기록과 데이터를 노드 간에 안전하게 공유하는 메모리입니다.",
      "노드(Node): 에이전트의 실제 작업 단위입니다. (기획자, 개발자 등)",
      "엣지(Edge): 상태가 어느 노드에서 다음 노드로 흘러갈지 제어하는 화살표입니다.",
      "Step 2와 호출 횟수·결과는 비슷합니다. 직선 흐름에서는 LangGraph의 이점이 작고, 분기·루프에서 차이가 커집니다. (📖 매뉴얼 9번 참고)"
    ]
  },
  step4: {
    nodes: [
      { id: '1', type: 'tabNode', position: { x: 0, y: 120 }, data: { label: '에이전트 (기획자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '당신은 PM입니다. 주제는 "동네 도서관 도서 추천 챗봇"입니다. 기획안(사용자·핵심 기능·기술 스택)을 5줄 이내로 쓰고, 개발자의 보완 요청이 있으면 그 부분을 반영해 고쳐 쓰세요.' } },
      { id: '2', type: 'tabNode', position: { x: 400, y: 120 }, data: { label: '에이전트 (개발자)', provider: 'gemini', model_name: 'gemini-2.5-flash', context: '당신은 개발자입니다. 기획안에 사용자·핵심 기능·기술 스택이 모두 있으면 첫 줄에 [승인] 이라고만 쓰세요. 부족하면 [승인]을 쓰지 말고 부족한 점 2가지를 들어 보완을 요청하세요.' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2', label: 'EDGE', animated: true, ...edgeStyleProps },
      { id: 'e2-1', source: '2', target: '1', sourceHandle: 'b-out', targetHandle: 'b-in', type: 'smoothstep', pathOptions: { offset: 45, borderRadius: 14 }, label: '보완 요청', style: { stroke: '#a855f7' }, ...edgeStyleProps },
    ],
    flow: ['기획자','개발자'],
    flowNote: '개발자가 [승인]을 쓸 때까지 아래쪽 점으로 되돌아감 (최대 3왕복)',
    title: 'Step 4: LangGraph 루프 및 라우팅',
    desc: '기획자와 개발자 간 순환 피드백 루프를 모방합니다. 백엔드 라우터(Router) 조건부 엣지가 활성화되어 최대 3회 왕복 후 자동 탈출하거나 [승인] 키워드가 감지되면 END로 안전하게 탈출합니다.',
    helpTips: [
      "순환(Loop): 반려 시 이전 노드로 돌아가 작업을 재수행하는 협업 패턴입니다.",
      "조건부 엣지(Conditional Edge): AI의 답변(승인 여부)에 따라 다음 경로를 결정합니다.",
      "안전 장치: 무한 루프를 막기 위해 그래프 호출 시 recursion_limit가 설정됩니다."
    ]
  },
};

// 그래프 편집 화면 (왼쪽).
//   props: onStartMeeting/onStopMeeting(실행·중지를 App에 알림), isMeetingActive, activeMode(실습 단계), activeCategory, theme('light'|'dark')
//   nodes/edges는 ReactFlow가 관리하는 상태이고, '실행' 시 현재 값을 그대로 App에 넘긴다.
// 단계 기본 그래프(노드 몇 개 + 연결)에 START/END를 붙여 돌려준다. (예제 시나리오를 고르면 항상 START/END가 보이게)
//  - START → 가장 왼쪽 노드, 가장 오른쪽 노드 → END
//  - step4는 개발자(2)가 [승인]하면 END로 나가는 선도 그려서 종료 조건을 보여 준다
// 참고: Step 0~2·4는 이 연결선이 아니라 노드 이름/ID로 실행되므로 START/END는 구조를 이해하기 위한 표시다.
const withStartEnd = (nodes, edges, mode) => {
  if (!nodes.length) return { nodes, edges };
  const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const y = first.position.y;
  const startNode = { id: 'start', type: 'tabNode', position: { x: first.position.x - 170, y: y + 12 }, data: { label: '__start__' } };
  const endNode = { id: 'end', type: 'tabNode', position: { x: last.position.x + 340, y: y + 12 }, data: { label: '__end__' } };
  const extra = [
    { id: 'e-start', source: 'start', target: first.id, animated: true },
    mode === 'step4'
      ? { id: 'e-end', source: last.id, target: 'end', label: '[승인]', animated: true }
      : { id: 'e-end', source: last.id, target: 'end', animated: true },
  ];
  return { nodes: [startNode, ...nodes, endNode], edges: [...extra.map((e) => ({ ...e, ...edgeStyleProps })), ...edges] };
};

export default function FlowEditor({ onStartMeeting, onStopMeeting, isMeetingActive, activeMode, activeCategory = 'langchain', theme = 'dark' }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [editingNodeId, setEditingNodeId] = useState(null);

  // nodeTypes는 렌더마다 새로 만들면 ReactFlow가 노드를 다시 그리므로 useMemo로 고정한다
  // ReactFlow 인스턴스: 단계가 바뀌거나 노드가 추가될 때 화면에 맞게 다시 맞추기(fitView) 위해 보관한다
  const rfRef = useRef(null);
  const refit = useCallback(() => {
    setTimeout(() => rfRef.current?.fitView({ padding: 0.18, minZoom: 0.4, maxZoom: 1, duration: 250 }), 80);
  }, []);

  const nodeTypes = useMemo(() => ({ tabNode: TabNode }), []);
  const isLangChain = activeCategory === 'langchain';

  const dynamicEdgeStyleProps = useMemo(() => ({
    labelBgStyle: { fill: '#1e293b', fillOpacity: 0.8 },
    labelStyle: { fill: isLangChain ? '#60a5fa' : '#c084fc', fontWeight: 800, fontSize: 11 },
  }), [isLangChain]);

  // 선택된 예제 시나리오 id (단계가 바뀌면 그 단계의 첫 시나리오로 초기화)
  const [scenarioId, setScenarioId] = useState(defaultScenario(activeMode).id);

  // 엣지에 색·라벨 스타일을 입힌다. (step4의 되돌림 선 'e2-1'은 자홍색)
  const styleEdge = useCallback((edge) => ({
    ...edge,
    labelStyle: { fill: isLangChain ? '#60a5fa' : '#c084fc', fontWeight: 800, fontSize: 11 },
    style: (edge.id === 'e2-1' || edge.sourceHandle === 'b-out') ? { stroke: '#d946ef' } : { stroke: isLangChain ? '#3b82f6' : '#a855f7' },
  }), [isLangChain]);

  // 시나리오를 캔버스에 적용한다.
  //  - graph가 있으면(자유 설계 예제): 노드 구성과 연결까지 통째로 교체
  //  - contexts만 있으면: 이 단계의 기본 그래프에 노드별 컨텍스트(입력·지시)만 채워 넣음
  // 적용하면 캔버스에서 편집한 내용은 사라지고 시나리오 구성으로 바뀐다.
  const applyScenario = useCallback((sc) => {
    const config = tutorialConfigs[activeMode] || tutorialConfigs.free;
    if (sc.graph) {
      setNodes(sc.graph.nodes.map((n) => ({
        id: n.id,
        type: 'tabNode',
        position: { x: n.x, y: n.y },
        data: { label: n.label, provider: 'gemini', model_name: 'gemini-2.5-flash', context: n.context || '' },
      })));
      setEdges(sc.graph.edges.map((e) => styleEdge({ ...e, animated: true, ...edgeStyleProps })));
    } else {
      const filled = config.nodes.map((n) => (
        sc.contexts && sc.contexts[n.id] !== undefined ? { ...n, data: { ...n.data, context: sc.contexts[n.id] } } : n
      ));
      const withSE = withStartEnd(filled, config.edges, activeMode);
      setNodes(withSE.nodes);
      setEdges(withSE.edges.map(styleEdge));
    }
    setScenarioId(sc.id);
    refit();
  }, [activeMode, setNodes, setEdges, styleEdge, refit]);

  // 실습 단계(또는 카테고리)가 바뀌면 그 단계의 기본 그래프 + 첫 번째 예제 시나리오로 캔버스를 초기화한다.
  useEffect(() => {
    applyScenario(defaultScenario(activeMode));
  }, [activeMode, isLangChain]); // eslint-disable-line react-hooks/exhaustive-deps

  // TabNode의 편집·삭제 버튼이 보낸 커스텀 이벤트를 받는다. 노드를 삭제하면 연결된 엣지도 함께 지운다.
  useEffect(() => {
    const handleEdit = (e) => setEditingNodeId(e.detail.id);
    const handleDelete = (e) => {
      setNodes((nds) => nds.filter(n => n.id !== e.detail.id));
      setEdges((eds) => eds.filter(ed => ed.source !== e.detail.id && ed.target !== e.detail.id));
    };
    window.addEventListener('edit-node', handleEdit);
    window.addEventListener('delete-node', handleDelete);
    return () => {
      window.removeEventListener('edit-node', handleEdit);
      window.removeEventListener('delete-node', handleDelete);
    };
  }, [setNodes, setEdges]);


  // 두 노드의 점(Handle)을 드래그해 연결하면 기본 라벨 'EDGE'로 엣지를 추가한다. (라벨은 수정 UI가 없다)
  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ 
      ...params, 
      label: 'EDGE', 
      ...dynamicEdgeStyleProps,
      style: { stroke: isLangChain ? '#3b82f6' : '#a855f7' },
      animated: true
    }, eds)),
    [setEdges, isLangChain, dynamicEdgeStyleProps],
  );

  const onNodeClick = useCallback((event, node) => {
    // START/END는 보여 줄 코드가 없으므로 코드 팝업을 열지 않는다
    if (['__start__', '__end__', '__human__'].includes(node.data?.label)) return;
    setSelectedNode(node);
  }, []);

  // 엣지를 더블클릭하면 삭제
  const onEdgeDoubleClick = useCallback((event, edge) => {
    setEdges(eds => eds.filter(e => e.id !== edge.id));
  }, [setEdges]);

  // '+ 에이전트 추가': 새 에이전트 노드를 무작위 위치에 만든다.
  // 프롬프트는 data.context에 넣는다. (실행 코드와 편집창이 읽는 필드이며, 편집창에서 수정할 수 있다)
  const onAddNode = useCallback(() => {
    const newNode = {
      id: `agent-${Date.now()}`,
      type: 'tabNode',
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: {
        label: `에이전트 ${nodes.length + 1}`,
        provider: 'gemini',
        model_name: 'gemini-2.5-flash',
        context: '당신은 유능한 AI 어시스턴트입니다.',
        role: 'agent'
      }
    };
    setNodes((nds) => nds.concat(newNode));
  }, [nodes, setNodes]);

  // START/END/기능 노드 추가.
  // START/END 노드의 라벨은 '__start__'/'__end__'여야 한다. 백엔드·로컬 실행기가 이 라벨로 시작·끝을 인식하고
  // LLM을 호출하지 않는다. (TabNode의 초록/빨강 배지도 이 라벨 기준)
  const onAddSpecialNode = useCallback((type) => {
    let role = type.toLowerCase();
    let label = type === 'START' ? '__start__' : type === 'END' ? '__end__' : type === 'HUMAN' ? '__human__' : '기능 (Function)';

    const newNode = {
      id: `${role}-${Date.now()}`,
      type: 'tabNode',
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: {
        label: label,
        role: role,
        context: '',
      }
    };
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes]);

  // LangChain 탭의 컴포넌트 추가 (프롬프트/모델/파서). 이름의 키워드로 실행 단계에서 역할을 찾는다.
  const onAddLangChainComponent = useCallback((type) => {
    let context = '';
    let label = '';
    if (type === 'PromptTemplate') {
      label = '프롬프트 (Prompt)';
      context = "주제 '{topic}'에 대한 이야기를 작성해줘.";
    } else if (type === 'ChatModel') {
      label = '언어 모델 (LLM)';
      context = "당신은 친절한 AI 어시스턴트입니다.";
    } else if (type === 'StrOutputParser') {
      label = '출력 파서 (Parser)';
      context = "결과 텍스트 파싱";
    }

    const newNode = {
      id: `${type.toLowerCase()}-${Date.now()}`,
      type: 'tabNode',
      position: { x: Math.random() * 200 + 100, y: Math.random() * 200 + 100 },
      data: {
        label: label,
        provider: 'gemini',
        model_name: 'gemini-2.5-flash',
        context: context,
        role: type.toLowerCase()
      }
    };
    setNodes((nds) => nds.concat(newNode));
  }, [setNodes]);

  // '실행' 버튼: 현재 캔버스의 nodes/edges를 App(handleStartMeeting)에 넘긴다
  // 최대 호출 횟수(LLM 호출 상한): 루프가 길어져 API 비용이 커지는 것을 막는다. 선택값은 브라우저에 기억한다.
  const [maxCalls, setMaxCalls] = useState(() => {
    try { const v = parseInt(localStorage.getItem('multiAgentMaxCalls'), 10); return v >= 1 && v <= 50 ? v : 10; } catch (e) { return 10; }
  });
  const changeMaxCalls = (v) => {
    const n = Math.max(1, Math.min(50, parseInt(v, 10) || 1));
    setMaxCalls(n);
    try { localStorage.setItem('multiAgentMaxCalls', String(n)); } catch (e) {}
  };
  // Step 0~2는 호출 수가 정해진 고정 시나리오(1~2회)라 상한을 적용하지 않는다
  const fixedCalls = ['step0', 'step1', 'step2'].includes(activeMode);

  // '실행' 버튼: 현재 캔버스의 nodes/edges와 호출 상한을 App(handleStartMeeting)에 넘긴다
  const handleStart = () => {
    onStartMeeting({ nodes, edges, maxCalls: fixedCalls ? 50 : maxCalls });
  };

  // 현재 단계의 제목·설명·학습 포인트 (알 수 없는 단계면 자유 설계 모드로 대체)
  const currentInfo = tutorialConfigs[activeMode] || tutorialConfigs.free;
  // 선택된 예제가 자체 연결 구조(flow)를 가지면 그것을, 아니면 단계 기본값을 보여 준다
  const activeScenario = (SCENARIOS[activeMode] || SCENARIOS.free).find((sc) => sc.id === scenarioId);
  const shownFlow = activeScenario?.flow || currentInfo.flow || [];
  const shownFlowNote = activeScenario?.flowNote || currentInfo.flowNote;

  // 연결 목록(왼쪽 패널 표시용): 노드 id를 이름으로 바꾸고 __start__/__end__는 START/END로 보여 준다
  const nameOf = (id) => {
    const l = nodes.find((n) => n.id === id)?.data?.label || id;
    return l === '__start__' ? 'START' : l === '__end__' ? 'END' : l === '__human__' ? '사람 승인' : l;
  };
  const connections = edges.map((e) => ({
    id: e.id,
    from: nameOf(e.source),
    to: nameOf(e.target),
    label: typeof e.label === 'string' && e.label !== 'EDGE' ? e.label.replace(/^EDGE\s*:\s*/, '') : '',
  }));
  // 노드가 2개 이상인데 어떤 연결에도 속하지 않은 노드(순서가 정해지지 않는다)
  const isolatedNodes = nodes.length > 1
    ? nodes.filter((n) => !edges.some((e) => e.source === n.id || e.target === n.id)).map((n) => nameOf(n.id))
    : [];


  const canvasBgClass = isLangChain 
    ? 'bg-[#030712] transition-colors duration-500' 
    : 'bg-[#0b051a] transition-colors duration-500';
  // 배경 점(dot) 색: 테마에 맞춰 어두운 배경엔 진한 색, 밝은 배경엔 옅은 색
  const gridColor = theme === 'light' ? (isLangChain ? '#bfdbfe' : '#e9d5ff') : (isLangChain ? '#1e3a8a' : '#581c87');

  return (
    <div className="flex w-full h-full">
      {/* 왼쪽 학습 패널: 단계 설명 · 노드 추가 · 실행 버튼. 캔버스 위에 떠 있지 않고 별도 열이라 노드를 가리지 않는다 */}
      <aside className="w-[300px] shrink-0 h-full overflow-hidden z-10 bg-slate-900 border-r border-slate-800 p-5 flex flex-col">
        {/* 스크롤 영역: 설명 · 연결 구조 · 노드 추가 (실행 버튼은 항상 보이도록 아래에 고정) */}
        <div className="flex-1 min-h-0 overflow-y-auto -mr-2 pr-2 flex flex-col">
        <div>
          <div className="flex items-center space-x-2 mb-2">
            <span className={`text-[10px] border font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${isLangChain ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-purple-500/10 text-purple-400 border-purple-500/30'}`}>
              {isLangChain ? '⛓️ LangChain LCEL' : '🕸️ LangGraph Engine'}
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-400 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
              {activeMode}
            </span>
          </div>

          <div className="flex items-center space-x-2 mb-3">
            <h2 className={`text-lg font-bold leading-snug ${isLangChain ? 'text-blue-300' : 'text-purple-300'}`}>{currentInfo.title}</h2>
            {/* 도움말 툴팁 아이콘 */}
            <div className="relative group">
              <button className="text-slate-400 hover:text-indigo-400 transition-colors p-1 rounded-full hover:bg-slate-800">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </button>

              {/* 도움말 팝업 (마우스 오버) */}
              <div className="absolute left-0 top-full mt-2 w-80 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl p-4 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none">
                <div className={`text-xs font-bold mb-2 uppercase tracking-wider ${isLangChain ? 'text-blue-400' : 'text-purple-400'}`}>학습 포인트 (Help)</div>
                <ul className="space-y-2">
                  {currentInfo.helpTips?.map((tip, idx) => (
                    <li key={idx} className="text-sm text-slate-300 flex items-start">
                      <span className={`${isLangChain ? 'text-blue-500' : 'text-purple-500'} mr-2 mt-0.5`}>•</span>
                      <span className="leading-relaxed">{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <p className="text-sm text-slate-400 leading-relaxed mb-6">
            {currentInfo.desc}
          </p>
        </div>

        {/* 예제 시나리오: 단계마다 여러 예제를 골라 적용해 보고, 나만의 시나리오를 구상하는 데 참고한다 */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">예제 시나리오</div>
            <div className="text-[10px] text-slate-500">{(SCENARIOS[activeMode] || SCENARIOS.free).length}개</div>
          </div>
          <div className="space-y-1.5">
            {(SCENARIOS[activeMode] || SCENARIOS.free).map((sc) => {
              const selected = sc.id === scenarioId;
              return (
                <div key={sc.id} className={`rounded-lg border transition-colors ${selected
                  ? (isLangChain ? 'bg-blue-500/10 border-blue-500/40' : 'bg-purple-500/10 border-purple-500/40')
                  : 'bg-slate-800/50 border-slate-700/50 hover:border-indigo-500/40'}`}>
                  <button onClick={() => applyScenario(sc)} className="w-full text-left px-3 py-2" title="이 시나리오를 캔버스에 적용">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[11px] ${selected ? 'text-indigo-400' : 'text-slate-500'}`}>{selected ? '●' : '○'}</span>
                      <span className="text-xs font-bold text-slate-200">{sc.title}</span>
                    </div>
                    {selected && <p className="text-[11px] text-slate-400 leading-relaxed mt-1 pl-4">{sc.summary}</p>}
                  </button>
                  {selected && (
                    <p className="text-[11px] text-slate-500 leading-relaxed px-3 pb-2 pl-7">👀 관찰 포인트: {sc.observe}</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed mt-2">시나리오를 고르면 캔버스가 그 구성으로 바뀝니다. 노드의 ✏ 로 입력을 고쳐 나만의 시나리오를 만들어 보세요. (📖 매뉴얼 8번 참고)</p>
        </div>

        {/* 연결 구조: 이 단계의 기본 구조 + 지금 캔버스에 그려진 연결 목록(삭제 가능) + 연결 안 된 노드 경고 */}
        <div className="mb-4 border-t border-slate-800 pt-4">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">연결 구조</div>
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            {shownFlow.map((name, i, arr) => (
              <React.Fragment key={i}>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${isLangChain ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' : 'bg-purple-500/10 text-purple-400 border-purple-500/30'}`}>{name}</span>
                {i < arr.length - 1 && <span className="text-slate-500 text-xs">→</span>}
              </React.Fragment>
            ))}
          </div>
          {shownFlowNote && <p className="text-[11px] text-slate-500 leading-relaxed mb-3">{shownFlowNote}</p>}

          <div className="text-[11px] text-slate-400 font-bold mb-1.5">현재 연결 {connections.length}개</div>
          {connections.length === 0 ? (
            <p className="text-[11px] text-slate-500 leading-relaxed">연결이 없습니다. 노드 <b>오른쪽 점</b>을 다른 노드의 <b>왼쪽 점</b>으로 끌어 연결하세요.</p>
          ) : (
            <ul className="space-y-1">
              {connections.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 bg-slate-800/50 border border-slate-700/50 rounded-md px-2 py-1 text-[11px] text-slate-300">
                  <span className="truncate max-w-[84px]" title={c.from}>{c.from}</span>
                  <span className="text-slate-500">→</span>
                  <span className="truncate max-w-[84px]" title={c.to}>{c.to}</span>
                  {c.label && <span className="ml-auto text-[10px] text-slate-500 truncate max-w-[56px]" title={c.label}>{c.label}</span>}
                  <button
                    onClick={() => setEdges((eds) => eds.filter((e) => e.id !== c.id))}
                    className={`${c.label ? '' : 'ml-auto'} text-slate-500 hover:text-red-400 transition-colors`}
                    title="이 연결 삭제"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          {isolatedNodes.length > 0 && (
            <p className="mt-2 text-[11px] text-amber-400 leading-relaxed">연결 안 된 노드: {isolatedNodes.join(', ')}</p>
          )}
        </div>

        {/* 노드 조작 툴바: 랭체인 / 랭그래프 모드에 맞춰 편집 지원 */}
        <div className="flex flex-col space-y-2 mt-auto mb-4 transition-all duration-300">
          {isLangChain ? (
            <div className="flex flex-col space-y-2 border-t border-slate-800/60 pt-4">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">컴포넌트 추가</span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  className="py-2 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg font-bold text-[10px] shadow-lg transition-all border border-slate-700/50"
                  onClick={() => onAddLangChainComponent('PromptTemplate')}
                >
                  📝 프롬프트
                </button>
                <button
                  className="py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded-lg font-bold text-[10px] shadow-lg transition-all border border-slate-700/50"
                  onClick={() => onAddLangChainComponent('ChatModel')}
                >
                  🤖 모델
                </button>
                <button
                  className="py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg font-bold text-[10px] shadow-lg transition-all border border-slate-700/50"
                  onClick={() => onAddLangChainComponent('StrOutputParser')}
                >
                  ⚙️ 파서
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col space-y-2">
              <div className="grid grid-cols-2 gap-2 mb-1">
                <button
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-green-400 rounded-lg font-bold text-xs shadow-lg transition-all border border-slate-700/50"
                  onClick={() => onAddSpecialNode('START')}
                >
                  🟢 START
                </button>
                <button
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-red-400 rounded-lg font-bold text-xs shadow-lg transition-all border border-slate-700/50"
                  onClick={() => onAddSpecialNode('END')}
                >
                  🔴 END
                </button>
                <button
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg font-bold text-xs shadow-lg transition-all border border-slate-700/50 col-span-2"
                  onClick={() => onAddSpecialNode('HUMAN')}
                  title="실행이 이 노드에서 멈추고 사람이 승인/수정 요청/중단을 선택합니다 (HITL)"
                >
                  👤 사람 승인 (HITL)
                </button>
                <button
                  className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-400 rounded-lg font-bold text-xs shadow-lg transition-all border border-slate-700/50 col-span-2"
                  onClick={() => onAddSpecialNode('FUNCTION')}
                >
                  ⚙️ 기능 (validate 등)
                </button>
              </div>
              <button
                className="w-full py-2.5 rounded-lg font-bold text-sm shadow-lg transition-all bg-purple-600 hover:bg-purple-500 text-white"
                onClick={onAddNode}
              >
                + 에이전트 추가
              </button>
            </div>
          )}
        </div>

        </div>

        <div className="pt-3 shrink-0">
        {/* 호출 상한: 에이전트 노드가 실행될 때마다 1회로 센다. 사람 승인·START/END는 세지 않는다 */}
        <div className="flex items-center justify-between mb-2.5" title="LLM 호출 횟수 상한. 넘으면 호출 전에 안전하게 종료합니다.">
          <label htmlFor="max-calls-input" className="text-[11px] text-slate-400 font-bold">최대 호출 횟수 <span className="font-normal text-slate-500">(비용 제한)</span></label>
          <input
            id="max-calls-input"
            type="number"
            min={1}
            max={50}
            value={fixedCalls ? '' : maxCalls}
            placeholder={fixedCalls ? '고정' : ''}
            disabled={fixedCalls}
            onChange={(e) => changeMaxCalls(e.target.value)}
            className="w-16 bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold text-center rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
          />
        </div>
        {isMeetingActive ? (
          <button
            id="stop-flow-btn"
            onClick={onStopMeeting}
            className="w-full bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg hover:shadow-red-500/25 active:scale-[0.98]"
          >
            {isLangChain ? '체인 실행 중단 (Stop Chain)' : '회의 중지 (Stop Flow)'}
          </button>
        ) : (
          <button
            id="run-flow-btn"
            onClick={handleStart}
            className={`w-full bg-gradient-to-r ${isLangChain ? 'from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500' : 'from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500'} text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-lg active:scale-[0.98]`}
          >
            {isLangChain ? '체인 실행 (Run Chain)' : '회의 시작 (Run Flow)'}
          </button>
        )}
        </div>
      </aside>

      {/* 가운데 캔버스: 드래그로 이동, 점을 끌어 연결, 엣지 더블클릭으로 삭제, 노드 클릭으로 코드 보기 */}
      <div className="flex-1 min-w-0 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeDoubleClick={onEdgeDoubleClick}
        fitView
        onInit={(inst) => { rfRef.current = inst; refit(); }}
        minZoom={0.3}
        connectionRadius={40}
        colorMode={theme}
        className={canvasBgClass}
      >
        <Controls className="bg-slate-900 border border-slate-800 text-slate-400 fill-slate-400 rounded-lg overflow-hidden [&_button]:border-slate-800 [&_button:hover]:bg-slate-800" />
        <Background variant="dots" gap={20} size={1} color={gridColor} />
      </ReactFlow>
      </div>

      {/* 팝업: 코드 보기(노드 클릭) / 노드 편집(연필 버튼) */}
      <CodeModal node={selectedNode} onClose={() => setSelectedNode(null)} />
      {editingNodeId && (
        <NodeEditModal
          nodeId={editingNodeId}
          nodes={nodes}
          setNodes={setNodes}
          onClose={() => setEditingNodeId(null)}
        />
      )}
    </div>
  );
}

