import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { clearLabel, loadLabels, setLabel } from '@/lib/labels'
import { computeKDJ, computeMACD, computeRSI } from '@/lib/indicators'
import type { Instrument, Wave } from '@/lib/data'

// 主图尺寸与留白（右侧留给价格刻度，底部留给日期刻度）
const CHART_H = 560
const PAD_T = 14
const PAD_B = 24
const PAD_L = 8
const PAD_R = 64
const NAV_H = 44
const MIN_BARS = 25
const DEFAULT_BARS = 252

/** 初始视窗 K 线数：窄屏（手机）默认更少，避免 K 线过密 */
function defaultBars(): number {
  return typeof window !== 'undefined' && window.innerWidth < 480 ? 120 : DEFAULT_BARS
}

// 副图指标面板尺寸（MACD/RSI/KDJ 共用）
const SUB_H = 92
const SUB_PAD_T = 16
const SUB_PAD_B = 6

// 标注浮层可选的浪级标签
const LABEL_OPTIONS = ['①', '②', '③', '④', '⑤', 'Ⓐ', 'Ⓑ', 'Ⓒ', '1', '2', '3', '4', '5', 'A', 'B', 'C']
const AUTO_UP = ['①', '②', '③', '④', '⑤']
const AUTO_DOWN = ['Ⓐ', 'Ⓑ', 'Ⓒ']

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 计算「好看」的刻度步长（1/2/5 × 10^n） */
function niceStep(range: number, target: number): number {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const m = n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1
  return m * mag
}

interface View {
  start: number
  count: number
}

interface LabelTarget {
  date: string
  x: number
  y: number
}

interface SubPanelLine {
  name: string
  values: (number | null)[]
  color: string
}

interface SubPanelProps {
  width: number
  /** 右侧刻度留白（窄屏变小，与主图一致） */
  padR: number
  start: number
  end: number
  step: number
  cx: (i: number) => number
  title: string
  lines: SubPanelLine[]
  /** MACD 柱（可选），以 0 轴为基线，按正负着色 */
  hist?: { name: string; values: (number | null)[] }
  /** 水平参考虚线（如 0 轴、70/30），同时作为右侧刻度 */
  refs?: number[]
  /** 固定纵轴范围（如 RSI 的 0–100）；缺省按可见区自适应 */
  fixedRange?: [number, number]
  hover: number | null
  lastIdx: number
  onHover: (i: number | null) => void
}

/**
 * 副图指标面板：与主图共享视窗（start/end/cx），主图的平移缩放天然同步。
 * 仅响应十字光标（hover），不承载拖动平移与摆动点改判。
 */
function SubPanel({ width, padR, start, end, step, cx, title, lines, hist, refs, fixedRange, hover, lastIdx, onHover }: SubPanelProps) {
  const plotW = width - PAD_L - padR
  const plotH = SUB_H - SUB_PAD_T - SUB_PAD_B
  const barW = clamp(step * 0.65, 1, 14)

  // 纵轴范围：固定或按可见区所有序列 min/max 加 8% 边距（含参考线）
  let lo = fixedRange ? fixedRange[0] : Infinity
  let hi = fixedRange ? fixedRange[1] : -Infinity
  if (!fixedRange) {
    const scan = (arr: (number | null)[]) => {
      for (let i = start; i < end; i++) {
        const v = arr[i]
        if (v !== null) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
    }
    for (const l of lines) scan(l.values)
    if (hist) scan(hist.values)
    for (const r of refs ?? []) {
      if (r < lo) lo = r
      if (r > hi) hi = r
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      lo = 0
      hi = 1
    }
    const pad = Math.max((hi - lo) * 0.08, 1e-6)
    lo -= pad
    hi += pad
  }
  const sy = (v: number) => SUB_PAD_T + ((hi - v) / Math.max(hi - lo, 1e-9)) * plotH

  const fmt = (v: number | null) => (v === null ? '--' : v.toFixed(2))
  // 标题行数值：十字光标所在 K 线优先，否则最新一根
  const showIdx = hover !== null && hover >= start && hover < end ? hover : lastIdx

  /** 折线点串：跳过预热期 null（null 只出现在数据前缀，过滤即可） */
  const linePts = (arr: (number | null)[]) => {
    const pts: string[] = []
    for (let i = start; i < end; i++) {
      const v = arr[i]
      if (v !== null) pts.push(`${cx(i)},${sy(v)}`)
    }
    return pts.join(' ')
  }

  return (
    <svg width={width} height={SUB_H} className="mt-1 block cursor-crosshair touch-pan-y select-none">
      {/* 顶部分隔线 */}
      <line x1={0} x2={width} y1={0.5} y2={0.5} stroke="#1a2540" strokeWidth={1} />
      {/* 标题 + 当前值 */}
      <text x={PAD_L} y={11} fontSize={10} className="font-mono2">
        <tspan fill="#8b96ad">{title}</tspan>
        {lines.map((l) => (
          <tspan key={l.name} fill={l.color} dx={8}>
            {l.name} {fmt(l.values[showIdx])}
          </tspan>
        ))}
        {hist && (
          <tspan fill={(hist.values[showIdx] ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} dx={8}>
            {hist.name} {fmt(hist.values[showIdx])}
          </tspan>
        )}
      </text>

      {/* 参考虚线 + 右侧刻度 */}
      {(refs ?? []).map((r) => (
        <g key={`r-${r}`}>
          <line x1={PAD_L} x2={PAD_L + plotW} y1={sy(r)} y2={sy(r)} stroke="#1a2540" strokeWidth={1} strokeDasharray="4 4" />
          <text x={width - padR + 6} y={sy(r) + 3} fontSize={10} fill="#8b96ad" className="font-mono2">
            {r}
          </text>
        </g>
      ))}
      {!fixedRange && (
        <>
          <text x={width - padR + 6} y={SUB_PAD_T + 4} fontSize={10} fill="#8b96ad" className="font-mono2">
            {hi.toFixed(2)}
          </text>
          <text x={width - padR + 6} y={SUB_PAD_T + plotH} fontSize={10} fill="#8b96ad" className="font-mono2">
            {lo.toFixed(2)}
          </text>
        </>
      )}

      {/* MACD 柱 */}
      {hist &&
        hist.values.slice(start, end).map((v, k) => {
          if (v === null) return null
          const y0 = sy(0)
          const y1 = sy(v)
          return (
            <rect
              key={k}
              x={cx(start + k) - barW / 2}
              y={Math.min(y0, y1)}
              width={barW}
              height={Math.max(1, Math.abs(y1 - y0))}
              fill={v >= 0 ? 'var(--up)' : 'var(--down)'}
              opacity={0.7}
            />
          )
        })}

      {/* 指标线 */}
      {lines.map((l) => (
        <polyline key={l.name} points={linePts(l.values)} fill="none" stroke={l.color} strokeWidth={1.2} />
      ))}

      {/* 十字光标竖线 */}
      {hover !== null && hover >= start && hover < end && (
        <line x1={cx(hover)} x2={cx(hover)} y1={SUB_PAD_T} y2={SUB_PAD_T + plotH} stroke="#8b96ad" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} pointerEvents="none" />
      )}

      {/* 透明事件层：仅更新十字光标 */}
      <rect
        x={PAD_L}
        y={0}
        width={plotW}
        height={SUB_H}
        fill="transparent"
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const i = start + Math.floor((e.clientX - rect.left) / step)
          onHover(i >= start && i < end ? i : null)
        }}
        onPointerLeave={() => onHover(null)}
      />
    </svg>
  )
}

/**
 * 主图：自绘 SVG 蜡烛图 + ZigZag 摆动点 + 选中波浪叠加 + 事件日 + 回测交易标注。
 * 支持拖动平移、滚轮缩放、十字光标与摆动点点击改判（标注存 localStorage）。
 */
export default function PriceChart({ instrument, wave }: { instrument: Instrument; wave: Wave }) {
  const { ohlc, pivots, trades, events } = instrument
  const total = ohlc.length

  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(960)
  const [view, setView] = useState<View>(() => {
    const bars = defaultBars()
    return { start: Math.max(0, total - bars), count: Math.min(bars, total) }
  })
  const [hover, setHover] = useState<number | null>(null)
  const [hoverY, setHoverY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ x: number; start: number } | null>(null)
  const navDragRef = useRef<{ x: number; start: number } | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>(() => loadLabels(instrument.key))
  const [labelTarget, setLabelTarget] = useState<LabelTarget | null>(null)
  // 副图指标开关（默认全开，切换品种时不重置）
  const [showInd, setShowInd] = useState({ macd: true, rsi: true, kdj: true })

  // 切换品种：重置视窗、十字光标、改判浮层，并载入该品种的标注
  useEffect(() => {
    const bars = defaultBars()
    setView({ start: Math.max(0, total - bars), count: Math.min(bars, total) })
    setHover(null)
    setLabels(loadLabels(instrument.key))
    setLabelTarget(null)
  }, [instrument.key, total])

  // 容器宽度自适应
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((es) => {
      setWidth(Math.max(320, Math.floor(es[0].contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 窄屏（手机）适配：主图更矮、右侧刻度留白更小
  const narrow = width < 480
  const padR = narrow ? 48 : PAD_R
  const chartH = narrow ? 400 : CHART_H
  const plotW = width - PAD_L - padR
  const plotH = chartH - PAD_T - PAD_B
  const { start, count } = view
  const end = Math.min(start + count, total) // 可见区间的开区间右端
  const step = plotW / count
  const cx = (i: number) => PAD_L + (i - start + 0.5) * step

  // 日期 -> K线序号
  const idxByDate = useMemo(() => new Map(ohlc.map((b, i) => [b.date, i])), [ohlc])
  const dateList = useMemo(() => ohlc.map((b) => b.date), [ohlc])
  /** 日期对齐到 K 线：非交易日对齐到之后最近的一根；超出范围返回 null */
  const alignIndex = useMemo(() => {
    return (d: string): number | null => {
      const direct = idxByDate.get(d)
      if (direct !== undefined) return direct
      let lo = 0
      let hi = dateList.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (dateList[mid] < d) lo = mid + 1
        else hi = mid
      }
      return lo < dateList.length ? lo : null
    }
  }, [idxByDate, dateList])

  // 可见区间价格范围（含 4% 边距）
  const { minP, maxP } = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      lo = Math.min(lo, ohlc[i].l)
      hi = Math.max(hi, ohlc[i].h)
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { minP: 0, maxP: 1 }
    const pad = Math.max((hi - lo) * 0.04, 1e-6)
    return { minP: lo - pad, maxP: hi + pad }
  }, [ohlc, start, end])

  const cy = (p: number) => PAD_T + ((maxP - p) / (maxP - minP)) * plotH

  // 技术指标：按品种全量计算一次，副图面板与 OHLC 浮窗共用
  const ind = useMemo(() => {
    const closes = ohlc.map((b) => b.c)
    return {
      macd: computeMACD(closes),
      rsi: computeRSI(closes),
      kdj: computeKDJ(
        ohlc.map((b) => b.h),
        ohlc.map((b) => b.l),
        closes,
      ),
    }
  }, [ohlc])

  // 横向网格与价格刻度
  const priceTicks = useMemo(() => {
    const s = niceStep(maxP - minP, 5)
    const ticks: number[] = []
    for (let p = Math.ceil(minP / s) * s; p <= maxP; p += s) ticks.push(p)
    return ticks
  }, [minP, maxP])

  // 底部日期刻度：月份变化处抽稀
  const dateTicks = useMemo(() => {
    const ticks: { i: number; label: string }[] = []
    let lastX = -Infinity
    for (let i = start; i < end; i++) {
      if (i > 0 && ohlc[i].date.slice(0, 7) !== ohlc[i - 1].date.slice(0, 7)) {
        const x = cx(i)
        if (x - lastX > 70) {
          ticks.push({ i, label: ohlc[i].date.slice(0, 7) })
          lastX = x
        }
      }
    }
    return ticks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ohlc, start, end, step, width])

  // ZigZag 摆动点：对齐到 K 线，找不到对应 K 线的跳过
  const zigzag = useMemo(
    () =>
      pivots
        .map((p) => ({ ...p, i: idxByDate.get(p.date) }))
        .filter((p): p is typeof p & { i: number } => p.i !== undefined),
    [pivots, idxByDate],
  )

  // 事件日：对齐到之后最近的 K 线
  const eventIdx = useMemo(
    () =>
      events
        .map((d) => alignIndex(d))
        .filter((i): i is number => i !== null)
        .filter((i, k, arr) => arr.indexOf(i) === k),
    [events, alignIndex],
  )

  // 回测交易标注：signal/exit 对齐到 K 线
  const tradeMarks = useMemo(
    () =>
      trades
        .map((t) => ({ t, si: alignIndex(t.signal), ei: alignIndex(t.exit) }))
        .filter((m): m is { t: (typeof trades)[number]; si: number; ei: number } => m.si !== null && m.ei !== null),
    [trades, alignIndex],
  )

  // 选中波浪的点（对齐到 K 线）
  const wavePts = useMemo(
    () =>
      wave.points
        .map((p, k) => ({ ...p, k, i: idxByDate.get(p.date) }))
        .filter((p): p is typeof p & { i: number } => p.i !== undefined),
    [wave, idxByDate],
  )
  const waveDateSet = useMemo(() => new Set(wave.points.map((p) => p.date)), [wave])

  /** 选中波浪点的自动标注：向上 5 浪用圈数字，向下调整浪用圈字母，超出用纯数字 */
  const autoLabel = (k: number): string => {
    const seq = wave.direction === 'up' ? AUTO_UP : AUTO_DOWN
    return k < seq.length ? seq[k] : String(k + 1)
  }

  const barW = clamp(step * 0.65, 1.5, 14)
  const last = ohlc[total - 1]

  /** 以 anchorRatio（光标在绘图区的相对位置）为中心缩放 */
  const zoomAt = (factor: number, anchorRatio: number) => {
    const c = clamp(Math.round(count * factor), MIN_BARS, total)
    const anchor = start + anchorRatio * count
    setView({ start: clamp(Math.round(anchor - anchorRatio * c), 0, total - c), count: c })
  }

  // 滚轮缩放（passive:false 才能 preventDefault）
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const ratio = clamp((e.clientX - rect.left - PAD_L) / (rect.width - PAD_L - padR), 0, 1)
      zoomAt(e.deltaY < 0 ? 0.8 : 1.25, ratio)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, count, total, padR])

  // ---- 主图拖动平移 ----
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    // 按在摆动点上时不启动平移，避免 setPointerCapture 把 click 重定向到 svg、吞掉改判点击
    if ((e.target as Element).classList?.contains('pivot-dot')) return
    dragRef.current = { x: e.clientX, start }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    setLabelTarget(null)
  }
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (dragRef.current) {
      const dBars = Math.round((e.clientX - dragRef.current.x) / step)
      setView((v) => ({ ...v, start: clamp(dragRef.current!.start - dBars, 0, total - v.count) }))
      return
    }
    const vi = Math.floor((px - PAD_L) / step)
    const i = start + vi
    setHover(i >= start && i < end ? i : null)
    setHoverY(clamp(e.clientY - rect.top, PAD_T, PAD_T + plotH))
  }
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // ---- 迷你导航条拖动 ----
  const navScale = width / total
  const onNavPointerDown = (e: ReactPointerEvent<SVGSVGElement | SVGRectElement>, fromWindow: boolean) => {
    if (e.button !== 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (fromWindow) {
      navDragRef.current = { x: e.clientX, start }
    } else {
      // 点击空白处：窗口中心跳到点击位置
      const center = clamp(Math.round((e.clientX - rect.left) / navScale), 0, total)
      setView((v) => ({ ...v, start: clamp(center - Math.floor(v.count / 2), 0, total - v.count) }))
      navDragRef.current = { x: e.clientX, start: clamp(center - Math.floor(count / 2), 0, total - count) }
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onNavPointerMove = (e: ReactPointerEvent<SVGSVGElement | SVGRectElement>) => {
    if (!navDragRef.current) return
    const dBars = Math.round((e.clientX - navDragRef.current.x) / navScale)
    setView((v) => ({ ...v, start: clamp(navDragRef.current!.start + dBars, 0, total - v.count) }))
  }
  const onNavPointerUp = (e: ReactPointerEvent<SVGSVGElement | SVGRectElement>) => {
    navDragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // 摆动点点击 → 弹出改判浮层
  const onPivotClick = (e: ReactMouseEvent, date: string) => {
    e.stopPropagation()
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setLabelTarget({ date, x: e.clientX - rect.left, y: e.clientY - rect.top })
  }
  const applyLabel = (label: string) => {
    if (!labelTarget) return
    setLabels(setLabel(instrument.key, labelTarget.date, label))
    setLabelTarget(null)
  }
  const removeLabel = () => {
    if (!labelTarget) return
    setLabels(clearLabel(instrument.key, labelTarget.date))
    setLabelTarget(null)
  }

  const hoverBar = hover !== null ? ohlc[hover] : null
  const hoverPrev = hover !== null && hover > 0 ? ohlc[hover - 1] : null
  const hoverChg = hoverBar && hoverPrev ? ((hoverBar.c - hoverPrev.c) / hoverPrev.c) * 100 : null
  // 十字光标所在 K 线的指标值（OHLC 浮窗用）
  const hDif = hover !== null ? ind.macd.dif[hover] : null
  const hDea = hover !== null ? ind.macd.dea[hover] : null
  const hHist = hover !== null ? ind.macd.hist[hover] : null
  const hRsi = hover !== null ? ind.rsi[hover] : null
  const hK = hover !== null ? ind.kdj.k[hover] : null
  const hD = hover !== null ? ind.kdj.d[hover] : null
  const hJ = hover !== null ? ind.kdj.j[hover] : null

  // 迷你导航全览折线
  const navLine = useMemo(() => {
    let lo = Infinity
    let hi = -Infinity
    for (const b of ohlc) {
      lo = Math.min(lo, b.c)
      hi = Math.max(hi, b.c)
    }
    const ny = (p: number) => 4 + ((hi - p) / Math.max(hi - lo, 1e-6)) * (NAV_H - 8)
    return ohlc.map((b, i) => `${(i + 0.5) * navScale},${ny(b.c)}`).join(' ')
  }, [ohlc, navScale])

  const toolBtn =
    'rounded-sm px-2 py-0.5 font-mono2 text-[11px] transition-colors hover:text-[var(--gold)]'

  return (
    <div ref={wrapRef} className="relative">
      {/* 工具栏 */}
      <div className="mb-2 flex items-center justify-end gap-1">
        <button type="button" className={toolBtn} style={{ background: 'var(--panel2)', color: 'var(--text2)' }} onClick={() => zoomAt(0.7, 0.5)}>
          放大
        </button>
        <button type="button" className={toolBtn} style={{ background: 'var(--panel2)', color: 'var(--text2)' }} onClick={() => zoomAt(1.4, 0.5)}>
          缩小
        </button>
        <button
          type="button"
          className={toolBtn}
          style={{ background: 'var(--panel2)', color: 'var(--text2)' }}
          onClick={() => setView((v) => ({ ...v, start: total - v.count }))}
        >
          回到最新
        </button>
        <span className="mx-1 h-3 w-px" style={{ background: 'var(--border)' }} />
        {(['macd', 'rsi', 'kdj'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={toolBtn}
            style={{
              background: 'var(--panel2)',
              color: showInd[key] ? 'var(--gold)' : 'var(--text2)',
              border: showInd[key] ? '1px solid rgba(251,191,36,0.5)' : '1px solid transparent',
            }}
            onClick={() => setShowInd((s) => ({ ...s, [key]: !s[key] }))}
          >
            {key.toUpperCase()}
          </button>
        ))}
      </div>

      <svg
        ref={svgRef}
        width={width}
        height={chartH}
        className={`block touch-pan-y select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id="plot-clip">
            <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* 横向网格 + 右侧价格刻度 */}
        {priceTicks.map((p) => (
          <g key={p}>
            <line x1={PAD_L} x2={PAD_L + plotW} y1={cy(p)} y2={cy(p)} stroke="#1a2540" strokeWidth={1} />
            <text x={width - padR + 6} y={cy(p) + 3} fontSize={10} fill="#8b96ad" className="font-mono2">
              {p.toFixed(1)}
            </text>
          </g>
        ))}
        {/* 底部日期刻度 */}
        {dateTicks.map((t) => (
          <text key={t.i} x={cx(t.i)} y={chartH - 6} fontSize={10} fill="#8b96ad" textAnchor="middle" className="font-mono2">
            {t.label}
          </text>
        ))}

        <g clipPath="url(#plot-clip)">
          {/* 蜡烛图 */}
          {ohlc.slice(start, end).map((b, k) => {
            const i = start + k
            const up = b.c >= b.o
            const color = up ? 'var(--up)' : 'var(--down)'
            const yTop = cy(Math.max(b.o, b.c))
            const yBot = cy(Math.min(b.o, b.c))
            return (
              <g key={b.date}>
                <line x1={cx(i)} x2={cx(i)} y1={cy(b.h)} y2={cy(b.l)} stroke={color} strokeWidth={1} />
                <rect
                  x={cx(i) - barW / 2}
                  y={yTop}
                  width={barW}
                  height={Math.max(1, yBot - yTop)}
                  fill={color}
                  fillOpacity={0.55}
                  stroke={color}
                  strokeWidth={1}
                />
              </g>
            )
          })}

          {/* 事件日：主图底部金色小三角 */}
          {eventIdx
            .filter((i) => i >= start && i < end)
            .map((i) => (
              <polygon
                key={i}
                points={`${cx(i)},${PAD_T + plotH - 2} ${cx(i) - 4},${PAD_T + plotH - 10} ${cx(i) + 4},${PAD_T + plotH - 10}`}
                fill="var(--gold)"
                opacity={0.75}
              />
            ))}

          {/* 回测交易：signal→exit 虚线 + 进场箭头 + 出场收益 */}
          {tradeMarks
            .filter((m) => m.si >= start && m.ei < end)
            .map((m, k) => {
              const win = m.t.ret >= 0
              const color = win ? 'var(--up)' : 'var(--down)'
              const x1 = cx(m.si)
              const y1 = cy(ohlc[m.si].c)
              const x2 = cx(m.ei)
              const y2 = cy(ohlc[m.ei].c)
              const long = m.t.dir === 1
              return (
                <g key={k}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
                  <polygon
                    points={
                      long
                        ? `${x1},${y1 + 8} ${x1 - 4},${y1 + 15} ${x1 + 4},${y1 + 15}`
                        : `${x1},${y1 - 8} ${x1 - 4},${y1 - 15} ${x1 + 4},${y1 - 15}`
                    }
                    fill={color}
                  />
                  <text
                    x={x2 + 4}
                    y={y2 - 5}
                    fontSize={10}
                    fill={color}
                    className="font-mono2"
                  >
                    {win ? '+' : ''}
                    {m.t.ret.toFixed(1)}%
                  </text>
                </g>
              )
            })}

          {/* ZigZag 金色折线 */}
          <polyline
            points={zigzag.map((p) => `${cx(p.i)},${cy(p.price)}`).join(' ')}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={1.4}
            opacity={0.85}
          />

          {/* 选中波浪加粗叠加 */}
          {wavePts.length > 1 && (
            <polyline
              points={wavePts.map((p) => `${cx(p.i)},${cy(p.price)}`).join(' ')}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={2.6}
              strokeLinejoin="round"
            />
          )}

          {/* 最新收盘价虚线 */}
          {last.c >= minP && last.c <= maxP && (
            <line
              x1={PAD_L}
              x2={PAD_L + plotW}
              y1={cy(last.c)}
              y2={cy(last.c)}
              stroke="#ffb800"
              strokeWidth={1}
              strokeDasharray="5 4"
              opacity={0.8}
            />
          )}

          {/* 十字光标 */}
          {hover !== null && !dragging && (
            <g pointerEvents="none">
              <line x1={cx(hover)} x2={cx(hover)} y1={PAD_T} y2={PAD_T + plotH} stroke="#8b96ad" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
              <line x1={PAD_L} x2={PAD_L + plotW} y1={hoverY} y2={hoverY} stroke="#8b96ad" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            </g>
          )}
        </g>

        {/* 最新收盘价签 */}
        {last.c >= minP && last.c <= maxP && (
          <g pointerEvents="none">
            <rect x={width - padR + 2} y={cy(last.c) - 8} width={padR - 6} height={16} fill="#ffb800" rx={2} />
            <text x={width - padR + 2 + (padR - 6) / 2} y={cy(last.c) + 3} fontSize={10} fontWeight={700} fill="#050810" textAnchor="middle" className="font-mono2">
              {last.c.toFixed(1)}
            </text>
          </g>
        )}

        {/* 摆动点（可点击改判） */}
        {zigzag
          .filter((p) => p.i >= start && p.i < end)
          .map((p) => (
            <circle
              key={p.date}
              className="pivot-dot"
              cx={cx(p.i)}
              cy={cy(p.price)}
              r={5.5}
              fill={p.type === 'H' ? '#ffb800' : '#22d3ee'}
              stroke="#050810"
              strokeWidth={2}
              onClick={(e) => onPivotClick(e, p.date)}
            />
          ))}

        {/* 浪级标注：选中波浪自动标注（用户标注优先），普通摆动点仅显示用户标注 */}
        {wavePts
          .filter((p) => p.i >= start && p.i < end)
          .map((p) => (
            <text
              key={`w-${p.date}`}
              className="wave-label"
              x={cx(p.i)}
              y={p.type === 'H' ? cy(p.price) - 12 : cy(p.price) + 22}
              fontSize={13}
              textAnchor="middle"
              fill={p.type === 'H' ? '#ffb800' : '#22d3ee'}
              pointerEvents="none"
            >
              {labels[p.date] ?? autoLabel(p.k)}
            </text>
          ))}
        {zigzag
          .filter((p) => !waveDateSet.has(p.date) && labels[p.date] && p.i >= start && p.i < end)
          .map((p) => (
            <text
              key={`u-${p.date}`}
              className="wave-label"
              x={cx(p.i)}
              y={p.type === 'H' ? cy(p.price) - 12 : cy(p.price) + 22}
              fontSize={13}
              textAnchor="middle"
              fill={p.type === 'H' ? '#ffb800' : '#22d3ee'}
              pointerEvents="none"
            >
              {labels[p.date]}
            </text>
          ))}
      </svg>

      {/* 副图指标面板：与主图共享视窗，可用工具栏开关 */}
      {showInd.macd && (
        <SubPanel
          width={width}
          padR={padR}
          start={start}
          end={end}
          step={step}
          cx={cx}
          title="MACD 12,26,9"
          lines={[
            { name: 'DIF', values: ind.macd.dif, color: '#fbbf24' },
            { name: 'DEA', values: ind.macd.dea, color: '#22d3ee' },
          ]}
          hist={{ name: 'MACD', values: ind.macd.hist }}
          refs={[0]}
          hover={hover}
          lastIdx={total - 1}
          onHover={setHover}
        />
      )}
      {showInd.rsi && (
        <SubPanel
          width={width}
          padR={padR}
          start={start}
          end={end}
          step={step}
          cx={cx}
          title="RSI 14"
          lines={[{ name: 'RSI', values: ind.rsi, color: '#fbbf24' }]}
          refs={[70, 30]}
          fixedRange={[0, 100]}
          hover={hover}
          lastIdx={total - 1}
          onHover={setHover}
        />
      )}
      {showInd.kdj && (
        <SubPanel
          width={width}
          padR={padR}
          start={start}
          end={end}
          step={step}
          cx={cx}
          title="KDJ 9,3,3"
          lines={[
            { name: 'K', values: ind.kdj.k, color: '#fbbf24' },
            { name: 'D', values: ind.kdj.d, color: '#22d3ee' },
            { name: 'J', values: ind.kdj.j, color: '#c084fc' },
          ]}
          refs={[100, 0]}
          hover={hover}
          lastIdx={total - 1}
          onHover={setHover}
        />
      )}

      {/* OHLC 浮窗 */}
      {hoverBar && !dragging && (
        <div
          className="font-mono2 pointer-events-none absolute z-10 rounded-sm px-2.5 py-1.5 text-[11px] leading-5"
          style={{
            left: clamp(cx(hover!) + 14, 8, width - 150),
            top: 46,
            background: '#0c1220ee',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ color: 'var(--text2)' }}>{hoverBar.date}</div>
          <div>
            开 {hoverBar.o.toFixed(1)} 高 {hoverBar.h.toFixed(1)}
          </div>
          <div>
            低 {hoverBar.l.toFixed(1)} 收 {hoverBar.c.toFixed(1)}
          </div>
          {hoverChg !== null && (
            <div style={{ color: hoverChg >= 0 ? 'var(--up)' : 'var(--down)' }}>
              涨跌幅 {hoverChg >= 0 ? '+' : ''}
              {hoverChg.toFixed(2)}%
            </div>
          )}
          {hDif !== null && hDea !== null && hHist !== null && (
            <div>
              <span style={{ color: '#fbbf24' }}>DIF {hDif.toFixed(2)}</span>{' '}
              <span style={{ color: '#22d3ee' }}>DEA {hDea.toFixed(2)}</span>{' '}
              <span style={{ color: hHist >= 0 ? 'var(--up)' : 'var(--down)' }}>MACD {hHist.toFixed(2)}</span>
            </div>
          )}
          {hRsi !== null && <div style={{ color: '#fbbf24' }}>RSI {hRsi.toFixed(1)}</div>}
          {hK !== null && hD !== null && hJ !== null && (
            <div>
              <span style={{ color: '#fbbf24' }}>K {hK.toFixed(1)}</span>{' '}
              <span style={{ color: '#22d3ee' }}>D {hD.toFixed(1)}</span>{' '}
              <span style={{ color: '#c084fc' }}>J {hJ.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}

      {/* 摆动点改判浮层 */}
      {labelTarget && (
        <>
          <div className="absolute inset-0 z-10" onClick={() => setLabelTarget(null)} />
          <div
            className="absolute z-20 w-[188px] rounded-sm p-2"
            style={{
              left: clamp(labelTarget.x + 12, 4, width - 196),
              top: labelTarget.y > chartH - 120 ? labelTarget.y - 150 : labelTarget.y + 14,
              background: '#0c1220',
              border: '1px solid var(--gold)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
            }}
          >
            <div className="section-label mb-1.5">改判浪级 · {labelTarget.date}</div>
            <div className="grid grid-cols-8 gap-1">
              {LABEL_OPTIONS.map((lb) => (
                <button
                  key={lb}
                  type="button"
                  onClick={() => applyLabel(lb)}
                  className="flex h-5 items-center justify-center rounded-sm text-[11px] transition-colors"
                  style={{
                    background: labels[labelTarget.date] === lb ? 'var(--gold)' : 'var(--panel2)',
                    color: labels[labelTarget.date] === lb ? '#050810' : 'var(--gold)',
                  }}
                >
                  {lb}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={removeLabel}
              className="mt-1.5 w-full rounded-sm py-0.5 text-[11px]"
              style={{ background: 'rgba(248,113,113,0.12)', color: 'var(--down)' }}
            >
              清除标注
            </button>
          </div>
        </>
      )}

      {/* 迷你导航条 */}
      <svg
        width={width}
        height={NAV_H}
        className="mt-1 block cursor-crosshair touch-pan-y select-none"
        onPointerDown={(e) => onNavPointerDown(e, false)}
        onPointerMove={onNavPointerMove}
        onPointerUp={onNavPointerUp}
        onPointerCancel={onNavPointerUp}
      >
        <rect x={0} y={0} width={width} height={NAV_H} fill="var(--panel2)" opacity={0.5} />
        <polyline points={navLine} fill="none" stroke="#8b96ad" strokeWidth={1} opacity={0.7} />
        <rect
          x={start * navScale}
          y={1}
          width={Math.max(count * navScale, 6)}
          height={NAV_H - 2}
          fill="rgba(251,191,36,0.12)"
          stroke="var(--gold)"
          strokeWidth={1}
          className="cursor-grab"
          onPointerDown={(e) => {
            e.stopPropagation()
            onNavPointerDown(e, true)
          }}
          onPointerMove={onNavPointerMove}
          onPointerUp={onNavPointerUp}
          onPointerCancel={onNavPointerUp}
        />
      </svg>
      <div className="mt-1 flex items-center justify-between font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
        <span>
          共 {total} 根 · 拖动平移 / 滚轮缩放
        </span>
        <span>
          {ohlc[start].date} → {ohlc[end - 1].date}
        </span>
      </div>

      {/* 图例 */}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#ffb800' }} />
          摆动高点
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: '#22d3ee' }} />
          摆动低点
        </span>
        <span>
          <i
            className="mr-1 inline-block h-0 w-0 align-middle"
            style={{ borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderBottom: '6px solid var(--gold)' }}
          />
          事件日
        </span>
        <span>
          <i className="mr-1 inline-block w-4 border-t border-dashed align-middle" style={{ borderColor: 'var(--up)' }} />
          交易连线
        </span>
        <span>
          <i className="mr-1 inline-block w-4 border-t align-middle" style={{ borderColor: '#fbbf24' }} />
          DIF · RSI · K
        </span>
        <span>
          <i className="mr-1 inline-block w-4 border-t align-middle" style={{ borderColor: '#22d3ee' }} />
          DEA · D
        </span>
        <span>
          <i className="mr-1 inline-block w-4 border-t align-middle" style={{ borderColor: '#c084fc' }} />
          J
        </span>
        <span className="ml-auto">
          当前叠加：{wave.direction === 'up' ? '▲ 上涨驱动浪' : '▼ 下跌调整浪'} · 评分{' '}
          <b style={{ color: 'var(--gold)' }}>{wave.score}</b>
        </span>
      </div>
    </div>
  )
}
