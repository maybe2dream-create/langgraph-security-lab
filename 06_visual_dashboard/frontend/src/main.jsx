// main.jsx: React 앱의 진입점 (index.html → main.jsx → App.jsx)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './dark-theme.css'   // 다크 모드 가독성 보강 (작은 글자 확대는 공통)
import './flow-handles.css'  // 연결점 확대
import './light-theme.css'  // 라이트 모드 색 덮어쓰기 (html.light 일 때만 적용)
import App from './App.jsx'

// index.html의 <div id="root">에 App을 그린다. StrictMode는 개발 중 잠재 문제를 찾기 위해 effect를 두 번 실행해 볼 수 있다.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
