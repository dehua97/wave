import { Routes, Route } from 'react-router'
import Home from './pages/Home'

export default function App() {
  return (
    <Routes>
      {/* 用 * 兜底匹配：部署在子路径（如 GitHub Pages 的 /wave/）时也能命中首页 */}
      <Route path="*" element={<Home />} />
    </Routes>
  )
}
