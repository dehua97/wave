import type { Instrument, Wave } from '@/lib/data'

interface Props {
  instrument: Instrument
  selected: Wave
  onSelect: (wave: Wave) => void
}

/** 波浪列表面板：按评分降序，点击切换主图叠加的波浪 */
export default function WavePanel({ instrument, selected, onSelect }: Props) {
  const sorted = [...instrument.waves].sort((a, b) => b.score - a.score)

  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
      {sorted.map((w, i) => {
        const active = w === selected
        const up = w.direction === 'up'
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSelect(w)}
            className="alert-card block w-full p-3 text-left transition-colors"
            style={{
              background: active ? 'var(--panel2)' : 'transparent',
              borderLeftColor: active ? 'var(--gold)' : 'var(--border)',
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-xs font-semibold"
                style={{ color: up ? 'var(--up)' : 'var(--down)' }}
              >
                {up ? '▲ 上涨浪' : '▼ 下跌浪'}
              </span>
              <span className="font-mono2 text-sm font-bold" style={{ color: 'var(--gold)' }}>
                {w.score}
              </span>
            </div>
            <div className="font-mono2 mt-1 text-[10px]" style={{ color: 'var(--text2)' }}>
              {w.points[0].date} → {w.points[w.points.length - 1].date}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(w.detail).map(([k, v]) => (
                <span
                  key={k}
                  className="font-mono2 rounded-sm px-1.5 py-0.5 text-[10px]"
                  style={{ background: 'var(--panel2)', color: 'var(--text2)' }}
                >
                  {k} {v}
                </span>
              ))}
            </div>
          </button>
        )
      })}
    </div>
  )
}
