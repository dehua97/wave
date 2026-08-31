import { useMemo } from 'react'
import { computeKDJ, computeMACD, computeRSI } from '@/lib/indicators'
import type { Instrument, Wave } from '@/lib/data'

/** 右栏顶部：基于当前选中波浪推导的观察信号 + 最近支撑/阻力 */
export default function SignalPanel({ instrument, wave }: { instrument: Instrument; wave: Wave }) {
  const { pivots, ohlc } = instrument
  const lastClose = ohlc[ohlc.length - 1].c
  const up = wave.direction === 'up'
  const invalid = wave.points[0].price
  const target = wave.points[wave.points.length - 1].price

  // 相对最新收盘价：下方最近 3 个摆动点为支撑，上方最近 3 个为阻力
  const supports = pivots
    .filter((p) => p.price < lastClose)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
  const resistances = pivots
    .filter((p) => p.price > lastClose)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)

  // 技术指标最新状态（MACD/RSI/KDJ），辅助观察信号
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
  const n = ohlc.length
  const at = (arr: (number | null)[], i: number) => (i >= 0 ? arr[i] : null)
  const fmt1 = (v: number | null) => (v === null ? '--' : v.toFixed(1))

  // 金叉/死叉只看最近一根的穿越，否则按两条线的相对位置判定多空
  const dif = at(ind.macd.dif, n - 1)
  const dea = at(ind.macd.dea, n - 1)
  const difP = at(ind.macd.dif, n - 2)
  const deaP = at(ind.macd.dea, n - 2)
  const macdStatus =
    dif !== null && dea !== null && difP !== null && deaP !== null && difP <= deaP && dif > dea
      ? { text: '金叉', color: 'var(--up)' }
      : dif !== null && dea !== null && difP !== null && deaP !== null && difP >= deaP && dif < dea
        ? { text: '死叉', color: 'var(--down)' }
        : dif !== null && dea !== null
          ? dif > dea
            ? { text: '多头', color: 'var(--up)' }
            : { text: '空头', color: 'var(--down)' }
          : { text: '--', color: 'var(--text2)' }

  const rsiV = at(ind.rsi, n - 1)
  const rsiStatus =
    rsiV === null
      ? { text: '--', color: 'var(--text2)' }
      : rsiV > 70
        ? { text: '超买', color: 'var(--gold)' }
        : rsiV < 30
          ? { text: '超卖', color: 'var(--gold)' }
          : { text: '中性', color: 'var(--text2)' }

  const kV = at(ind.kdj.k, n - 1)
  const dV = at(ind.kdj.d, n - 1)
  const jV = at(ind.kdj.j, n - 1)
  const kP = at(ind.kdj.k, n - 2)
  const dP = at(ind.kdj.d, n - 2)
  const kdjStatus =
    kV !== null && dV !== null && kP !== null && dP !== null && kP <= dP && kV > dV
      ? { text: '金叉', color: 'var(--up)' }
      : kV !== null && dV !== null && kP !== null && dP !== null && kP >= dP && kV < dV
        ? { text: '死叉', color: 'var(--down)' }
        : jV !== null && jV > 100
          ? { text: '超买', color: 'var(--gold)' }
          : jV !== null && jV < 0
            ? { text: '超卖', color: 'var(--gold)' }
            : kV !== null && dV !== null
              ? kV > dV
                ? { text: '多头', color: 'var(--up)' }
                : { text: '空头', color: 'var(--down)' }
              : { text: '--', color: 'var(--text2)' }

  return (
    <div className="panel p-4">
      <div className="section-label mb-3">当前信号 · SIGNAL</div>

      {/* 状态徽章 */}
      <div className="flex items-center gap-2">
        <span
          className="pulse-dot inline-block h-2 w-2 rounded-full"
          style={{ background: up ? 'var(--up)' : 'var(--down)' }}
        />
        <span className="text-sm font-semibold" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
          {up ? '观察偏多' : '观察偏空'}
        </span>
        <span className="font-mono2 ml-auto text-[10px]" style={{ color: 'var(--text2)' }}>
          强度 {wave.score}/100
        </span>
      </div>

      {/* 强度条 */}
      <div className="mt-2 h-1.5 rounded-full" style={{ background: 'var(--panel2)' }}>
        <div
          className="h-1.5 rounded-full"
          style={{ width: `${Math.min(wave.score, 100)}%`, background: 'var(--gold)' }}
        />
      </div>

      {/* 失效位 / 目标位 */}
      <div className="font-mono2 mt-3 space-y-1.5 text-xs">
        <div className="flex items-baseline justify-between">
          <span style={{ color: 'var(--text2)' }}>结构失效位</span>
          <span className="font-semibold" style={{ color: 'var(--down)' }}>
            {invalid.toFixed(1)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span style={{ color: 'var(--text2)' }}>目标位</span>
          <span className="font-semibold" style={{ color: 'var(--up)' }}>
            {target.toFixed(1)}
          </span>
        </div>
      </div>

      {/* 最近支撑 / 阻力 */}
      <div className="mt-3 grid grid-cols-2 gap-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div>
          <div className="section-label mb-1.5">最近支撑</div>
          <div className="font-mono2 space-y-1 text-xs">
            {supports.map((p) => (
              <div key={p.date} className="flex justify-between gap-1">
                <span style={{ color: 'var(--up)' }}>{p.price.toFixed(1)}</span>
                <span className="text-[10px]" style={{ color: 'var(--text2)' }}>
                  {p.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="section-label mb-1.5">最近阻力</div>
          <div className="font-mono2 space-y-1 text-xs">
            {resistances.map((p) => (
              <div key={p.date} className="flex justify-between gap-1">
                <span style={{ color: 'var(--down)' }}>{p.price.toFixed(1)}</span>
                <span className="text-[10px]" style={{ color: 'var(--text2)' }}>
                  {p.date.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 指标状态（基于最新一根日K） */}
      <div className="mt-3" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <div className="section-label mb-1.5">指标状态</div>
        <div className="font-mono2 space-y-1.5 text-xs">
          <div className="flex items-baseline justify-between">
            <span style={{ color: 'var(--text2)' }}>MACD</span>
            <span>
              <span className="mr-2 text-[10px]" style={{ color: 'var(--text2)' }}>
                {fmt1(dif)} / {fmt1(dea)}
              </span>
              <span className="font-semibold" style={{ color: macdStatus.color }}>
                {macdStatus.text}
              </span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span style={{ color: 'var(--text2)' }}>RSI14</span>
            <span>
              <span className="mr-2 text-[10px]" style={{ color: 'var(--text2)' }}>{fmt1(rsiV)}</span>
              <span className="font-semibold" style={{ color: rsiStatus.color }}>
                {rsiStatus.text}
              </span>
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span style={{ color: 'var(--text2)' }}>KDJ</span>
            <span>
              <span className="mr-2 text-[10px]" style={{ color: 'var(--text2)' }}>
                {fmt1(kV)} / {fmt1(dV)} / {fmt1(jV)}
              </span>
              <span className="font-semibold" style={{ color: kdjStatus.color }}>
                {kdjStatus.text}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
