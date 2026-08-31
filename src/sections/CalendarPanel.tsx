import { useState } from 'react'
import { getMarketData } from '@/lib/data'
import type { CalendarEvent, Instrument } from '@/lib/data'
import NewsModal from '@/sections/NewsModal'

// 影响等级徽章底色：极高=红、高=金、中=灰
const IMPACT_STYLE: Record<CalendarEvent['impact'], { background: string; color: string }> = {
  极高: { background: 'var(--down)', color: '#050810' },
  高: { background: 'var(--gold)', color: '#050810' },
  中: { background: 'var(--panel2)', color: 'var(--text2)' },
}

/** 右栏：宏观事件日历（当前品种关联，按日期升序），点击看备注全文 */
export default function CalendarPanel({ instrument }: { instrument: Instrument }) {
  const { calendar } = getMarketData()
  const [detail, setDetail] = useState<CalendarEvent | null>(null)

  const items = calendar
    .filter((e) => e.instruments.includes(instrument.key))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  return (
    <div className="panel p-4">
      <div className="section-label mb-3">宏观事件日历 · MACRO CALENDAR</div>

      {items.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--text2)' }}>
          当前品种暂无关联事件
        </div>
      ) : (
        <div className="space-y-1 overflow-y-auto pr-1" style={{ maxHeight: 220 }}>
          {items.map((e, i) => {
            const style = IMPACT_STYLE[e.impact] ?? IMPACT_STYLE['中']
            return (
              <button
                key={`${e.date}-${i}`}
                type="button"
                onClick={() => setDetail(e)}
                className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-[var(--panel2)]"
              >
                <span className="font-mono2 shrink-0 text-[11px] font-semibold" style={{ color: 'var(--gold)' }}>
                  {e.date.slice(5)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{e.name}</span>
                <span
                  className="shrink-0 rounded-sm px-1.5 py-px text-[10px] font-semibold"
                  style={{ background: style.background, color: style.color }}
                >
                  {e.impact}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div
        className="mt-3 pt-2 text-[10px]"
        style={{ borderTop: '1px solid var(--border)', color: 'var(--text2)' }}
      >
        事件窗纪律：极端事件前后 1 日不开新仓
      </div>

      {detail && (
        <NewsModal
          title={detail.name}
          date={detail.date}
          badges={[
            {
              text: `影响 ${detail.impact}`,
              background: (IMPACT_STYLE[detail.impact] ?? IMPACT_STYLE['中']).background,
              color: (IMPACT_STYLE[detail.impact] ?? IMPACT_STYLE['中']).color,
            },
          ]}
          body={[detail.note]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
