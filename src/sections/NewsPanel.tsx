import { useState } from 'react'
import { getMarketData } from '@/lib/data'
import type { Instrument, NewsItem } from '@/lib/data'
import NewsModal from '@/sections/NewsModal'

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** 右栏：消息面情绪计分盘 + 当前品种关联时事列表（点击看详情） */
export default function NewsPanel({ instrument }: { instrument: Instrument }) {
  const { news } = getMarketData()
  const [detail, setDetail] = useState<NewsItem | null>(null)

  const items = news
    .filter((n) => n.instruments.includes(instrument.key))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  // 情绪总分：关联条目 score 合计，展示时钳制在 -5 ~ +5
  const total = clamp(items.reduce((s, n) => s + n.score, 0), -5, 5)
  const bullish = items.filter((n) => n.score > 0).length
  const bearish = items.filter((n) => n.score < 0).length
  const tone = total > 0 ? '偏多' : total < 0 ? '偏空' : '中性'
  const toneColor = total > 0 ? 'var(--up)' : total < 0 ? 'var(--down)' : 'var(--text2)'

  // 环形计分盘：40×40 viewBox，-90° 起笔，弧长 = |total|/5
  const R = 16
  const C = 2 * Math.PI * R
  const frac = Math.abs(total) / 5

  return (
    <div className="panel p-4">
      <div className="section-label mb-3">消息面情绪 · NEWS SENTIMENT</div>

      {/* 计分盘 + 多空结论 */}
      <div className="flex items-center gap-3">
        <svg width="56" height="56" viewBox="0 0 40 40" className="shrink-0">
          <circle cx="20" cy="20" r={R} fill="none" stroke="var(--panel2)" strokeWidth="4" />
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="none"
            stroke="var(--gold)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${frac * C} ${C}`}
            transform="rotate(-90 20 20)"
          />
          <text
            x="20"
            y="21"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="11"
            fontWeight="700"
            fill={toneColor}
            className="font-mono2"
          >
            {total > 0 ? `+${total}` : total}
          </text>
        </svg>
        <div className="min-w-0">
          <div className="text-sm font-semibold" style={{ color: toneColor }}>
            {tone}
          </div>
          <div className="font-mono2 mt-0.5 text-[10px]" style={{ color: 'var(--text2)' }}>
            利多 {bullish} 项 · 利空 {bearish} 项
          </div>
        </div>
      </div>

      {/* 时事列表 */}
      {items.length === 0 ? (
        <div className="mt-3 text-[11px]" style={{ color: 'var(--text2)' }}>
          当前品种暂无关联时事
        </div>
      ) : (
        <div className="mt-3 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 260 }}>
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setDetail(n)}
              className="alert-card block w-full p-2.5 text-left transition-colors"
              style={{
                background: 'var(--panel2)',
                borderLeftColor: n.score > 0 ? 'var(--gold)' : n.score < 0 ? 'var(--down)' : 'var(--border)',
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold leading-4">{n.title}</span>
                <span
                  className="font-mono2 shrink-0 rounded-sm px-1 py-px text-[10px] font-bold"
                  style={{
                    background: n.score > 0 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                    color: n.score > 0 ? 'var(--gold)' : 'var(--down)',
                  }}
                >
                  {n.score > 0 ? `+${n.score}` : n.score}
                </span>
              </div>
              <div
                className="mt-1 line-clamp-2 text-[11px] leading-4"
                style={{ color: 'var(--text2)' }}
              >
                {n.summary}
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
                  {n.date}
                </span>
                <span
                  className="rounded-sm px-1.5 py-px text-[10px]"
                  style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text2)' }}
                >
                  {n.tag}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <NewsModal
          title={detail.title}
          date={detail.date}
          badges={[
            { text: detail.tag, background: 'var(--panel2)', color: 'var(--text2)' },
            {
              text: `情绪 ${detail.score > 0 ? `+${detail.score}` : detail.score}`,
              background: detail.score > 0 ? 'var(--gold)' : 'var(--down)',
            },
          ]}
          body={[detail.summary, detail.detail]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
