import type { Instrument, Wave } from '@/lib/data'

interface Props {
  instrument: Instrument
  selected: Wave
  onSelect: (wave: Wave) => void
}

// 波浪识别引擎的硬规则（艾略特三条铁律）
const HARD_RULES = ['浪2不跌破浪1起点', '浪3不是最短浪（1/3/5）', '浪4不进入浪1价格区间']

/** 左栏：当前波浪解读 + 识别引擎说明 + 历史识别形态列表 */
export default function InsightPanel({ instrument, selected, onSelect }: Props) {
  const up = selected.direction === 'up'
  const sorted = [...instrument.waves].sort((a, b) => b.score - a.score)

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* 当前波浪解读 */}
      <div className="panel p-4">
        <div className="section-label mb-3">当前波浪解读 · CURRENT COUNT</div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
            {up ? '▲ 向上驱动浪' : '▼ 向下驱动浪'}
          </span>
          <span className="font-mono2 text-lg font-bold" style={{ color: 'var(--gold)' }}>
            {selected.score}
            <span className="ml-1 text-[10px] font-normal" style={{ color: 'var(--text2)' }}>
              形态分
            </span>
          </span>
        </div>
        <div className="font-mono2 mt-1 text-[10px]" style={{ color: 'var(--text2)' }}>
          {selected.points[0].date} → {selected.points[selected.points.length - 1].date}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(selected.detail).map(([k, v]) => (
            <span
              key={k}
              className="font-mono2 rounded-sm px-1.5 py-0.5 text-[10px]"
              style={{ background: 'var(--panel2)', color: 'var(--gold)' }}
            >
              {k} {v}
            </span>
          ))}
        </div>
        <div
          className="mt-3 rounded-sm p-2.5 text-[11px] leading-5"
          style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', color: 'var(--gold)' }}
        >
          图上金色标记为算法初判的浪级计数。不认同算法数浪？直接点击图上任意摆动点即可改判，标注自动保存在本浏览器。
        </div>
      </div>

      {/* 波浪识别引擎 */}
      <div className="panel p-4">
        <div className="section-label mb-3">波浪识别引擎 · WAVE ENGINE</div>
        <div className="space-y-1.5 text-[11px] leading-5" style={{ color: 'var(--text2)' }}>
          <div>
            <span className="font-mono2" style={{ color: 'var(--cyan)' }}>01</span> ZigZag 提取摆动点
          </div>
          <div>
            <span className="font-mono2" style={{ color: 'var(--cyan)' }}>02</span> 滑动窗口匹配 5浪驱动 / 3浪调整
          </div>
          <div>
            <span className="font-mono2" style={{ color: 'var(--cyan)' }}>03</span> 艾略特规则校验，打分 0-100
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          {HARD_RULES.map((r) => (
            <div
              key={r}
              className="rounded-sm px-2 py-1 text-[11px]"
              style={{ background: 'var(--panel2)', borderLeft: '2px solid var(--gold)', color: 'var(--text)' }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>

      {/* 历史识别形态 */}
      <div className="panel p-4">
        <div className="section-label mb-3">历史识别形态 · DETECTED</div>
        <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 220 }}>
          {sorted.map((w, i) => {
            const active = w === selected
            const wUp = w.direction === 'up'
            const detailSummary = Object.entries(w.detail)
              .slice(0, 2)
              .map(([k, v]) => `${k} ${v}`)
              .join(' · ')
            return (
              <button
                key={i}
                type="button"
                onClick={() => onSelect(w)}
                className="block w-full rounded-sm px-2 py-1.5 text-left transition-colors"
                style={{
                  background: active ? 'var(--panel2)' : 'transparent',
                  boxShadow: active ? 'inset 2px 0 0 var(--gold)' : 'none',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
                    {w.points[0].date} → {w.points[w.points.length - 1].date}
                  </span>
                  <span className="font-mono2 text-xs font-bold" style={{ color: 'var(--gold)' }}>
                    {w.score}
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: wUp ? 'var(--up)' : 'var(--down)' }}>
                    {wUp ? '▲ 向上' : '▼ 向下'}
                  </span>
                  <span className="font-mono2 truncate text-[10px]" style={{ color: 'var(--text2)' }}>
                    {detailSummary}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
