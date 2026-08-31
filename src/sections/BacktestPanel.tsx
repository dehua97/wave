import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { Instrument } from '@/lib/data'

/** 序列最大回撤：(历史峰值 - 当前值) / 历史峰值 的最大值，返回百分比 */
function maxDrawdown(values: number[]): number {
  let peak = -Infinity
  let mdd = 0
  for (const v of values) {
    peak = Math.max(peak, v)
    if (peak > 0) mdd = Math.max(mdd, ((peak - v) / peak) * 100)
  }
  return mdd
}

/** 回测区：8 张统计卡 + 交易明细表 + 净值曲线 + 诚实声明 */
export default function BacktestPanel({ instrument }: { instrument: Instrument }) {
  const { trades, equity, ohlc, events } = instrument

  // 日期 -> K线序号（非交易日对齐到之后最近一根）
  const idxByDate = new Map(ohlc.map((b, i) => [b.date, i]))
  const align = (d: string): number | null => {
    const direct = idxByDate.get(d)
    if (direct !== undefined) return direct
    let lo = 0
    let hi = ohlc.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (ohlc[mid].date < d) lo = mid + 1
      else hi = mid
    }
    return lo < ohlc.length ? lo : null
  }

  // ---- 统计指标（全部由 trades / equity / ohlc 推导）----
  const total = trades.length
  const wins = trades.filter((t) => t.ret > 0).length
  const winRate = total > 0 ? (wins / total) * 100 : 0
  const avgRet = total > 0 ? trades.reduce((s, t) => s + t.ret, 0) / total : 0
  // 累计收益：逐笔复利（与净值曲线口径一致）
  const cumRet = (trades.reduce((acc, t) => acc * (1 + t.ret / 100), 1) - 1) * 100
  const stratMdd = maxDrawdown(equity.map((e) => e.v))
  // 买入持有对照与持仓占比都以净值曲线覆盖区间为「同期」
  const eqStart = equity.length > 0 ? align(equity[0].date) : null
  const eqEnd = equity.length > 0 ? align(equity[equity.length - 1].date) : null
  const spanLo = eqStart ?? 0
  const spanHi = eqEnd ?? ohlc.length - 1
  const spanCloses = ohlc.slice(spanLo, spanHi + 1).map((b) => b.c)
  const holdMdd = maxDrawdown(spanCloses)
  const buyHold =
    spanCloses.length > 1 ? (spanCloses[spanCloses.length - 1] / spanCloses[0] - 1) * 100 : 0

  // 持仓时间占比：落在任意交易 [signal, exit] 区间内的 K 线（去重）/ 同期区间 K 线
  const held = new Array<boolean>(ohlc.length).fill(false)
  for (const t of trades) {
    const si = align(t.signal)
    const ei = align(t.exit)
    if (si === null || ei === null) continue
    for (let i = Math.max(Math.min(si, ei), spanLo); i <= Math.min(Math.max(si, ei), spanHi); i++)
      held[i] = true
  }
  const spanLen = spanHi - spanLo + 1
  const heldRatio = spanLen > 0 ? (held.filter(Boolean).length / spanLen) * 100 : 0

  // 事件窗检查：是否有信号落在事件日前后 1 根 K 线内
  const eventIdx = events.map(align).filter((i): i is number => i !== null)
  const signalInEventWindow = trades.some((t) => {
    const si = align(t.signal)
    return si !== null && eventIdx.some((ei) => Math.abs(ei - si) <= 1)
  })

  // 最近的交易排在前面
  const rows = [...trades].reverse()

  const stats: { label: string; value: string; color?: string; hot?: boolean }[] = [
    { label: '交易次数', value: String(total) },
    { label: '胜率', value: `${winRate.toFixed(1)}%`, hot: true },
    { label: '单笔均收益', value: `${avgRet >= 0 ? '+' : ''}${avgRet.toFixed(2)}%`, color: avgRet >= 0 ? 'var(--up)' : 'var(--down)' },
    { label: '累计收益', value: `${cumRet >= 0 ? '+' : ''}${cumRet.toFixed(1)}%`, hot: true, color: cumRet >= 0 ? 'var(--up)' : 'var(--down)' },
    { label: '策略最大回撤', value: `-${stratMdd.toFixed(1)}%`, color: 'var(--down)' },
    { label: '持有最大回撤', value: `-${holdMdd.toFixed(1)}%`, color: 'var(--down)' },
    { label: '持仓时间占比', value: `${heldRatio.toFixed(0)}%` },
    { label: '同期买入持有', value: `${buyHold >= 0 ? '+' : ''}${buyHold.toFixed(0)}%`, color: buyHold >= 0 ? 'var(--up)' : 'var(--down)' },
  ]

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="section-label">回测验证 · BACKTEST</div>
        <div className="font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
          {instrument.name} 日线 · 只做多 · 大级别顺势过滤 · 浪3/浪5入场 · 大级别失效位止损+保本移损
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          {/* 统计卡：gap-px 发丝分隔 */}
          <div className="grid grid-cols-2 gap-px rounded-sm sm:grid-cols-4" style={{ background: 'var(--border)' }}>
            {stats.map((s) => (
              <div key={s.label} className="p-3" style={{ background: 'var(--panel)' }}>
                <div className="section-label">{s.label}</div>
                <div
                  className="font-mono2 mt-1 text-lg font-bold"
                  style={{ color: s.color ?? (s.hot ? 'var(--gold)' : 'var(--text)') }}
                >
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* 交易明细表 */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="section-label" style={{ textAlign: 'left' }}>
                  <th className="pb-2 pr-3 font-normal">信号日期</th>
                  <th className="pb-2 pr-3 font-normal">出场日期</th>
                  <th className="pb-2 pr-3 font-normal">浪段</th>
                  <th className="pb-2 pr-3 font-normal">方向</th>
                  <th className="pb-2 pr-3 font-normal">评分</th>
                  <th className="pb-2 pr-3 font-normal" style={{ textAlign: 'right' }}>收益</th>
                  <th className="pb-2 font-normal" style={{ textAlign: 'right' }}>原因</th>
                </tr>
              </thead>
              <tbody className="font-mono2">
                {rows.map((t, i) => (
                  <tr
                    key={i}
                    className="transition-colors hover:bg-[var(--panel2)]"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <td className="py-1.5 pr-3">{t.signal}</td>
                    <td className="py-1.5 pr-3">{t.exit}</td>
                    <td className="py-1.5 pr-3">{t.wave}</td>
                    <td className="py-1.5 pr-3" style={{ color: t.dir === 1 ? 'var(--up)' : 'var(--down)' }}>
                      {t.dir === 1 ? '做多' : '做空'}
                    </td>
                    <td className="py-1.5 pr-3">{t.score}</td>
                    <td
                      className="py-1.5 pr-3"
                      style={{ textAlign: 'right', color: t.ret >= 0 ? 'var(--up)' : 'var(--down)' }}
                    >
                      {t.ret >= 0 ? '+' : ''}
                      {t.ret.toFixed(2)}%
                    </td>
                    <td className="py-1.5" style={{ textAlign: 'right', color: 'var(--text2)' }}>
                      {t.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 净值曲线 + 诚实声明 */}
        <div className="min-w-0">
          <div className="section-label mb-2">策略净值曲线（逐笔复利）</div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={equity} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <CartesianGrid stroke="#1a2540" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                minTickGap={40}
                tick={{ fontSize: 10, fill: '#8b96ad' }}
                tickFormatter={(d: string) => d.slice(0, 7)}
                stroke="#1a2540"
              />
              <YAxis
                domain={['auto', 'auto']}
                orientation="right"
                width={44}
                tick={{ fontSize: 10, fill: '#8b96ad' }}
                stroke="#1a2540"
              />
              <Tooltip
                contentStyle={{ background: '#0c1220', border: '1px solid #1a2540', fontSize: 12 }}
                labelStyle={{ color: '#8b96ad' }}
              />
              <Area
                type="monotone"
                dataKey="v"
                name="净值"
                stroke="#fbbf24"
                strokeWidth={1.5}
                fill="#fbbf24"
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
          <div
            className="mt-3 rounded-sm p-2.5 text-[11px] leading-5"
            style={{ background: 'var(--panel2)', color: 'var(--text2)' }}
          >
            <div className="section-label mb-1">诚实声明</div>
            样本量有限（{total} 笔）、未计滑点与杠杆成本；仅做多、顺大级别趋势，信号按浪3（P0-P2）/浪5（P0-P4）起点因果识别，不含前视信息。
            {signalInEventWindow
              ? '部分信号落在宏观事件窗内，实盘应执行事件窗纪律（不开新仓）。'
              : '事件日过滤在本样本中未改变交易集（无信号落在事件窗内）。'}
          </div>
        </div>
      </div>
    </section>
  )
}
