// localFlowRunner.js
// --------------------
// 로컬 실행 모드: 백엔드 서버 없이 브라우저가 Gemini·DeepSeek·OpenAI REST API를 직접 호출해 그래프를 실행한다.
// 키는 화면 설정 창에 입력한 값만 사용한다. (.env는 브라우저에서 읽을 수 없다)
//
// 지정 시간(ms) 동안 쉰다. 화면에서 단계가 하나씩 보이게 하려는 연출용이며,
// signal이 abort되면 즉시 reject해서 '중지' 버튼이 바로 먹히게 한다.
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('aborted'));
  const timer = setTimeout(() => {
    if (signal?.aborted) return reject(new Error('aborted'));
    resolve();
  }, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error('aborted'));
  });
});

// 역할(role) 하나가 LLM API를 1회 호출하고 답변 문자열을 돌려준다. (백엔드의 execute_agent와 같은 역할)
//  - 브라우저에서 REST로 직접 호출하며, 키는 설정 창에 입력한 apiKeys[provider]만 쓴다 (.env는 읽을 수 없다)
//  - 실패해도 throw하지 않고 "Error executing ..." 문자열을 돌려준다. 단, 중단(AbortError)은 다시 던진다.
//  - 주의: Gemini는 키를 URL 쿼리(?key=)에 담아 보내므로 브라우저 기록·네트워크 로그에 남을 수 있다.
async function callLLM(role, provider, modelName, context, userInput, apiKeys, signal) {
  const actualProvider = (provider || 'gemini').toLowerCase();
  const apiKey = apiKeys?.[actualProvider]?.trim();
  
  // 키가 없으면 호출하지 않고 즉시 오류 문장 반환 (fail-closed)
  if (!apiKey) {
    // 모의 응답 없이 명확한 오류로 중단 (키는 화면 입력란에 넣어야 함)
    return `Error executing ${actualProvider}: API 키가 없습니다. 화면의 API 키 입력란에 ${actualProvider} 키를 입력하세요.`;
  }

  try {
    if (actualProvider === 'openai' || actualProvider === 'deepseek') {
      // OpenAI와 DeepSeek는 같은 형식(chat/completions)이라 주소와 기본 모델만 다르다
      const endpoint = actualProvider === 'deepseek'
        ? 'https://api.deepseek.com/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const defaultModel = actualProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName || defaultModel,
          temperature: 0.7,
          messages: [
            { role: 'system', content: `You are a helpful assistant acting as a ${role} in a meeting. ${context}` },
            { role: 'user', content: userInput }
          ]
        }),
        signal
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.choices[0].message.content;
    } else if (actualProvider === 'gemini') {
      // 종료된 옛 모델 이름은 현재 모델로 바꿔 쓴다 (백엔드와 동일 규칙)
      let actualModel = modelName || 'gemini-2.5-flash';
      if (['gemini-1.5-pro', 'gemini-1.5-pro-latest', 'gemini-1.5-flash', 'gemini-pro'].includes(actualModel)) {
        actualModel = 'gemini-2.5-flash';
      }
      // Gemini REST는 system/user 구분 없이 하나의 텍스트로 합쳐 보낸다
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: `System: You are a helpful assistant acting as a ${role} in a meeting. ${context}\n\nUser: ${userInput}` }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.7,
          }
        }),
        signal
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return `Error executing ${provider} API (${modelName || 'default'}): ${error.message}`;
  }
}

// 호출 상한(maxCalls)에 도달했을 때 던지는 오류. 오류가 아니라 '안전 종료'로 처리한다.
class CallLimitError extends Error {
  constructor(limit) { super('call-limit'); this.limit = limit; }
}

// 로컬 실행 진입점. 백엔드의 run_flow + build_dynamic_graph를 브라우저에서 흉내 낸 것이다.
//   mode      : step0~step4 | free
//   nodes/edges: FlowEditor가 만든 그래프
//   onMessage : 진행 상황을 한 건씩 전달하는 콜백 ({type:'system'|'agent'|'error', role, content})
//   onComplete/onError: 정상·중단 종료 / 오류 종료 알림
//   signal    : AbortSignal (중지 버튼)
//   maxCalls  : LLM 호출 횟수 상한(API 비용 제한). 이 횟수를 넘는 호출은 하지 않고 안전 종료한다.
//   onApproval: 사람 승인(HITL) 노드를 만났을 때 호출. {role, question}을 받아 사용자의 결정
//               {action:'approve'|'revise'|'stop', feedback}을 Promise로 돌려줘야 한다.
// 차이점: LangGraph를 쓰지 않고 while 반복문으로 직접 순회한다.
//         step4 최대 횟수는 같다(노드 6회 = 3왕복). 다만 종료 판정이 다르다:
//         백엔드는 "[승인]" 토큰, 로컬은 "승인"이 포함되기만 해도 종료한다.
export async function executeLocalFlow({
  mode,
  nodes,
  edges,
  apiKeys,
  onMessage,
  onComplete,
  onError,
  signal,
  maxCalls = 10,
  onApproval
}) {
  // LLM 호출 횟수를 세어 상한을 넘기 전에 중단한다. (사람 승인 노드는 LLM을 부르지 않으므로 세지 않는다)
  let calls = 0;
  let approvals = 0;   // 사람 승인을 요청한 횟수 (승인 카드에 '몇 번째 확인'으로 표시)
  const limitedCall = async (...args) => {
    if (calls >= maxCalls) throw new CallLimitError(maxCalls);
    calls++;
    return callLLM(...args);
  };

  try {
    // 노드 배열을 id로 바로 찾을 수 있는 객체로 변환 (백엔드의 node_data_map과 같음)
    const nodeRoleMap = {};
    const nodeDataMap = {};
    nodes.forEach(node => {
      const node_id = node.id;
      nodeRoleMap[node_id] = node.data?.label || "Agent";
      nodeDataMap[node_id] = {
        label: node.data?.label || "Agent",
        provider: node.data?.provider || "gemini",
        model_name: node.data?.model_name || null,
        context: node.data?.context || ""
      };
    });

    // '프롬프트/모델/파서/PM/개발자' 같은 역할 노드를 이름(label)의 키워드로 찾는다. 못 찾으면 기본 id 사용.
    const findNodeByKeywords = (keywords, defaultId) => {
      for (const [nid, ndata] of Object.entries(nodeDataMap)) {
        const label = (ndata.label || "").toLowerCase();
        if (keywords.some(k => label.includes(k))) {
          return { id: nid, data: ndata };
        }
      }
      return { id: defaultId, data: nodeDataMap[defaultId] || {} };
    };

    onMessage({
      type: 'system',
      content: `다중 LLM 회의를 시작합니다. (로컬 실행 모드 / 실습 모드: ${mode})`
    });
    await sleep(500, signal);

    // ── step0: PromptTemplate → ChatModel → StrOutputParser (LLM 호출은 2단계에서 1회) ──
    if (mode === "step0") {
      const promptNode = findNodeByKeywords(["prompt", "프롬프트"], "1");
      const modelNode = findNodeByKeywords(["model", "llm", "모델"], "2");
      const parserNode = findNodeByKeywords(["parser", "파서"], "3");

      const topic = promptNode.data.context?.trim() || "랑체인(LangChain)과 랭그래프(LangGraph)";

      onMessage({ type: 'system', content: `[1단계: PromptTemplate] 입력 주제 '${topic}'에 맞춰 프롬프트를 구성합니다.` });
      await sleep(1000, signal);

      onMessage({ type: 'system', content: `[2단계: ChatModel] ${(modelNode.data.provider || 'gemini').toUpperCase()} API 모델(${modelNode.data.model_name || 'default'})을 호출하여 답변 생성을 요청합니다...` });
      
      const contextStr = modelNode.data.context?.trim() || "당신은 어려운 IT 개념을 초등학생도 이해하기 쉽게 비유를 들어 설명해주는 친절한 선생님입니다.";
      const userQuestion = `${topic}에 대해서 설명해주세요.`;
      
      const reply = await limitedCall(modelNode.data.label || 'ChatModel', modelNode.data.provider, modelNode.data.model_name, contextStr, userQuestion, apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: modelNode.id,
        role: modelNode.data.label || 'ChatModel',
        content: `AIMessage(content="${reply}")`
      });
      await sleep(1200, signal);

      onMessage({ type: 'system', content: "[3단계: StrOutputParser] AIMessage 객체로부터 content 필드만 깨끗하게 문자열로 파싱하여 최종 결과를 출력합니다." });
      await sleep(800, signal);

      onMessage({
        type: 'agent',
        node_id: parserNode.id,
        role: parserNode.data.label || 'StrOutputParser',
        content: reply
      });

    // ── step1: 에이전트 1개에게 질문 1번 ──
    } else if (mode === "step1") {
      const agentNode = findNodeByKeywords(["agent", "mentor", "에이전트", "멘토", "엔지니어", "조언자"], "1");
      const userQuestion = agentNode.data.context?.trim() || "파이썬에서 리스트 컴프리헨션을 쓸 때 가독성을 유지하는 규칙은 무엇인가요?";
      const context = "당신은 파이썬 코딩 표준(PEP 8)을 엄격하게 준수하며, 가독성 높은 코드를 추천하는 멘토입니다.";

      onMessage({ type: 'system', content: `[${agentNode.data.label || '엔지니어 멘토'}] 에이전트에게 멘토링 요청을 전송합니다: '${userQuestion}'` });
      await sleep(1000, signal);

      const reply = await limitedCall(agentNode.data.label || '엔지니어 멘토', agentNode.data.provider, agentNode.data.model_name, context, userQuestion, apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: agentNode.id,
        role: agentNode.data.label || '엔지니어 멘토',
        content: reply
      });

    // ── step2: PM 초안 → 개발자 검토 (앞 단계 출력이 다음 입력이 되는 순차 체이닝, LLM 2회) ──
    } else if (mode === "step2") {
      const pmNode = findNodeByKeywords(["pm", "planner", "기획"], "1");
      const devNode = findNodeByKeywords(["dev", "developer", "개발", "리뷰"], "2");

      const userRequest = pmNode.data.context?.trim() || "바쁜 직장인들을 위한 맞춤형 식단 추천 및 정기 배송 서비스";

      onMessage({ type: 'system', content: `[1단계: ${pmNode.data.label || '기획자 (PM)'}] 기획안 초안 작성을 시작합니다: '${userRequest}'` });
      await sleep(1000, signal);

      const pmContext = "당신은 혁신적인 IT 서비스의 프로덕트 매니저(PM)입니다. 사용자 요청에 따른 독창적인 앱 기획안 초안을 작성하세요.";
      const pmReply = await limitedCall(pmNode.data.label || '기획자 (PM)', pmNode.data.provider, pmNode.data.model_name, pmContext, userRequest, apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: pmNode.id,
        role: pmNode.data.label || '기획자 (PM)',
        content: pmReply
      });

      await sleep(1500, signal);

      onMessage({ type: 'system', content: `[2단계: ${devNode.data.label || '개발자 (리뷰어)'}] PM의 기획 초안을 입력받아 순차 체이닝 방식으로 연동 및 기술 검토를 수행합니다...` });
      await sleep(1000, signal);

      const devContext = devNode.data.context?.trim() || "당신은 풀스택 리드 개발자입니다. 주어진 앱 기획안의 기술적 실현 가능성(FE/BE 구조, DB, 예상 기술 스택)을 분석하고 한계점을 분석하세요.";
      const devQuestion = `이 기획안에 대해 기술 분석을 진행해줘:\n\n${pmReply}`;

      const devReply = await limitedCall(devNode.data.label || '개발자 (리뷰어)', devNode.data.provider, devNode.data.model_name, devContext, devQuestion, apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: devNode.id,
        role: devNode.data.label || '개발자 (리뷰어)',
        content: devReply
      });

    // ── step3: LangGraph 기초 흐름 (노드 A → 노드 B, 상태 전달). 백엔드에는 step3 전용 분기가 없고 동적 그래프로 처리된다 ──
    } else if (mode === "step3") {
      const pmNode = findNodeByKeywords(["pm", "planner", "기획"], "1");
      const devNode = findNodeByKeywords(["dev", "developer", "개발", "리뷰"], "2");

      onMessage({ type: 'system', content: `[LangGraph 기초 흐름] ${pmNode.data.label || '기획자 (PM)'} 노드 실행` });
      await sleep(800, signal);

      const pmContext = pmNode.data.context?.trim() || "당신은 혁신적인 IT 서비스의 프로덕트 매니저(PM)입니다. 사용자 요청에 따른 독창적인 앱 기획안 초안을 작성하세요.";
      const pmReply = await limitedCall(pmNode.data.label || '기획자 (PM)', pmNode.data.provider, pmNode.data.model_name, pmContext, "회의를 시작하겠습니다.", apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: pmNode.id,
        role: pmNode.data.label || '기획자 (PM)',
        content: `[${pmNode.data.label || '기획자 (PM)'}] ${pmReply}`
      });

      await sleep(1500, signal);

      onMessage({ type: 'system', content: `[LangGraph 기초 흐름] 상태가 이전되어 ${devNode.data.label || '개발자 (리뷰어)'} 노드 실행` });
      await sleep(800, signal);

      const devContext = devNode.data.context?.trim() || "당신은 풀스택 리드 개발자입니다. 주어진 앱 기획안의 기술적 실현 가능성(FE/BE 구조, DB, 예상 기술 스택)을 분석하고 한계점을 분석하세요.";
      const devReply = await limitedCall(devNode.data.label || '개발자 (리뷰어)', devNode.data.provider, devNode.data.model_name, devContext, pmReply, apiKeys, signal);

      onMessage({
        type: 'agent',
        node_id: devNode.id,
        role: devNode.data.label || '개발자 (리뷰어)',
        content: `[${devNode.data.label || '개발자 (리뷰어)'}] ${devReply}`
      });

    // ── step4: PM ↔ 개발자 루프. 개발자가 "승인"을 쓰거나 3회 왕복하면 종료 ──
    } else if (mode === "step4") {
      const pmNode = findNodeByKeywords(["pm", "planner", "기획"], "1");
      const devNode = findNodeByKeywords(["dev", "developer", "개발", "리뷰"], "2");

      let loopCount = 0;
      let lastMessage = "회의를 시작하겠습니다.";

      while (loopCount < 3) {
        loopCount++;
        onMessage({ type: 'system', content: `[루프 ${loopCount}회차] ${pmNode.data.label || '기획자 (PM)'} 검토 및 기획 보완 중...` });
        await sleep(800, signal);
        
        const pmContext = pmNode.data.context?.trim() || "개발자의 보완 요구사항을 수용해 더 정밀하게 보완합니다.";
        const pmReply = await limitedCall(pmNode.data.label || '기획자 (PM)', pmNode.data.provider, pmNode.data.model_name, pmContext, lastMessage, apiKeys, signal);
        lastMessage = `[${pmNode.data.label || '기획자 (PM)'}] ${pmReply}`;
        
        onMessage({
          type: 'agent',
          node_id: pmNode.id,
          role: pmNode.data.label || '기획자 (PM)',
          content: lastMessage
        });

        await sleep(1500, signal);

        onMessage({ type: 'system', content: `[루프 ${loopCount}회차] ${devNode.data.label || '개발자 (리뷰어)'} 기술성 검토 중...` });
        await sleep(800, signal);
        
        const devContext = devNode.data.context?.trim() || "심사 결과 만족하면 [승인] 문구를 기재해 종료시킵니다.";
        const devReply = await limitedCall(devNode.data.label || '개발자 (리뷰어)', devNode.data.provider, devNode.data.model_name, devContext, lastMessage, apiKeys, signal);
        lastMessage = `[${devNode.data.label || '개발자 (리뷰어)'}] ${devReply}`;

        onMessage({
          type: 'agent',
          node_id: devNode.id,
          role: devNode.data.label || '개발자 (리뷰어)',
          content: lastMessage
        });

        // 종료 판단: 단순 문자열 포함 검사라 "승인되지 않았다"에도 종료된다. 오류 문자열이어도 종료.
        if (devReply.includes("승인") || devReply.toLowerCase().includes("error executing")) {
          onMessage({ type: 'system', content: `시스템: 개발자 노드에서 [승인] 키워드가 감지되어 대화를 종료합니다.` });
          break;
        }

        if (loopCount >= 3) {
          onMessage({ type: 'system', content: `시스템: 최대 루프 횟수(3회 왕복)에 도달하여 대화를 종료합니다.` });
          break;
        }

        await sleep(1500, signal);
      }

    // ── free: 편집기에서 그린 그래프를 직접 순회 ──
    } else {

      // 출발 노드별로 나가는 엣지를 모아 둔다 {출발 id: [엣지...]}
      const outgoingEdges = {};
      edges.forEach(edge => {
        const src = edge.source;
        if (!outgoingEdges[src]) outgoingEdges[src] = [];
        outgoingEdges[src].push(edge);
      });

      const startNodes = nodes.filter(n => n.data?.label === '__start__');
      const endNodes = nodes.filter(n => n.data?.label === '__end__');
      const startNodeIds = startNodes.map(n => n.id);
      const endNodeIds = endNodes.map(n => n.id);
      const nodeIds = nodes.filter(n => n.data?.label !== '__start__' && n.data?.label !== '__end__').map(n => n.id);

      // 시작 노드 결정: __start__ 노드에 연결된 대상 → 없으면 '들어오는 엣지가 없는 노드' → 그래도 없으면 첫 노드
      let currentNodes = [];
      startNodeIds.forEach(sid => {
        const out = outgoingEdges[sid] || [];
        out.forEach(e => {
          if (!endNodeIds.includes(e.target)) {
            currentNodes.push(e.target);
          }
        });
      });

      if (currentNodes.length === 0) {
        const incoming = new Set(edges.map(e => e.target));
        currentNodes = nodeIds.filter(nid => !incoming.has(nid));
        if (currentNodes.length === 0 && nodeIds.length > 0) {
          currentNodes = [nodeIds[0]];
        }
      }

      let lastMsg = "회의를 시작하겠습니다.";
      let loopCount = 0;
      let currentNodeId = currentNodes[0];

      // 한 노드씩 실행하며 따라간다. LLM 호출 횟수는 limitedCall이 상한(maxCalls)으로 막는다.
      // (loopCount는 사람 승인만 오가는 이상한 순환의 최후 안전장치)
      while (currentNodeId && loopCount < 200) {
        loopCount++;
        const node = nodes.find(n => n.id === currentNodeId);
        if (!node) break;
        
        const role = node.data?.label || "Agent";
        const provider = node.data?.provider || "gemini";
        const modelName = node.data?.model_name || null;
        const context = node.data?.context || "";
        
        let reply;
        if (role === '__human__') {
          // 사람 승인(HITL) 노드: LLM 대신 사용자가 결정한다. 화면에 승인 카드가 뜨고, 버튼을 누를 때까지 여기서 기다린다.
          onMessage({ type: 'system', content: '[사람 승인] 직전 결과를 확인하고 결정해 주세요. (승인 / 수정 요청 / 중단)' });
          const decision = await onApproval({ role: '사람 승인', question: lastMsg, round: ++approvals });
          if (decision.action === 'stop') {
            onMessage({ type: 'system', content: '시스템: 사람 승인 단계에서 사용자가 실행을 중단했습니다.' });
            onComplete();
            return;
          }
          // 결정을 대화에 남긴다. 연결선 이름('승인'/'수정')이 이 문구에 들어 있어 길이 갈린다.
          reply = decision.action === 'approve' ? '승인' : `수정 요청: ${(decision.feedback || '').trim() || '(의견 없음)'}`;
          lastMsg = `[사람] ${reply}`;
          onMessage({ type: 'agent', node_id: currentNodeId, role: '사람 승인', content: lastMsg });
        } else {
          onMessage({ type: 'system', content: `[노드 실행] ${role} 에이전트의 응답을 생성하는 중...` });
          await sleep(800, signal);

          reply = await limitedCall(role, provider, modelName, context, lastMsg, apiKeys, signal);
          lastMsg = `[${role}] ${reply}`;

          onMessage({
            type: 'agent',
            node_id: currentNodeId,
            role: role,
            content: lastMsg
          });
        }
        
        await sleep(1500, signal);
        
        const outEdges = outgoingEdges[currentNodeId] || [];
        if (outEdges.length === 0) {
          break;
        }
        
        // 다음 노드 결정: 나가는 엣지가 1개(라벨 없음)면 그대로, 여러 개면 답변에 엣지 라벨이 포함된 쪽으로 분기.
        // 주의: 부분 문자열 매칭이며 아무것도 안 맞으면 첫 엣지로 간다. (백엔드의 조건부 라우터와 같은 규칙)
        let nextNodeId = null;
        const hasLabels = outEdges.some(e => e.label && e.label !== 'EDGE');
        if (outEdges.length === 1 && !hasLabels) {
          nextNodeId = outEdges[0].target;
        } else {
          const lowercaseReply = reply.toLowerCase();
          let matchedEdge = null;
          for (const edge of outEdges) {
            const labelStr = (edge.label || "").toLowerCase();
            if (labelStr && lowercaseReply.includes(labelStr)) {
              matchedEdge = edge;
              break;
            }
          }
          if (matchedEdge) {
            nextNodeId = matchedEdge.target;
          } else {
            nextNodeId = outEdges[0].target;
          }
        }
        
        if (endNodeIds.includes(nextNodeId) || nextNodeId === '__end__') {
          break;
        }
        
        currentNodeId = nextNodeId;
      }

    }

    onMessage({
      type: 'system',
      content: "시스템: 전체 시뮬레이션 및 회의 과정이 완전히 정상 종료되었습니다."
    });
    onComplete();
  } catch (error) {
    // 중지 버튼(abort)은 오류가 아니라 정상 중단으로 처리하고, 그 외는 오류로 알린다
    if (error instanceof CallLimitError) {
      onMessage({ type: 'system', content: `시스템: LLM 호출 횟수 상한(${error.limit}회)에 도달해 실행을 종료했습니다. 화면의 '최대 호출 횟수'에서 상한을 바꿀 수 있습니다.` });
      onComplete();
    } else if (error.message === 'aborted') {
      onMessage({
        type: 'system',
        content: "시스템: 사용자가 강제로 회의를 중단시켰습니다."
      });
      onComplete();
    } else {
      onMessage({
        type: 'error',
        content: `시스템 에러: ${error.message}`
      });
      onError(error);
    }
  }
}
