import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { loadMarketData } from './lib/data'

const splash = document.getElementById('splash')

function showError(msg: string) {
  if (!splash) return
  splash.classList.remove('done')
  const tip = document.getElementById('splash-tip')
  if (tip) tip.textContent = '加载失败'
  const err = document.createElement('div')
  err.className = 'err'
  err.textContent = msg + '。请检查网络后刷新重试。'
  splash.appendChild(err)
}

loadMarketData()
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    )
    // 渲染完成后淡出加载动画
    requestAnimationFrame(() => {
      splash?.classList.add('done')
      setTimeout(() => splash?.remove(), 500)
    })
  })
  .catch((e: unknown) => {
    showError(e instanceof Error ? e.message : String(e))
  })
