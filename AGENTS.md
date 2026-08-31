# AGENTS.md

面向 AI 编码代理的项目说明文件。阅读本文件即可了解项目全貌，无需任何先验知识。

## 项目概述

**波浪共振交易终端**：一个基于「艾略特波浪 × 消息面共振」的多品种交易分析 Web 终端（目标品种包括黄金、白银、原油、A股指数与个股，见 `index.html` 的 meta description）。界面语言为**简体中文**，代码注释也以中文为主。

这是一个纯前端单页应用（SPA），无后端、无测试框架、无 CI 配置。

✅ **当前状态：项目可构建、可运行。** 数据层 `src/lib/data.ts`（多品种 + 时事 + 宏观日历契约）、按品种隔离的摆动点标注持久化 `src/lib/labels.ts` 与首页 `src/pages/Home.tsx`、`src/sections/`（HeaderBar / WatchlistPanel / PriceChart / WavePanel / InsightPanel / SignalPanel / NewsPanel / CalendarPanel / NewsModal / BacktestPanel）已补齐，`npm run build` 与 `npm run lint` 均通过。注意 `info.md` 中提到的 `src/components/ui/`（shadcn 组件）、`src/hooks/`、`src/types/` 仍未创建，需要时再按 `components.json` 约定添加。

## 技术栈

- **运行时/工具链**：Node.js 20，Vite 7.2，TypeScript 5.9（strict 模式）
- **框架**：React 19 + react-router v7（`BrowserRouter`，目前仅规划了 `/` 一个路由）
- **样式**：Tailwind CSS v3.4（注意不是 v4）+ tailwindcss-animate；`components.json` 按 shadcn/ui（new-york 风格、slate 基色、CSS 变量、lucide 图标）配置，但组件尚未生成
- **表单/校验**：react-hook-form + zod + @hookform/resolvers
- **图表**：主图为自绘 SVG（见下文 PriceChart 说明，不用 recharts）；recharts 仅用于 BacktestPanel 的净值曲线
- **UI 基础**：全套 Radix UI primitives、cmdk、sonner、vaul、embla-carousel 等已在 `package.json` 中安装
- **特殊插件**：`kimi-plugin-inspect-react`（在 `vite.config.ts` 中通过 `inspectAttr()` 启用）

## 目录结构与数据

```
index.html          入口 HTML；含内联首屏加载动画（#splash），lang="zh-CN"
market_data.json → public/market_data.json    行情数据文件（多品种 + 时事 + 宏观日历），结构见下文；放在 public/ 下以便构建时拷入 dist/
scripts/            数据管线脚本（Node）：update:data 按品种源链抓真实日K（大宗商品→新浪国际期货，A股→同花顺/东方财富，Yahoo 兜底，全链失败复用现有 JSON 的 OHLC）并重算波浪/回测，合并 scripts/news.seed.json 策展时事，原子替换 public/market_data.json；`--offline` 模式不访问网络，复用现有 JSON 的 OHLC 按最新规则重算。回测规则：只做多 + 大级别（3×小级别阈值）顺势过滤 + 大级别失效位止损/保本移损，浪3/浪5 因果入场（无前视）
src/main.tsx        入口：先 loadMarketData()，成功后才挂载 React；失败在 splash 上显示错误
src/App.tsx         根组件：仅一个 Route（* -> ./pages/Home；用通配符兜底，保证部署在子路径如 GitHub Pages /wave/ 时也能命中首页）
src/pages/Home.tsx  首页：持有「当前品种」与「当前选中波浪」状态（默认黄金，切换品种时波浪重置为新品种评分最高者）；三栏终端布局（xl:grid-cols-[280px_1fr_360px]，容器 max-w-[1720px]）；左栏 WatchlistPanel + InsightPanel，中栏 PriceChart（移动端 order-first 排最前），右栏 SignalPanel + NewsPanel + CalendarPanel + WavePanel，底部通栏 BacktestPanel；最外层带径向金色背景光
src/sections/       HeaderBar（顶栏）、WatchlistPanel（品种池分组列表）、PriceChart（自绘 SVG 主图）、WavePanel（波浪选择列表，右栏底部）、InsightPanel（左栏：当前波浪解读/识别引擎说明/历史形态列表）、SignalPanel（右栏顶部：观察信号+支撑阻力+MACD/RSI/KDJ 指标状态摘要）、NewsPanel（消息面情绪计分盘+时事列表）、CalendarPanel（宏观事件日历）、NewsModal（时事/日历共用的详情弹窗，弹窗状态在各面板内部）、BacktestPanel（回测明细+净值）
src/lib/data.ts     数据层：类型定义 + loadMarketData()/getMarketData()（fetch market_data.json，幂等缓存）
src/lib/labels.ts   摆动点浪级标注的 localStorage 持久化（按品种隔离：key `wave-labels-v2`，结构 Record<品种key, Record<日期, 标签>>），导出 loadLabels(instKey)/setLabel(instKey, date, label)/clearLabel(instKey, date)，storage 不可用时静默降级
src/lib/indicators.ts 技术指标纯函数计算：ema/computeMACD(12,26,9，柱=(DIF-DEA)×2)/computeRSI(Wilder 平滑，14)/computeKDJ(9,3,3)；输出与输入等长的 (number|null)[]（预热期为 null），供 PriceChart 副图与 SignalPanel 摘要共用
src/index.css       全局样式：Tailwind 指令 + 暗色终端风格的 CSS 变量与工具类
src/App.css         Vite 模板遗留文件，未被任何文件引用，可忽略
vite.config.ts      端口 3000、base './'、别名 @ -> ./src
tailwind.config.js  shadcn 主题令牌（CSS 变量驱动）、darkMode: ["class"]
components.json     shadcn 配置（组件目录指向 @/components/ui，尚未生成）
info.md             脚手架生成时的说明（描述的是目标结构，非现状）
```

### `public/market_data.json` 数据契约

顶层字段（均基于实际结构）：

- `asof`: string（数据截止日期，如 `"2026-08-20"`）
- `instruments`: 品种数组，每项：
  - `key`: string（如 `"gold"`、`"silver"`、`"wti"`、`"sse"`、`"maotai"`）、`name`: string（如 `"黄金 XAU/USD"`）
  - `group`: `"commodity" | "cn_index" | "cn_stock"`（大宗商品/外汇、A股指数、A股个股）
  - `unit`: string（计价单位，如 `"美元/盎司"`）、`source`: string（数据来源，如 `"新浪财经 · GC"`、`"同花顺 · hs_600519"`、`"东方财富 · 118.AU9999"`）
  - `ohlc`: 日K数组，`{date, o, h, l, c}`（约 2400 条，2016-08 起；沪深300 受源侧限制约 1300 条）
  - `pivots`: 转折点数组，`{date, price, type: "H"|"L"}`
  - `waves`: 波浪划分数组，`{score, direction: "up"|"down", detail, points[]}`；`detail` 的键为中文（如 `"w2回撤"`、`"w3/w1"`），`points` 形如 `{date, price, type}`
  - `trades`: 回测交易数组，`{signal, exit, wave, dir, score, ret, reason}`（`dir` 恒为 1 只做多；`reason` 为中文：`"止损" | "达标" | "超时" | "移仓"`）
  - `equity`: 净值曲线，`{date, v}`；`events`: 日期字符串数组（消息面事件）
- `news`: 策展时事项数组，`{id, date, title, summary, detail, score, tag, instruments[]}`；`score` 正=利多/负=利空，`instruments` 为关联品种 key 列表
- `calendar`: 宏观日历事件数组，`{date, name, impact: "极高"|"高"|"中", note, instruments[]}`

新增数据加载模块（`src/lib/data.ts`）时应以此结构为准定义类型。

### PriceChart（自绘 SVG 主图）

`src/sections/PriceChart.tsx` 不用图表库，直接自绘 SVG（ResizeObserver 测宽，高度约 560px）：

- **绘制内容**：OHLC 蜡烛图（阳线 --up / 阴线 --down）、pivots 金色 ZigZag 折线 + 摆动点（H 金 / L cyan，`.pivot-dot`）、选中波浪加粗金色叠加 + 浪级标注文字（`.wave-label`，自动标注优先被用户标注覆盖）、事件日底部金三角（非交易日对齐到之后最近 K 线）、回测交易 signal→exit 虚线 + 进场箭头 + 出场收益%、最新收盘价虚线与右侧价签。
- **交互**：Pointer 事件拖动平移（setPointerCapture）、原生 wheel（passive:false）以光标为中心缩放（下限 25 根）、工具栏「放大/缩小/回到最新」、十字光标 + OHLC 浮窗、底部迷你导航条（可拖动/点击跳窗）。
- **改判**：点击摆动点弹出浮层（16 个浪级标签 + 清除），标注按品种写入 `src/lib/labels.ts`（localStorage），状态留在组件内部，Home 无感知；切换品种时视窗/标注/浮层自动重置。
- **视窗状态**：`{start, count}` 用 useState，默认最近约 252 根；日期→K线序号的对齐用 useMemo 缓存的 Map + 二分查找。
- **副图指标**：主图与迷你导航条之间可选渲染 MACD/RSI/KDJ 三个副图面板（内部 `SubPanel` 组件，各高约 92px），与主图共享视窗（start/end/cx），平移缩放天然同步；工具栏可单独开关（默认全开）；副图仅响应十字光标，OHLC 浮窗同步显示 hover K 线的指标值；指标由 `src/lib/indicators.ts` 基于 ohlc 实时计算。

## 常用命令

```bash
npm run dev          # 启动开发服务器（端口 3000）
npm run build        # tsc -b && vite build（先类型检查再打包）
npm run lint         # eslint .
npm run preview      # 预览构建产物
npm run update:data  # 数据管线：Node 脚本按品种源链抓真实日K（新浪/同花顺/东方财富/Yahoo 逐级
                     # fallback，全链失败复用现有 OHLC）并重算波浪/回测，
                     # 合并 scripts/news.seed.json 策展时事，原子替换 public/market_data.json；
                     # 加 --offline 则不联网，复用现有 OHLC 按最新规则重算
```

无测试框架、无测试脚本。验证改动的方式是 `npm run build`（含类型检查）+ `npm run lint` + 开发服务器人工确认。

## 代码风格与约定

- **语言**：UI 文案与代码注释使用简体中文；标识符用英文。
- **TypeScript**：严格模式，且开启了 `noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`（类型导入必须写 `import type`）、`erasableSyntaxOnly`（禁用 enum、namespace、参数属性等运行时代码语法）。
- **路径别名**：一律用 `@/` 引用 `src/` 下模块（tsconfig 与 vite 均已配置）。
- **React**：函数组件；`main.tsx` 使用 `StrictMode`。React Compiler 未启用。
- **样式**：优先 Tailwind 工具类；主题色通过 CSS 变量（`hsl(var(--...))`）引用；`index.css` 已定义终端风格变量（`--bg: #050810`、`--gold: #fbbf24`、`--up/--down` 等）和 `.panel`、`.section-label`、`.scanlines`、`.font-mono2` 等自定义类，保持暗色金融终端视觉。
- **字体**：Inter / JetBrains Mono / Noto Sans SC（Google Fonts，在 `index.html` 中引入）；数字与代码用 `.font-mono2`。
- **ESLint**：flat config（`eslint.config.js`），eslint 9 + typescript-eslint recommended + react-hooks + react-refresh 规则。
- **shadcn/ui**：如需 UI 组件，按 `components.json` 约定添加到 `src/components/ui/`，用 `import { Button } from '@/components/ui/button'` 方式引用；不要自行新造组件库体系。
- **加载流程约定**：数据必须在 React 挂载前加载完成（见 `main.tsx`）；`index.html` 的 `#splash` 内联动画不依赖任何 JS/CSS，出错时在其中展示中文错误提示，不要破坏这一机制。

## 安全与注意事项

- 项目无任何密钥/环境变量依赖；不要引入需要凭证的服务。
- `public/market_data.json` 是静态数据资产，除非明确要求，不要修改其内容。
- `vite.config.ts` 中 `base: './'` 是为相对路径部署（静态托管子路径）准备的，改动需谨慎。
