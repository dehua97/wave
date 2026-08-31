import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  // 兼容旧版手机浏览器（如老 iOS Safari），避免解析失败导致黑屏
  build: {
    target: ['es2018', 'chrome87', 'safari14', 'firefox78', 'edge88'],
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
