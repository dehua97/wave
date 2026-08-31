import type { Instrument, InstrumentGroup } from '@/lib/data'

interface Props {
  instruments: Instrument[]
  current: Instrument
  onSelect: (instrument: Instrument) => void
}

// 分组展示顺序与中文名
const GROUPS: { key: InstrumentGroup; label: string }[] = [
  { key: 'commodity', label: '大宗商品 / 外汇' },
  { key: 'cn_index', label: 'A股指数' },
  { key: 'cn_stock', label: 'A股个股' },
]

/** 左栏顶部：品种池，按组列出全部品种，点击切换当前品种 */
export default function WatchlistPanel({ instruments, current, onSelect }: Props) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="section-label">品种池 · WATCHLIST</div>
        <div className="font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
          {instruments.length} 个品种
        </div>
      </div>
      <div className="space-y-3">
        {GROUPS.map((g) => {
          const list = instruments.filter((i) => i.group === g.key)
          if (list.length === 0) return null
          return (
            <div key={g.key}>
              <div className="section-label mb-1.5">{g.label}</div>
              <div className="space-y-0.5">
                {list.map((inst) => {
                  const active = inst.key === current.key
                  const last = inst.ohlc[inst.ohlc.length - 1]
                  const prev = inst.ohlc[inst.ohlc.length - 2]
                  const change = prev ? ((last.c - prev.c) / prev.c) * 100 : 0
                  const up = change >= 0
                  // 信号徽章：该品种评分最高波浪的方向
                  const best = [...inst.waves].sort((a, b) => b.score - a.score)[0]
                  return (
                    <button
                      key={inst.key}
                      type="button"
                      onClick={() => onSelect(inst)}
                      className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors"
                      style={{
                        background: active ? 'var(--panel2)' : 'transparent',
                        boxShadow: active ? 'inset 2px 0 0 var(--gold)' : 'none',
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold">{inst.name}</span>
                        {best && (
                          <span
                            className="font-mono2 shrink-0 rounded-sm px-1 py-px text-[9px] font-bold"
                            style={{
                              background: best.direction === 'up' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                              color: best.direction === 'up' ? 'var(--up)' : 'var(--down)',
                            }}
                          >
                            {best.direction === 'up' ? '多' : '空'}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2">
                        <span className="font-mono2 text-[11px]" style={{ color: 'var(--text2)' }}>
                          {last.c.toFixed(1)}
                        </span>
                        <span
                          className="font-mono2 text-[10px]"
                          style={{ color: up ? 'var(--up)' : 'var(--down)' }}
                        >
                          {up ? '+' : ''}
                          {change.toFixed(2)}%
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
