import { getMarketData } from '@/lib/data'
import type { Instrument } from '@/lib/data'

/** 顶栏：终端标识、当前品种、数据截止日期、最新收盘与日涨跌 */
export default function HeaderBar({ instrument }: { instrument: Instrument }) {
  const { asof } = getMarketData()
  const last = instrument.ohlc[instrument.ohlc.length - 1]
  const prev = instrument.ohlc[instrument.ohlc.length - 2]
  const change = ((last.c - prev.c) / prev.c) * 100
  const up = change >= 0

  return (
    <header className="panel flex flex-wrap items-center gap-x-6 gap-y-2 border-x-0 border-t-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M2 18 L7 8 L11 13 L15 4 L19 10 L22 6" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="22" cy="6" r="1.8" fill="var(--gold)" />
        </svg>
        <span className="flex flex-col">
          <span className="text-sm font-bold tracking-wide">
            波浪共振<span style={{ color: 'var(--gold)' }}>交易终端</span>
          </span>
          <span className="section-label">ELLIOTT × SENTIMENT · MULTI-ASSET</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="pulse-gold inline-block h-2 w-2 rounded-full" style={{ background: 'var(--gold)' }} />
        <span className="flex flex-col">
          <span className="font-mono2 text-sm font-semibold" style={{ color: 'var(--gold)' }}>
            {instrument.name}
          </span>
          <span className="font-mono2 text-[10px]" style={{ color: 'var(--text2)' }}>
            {instrument.unit} · {instrument.source}
          </span>
        </span>
      </div>
      <div className="font-mono2 text-xs" style={{ color: 'var(--text2)' }}>
        数据截止 {asof}
      </div>
      <div className="ml-auto flex items-baseline gap-3">
        <span className="font-mono2 text-xl font-bold">{last.c.toFixed(1)}</span>
        <span
          className="font-mono2 text-sm font-semibold"
          style={{ color: up ? 'var(--up)' : 'var(--down)' }}
        >
          {up ? '+' : ''}
          {change.toFixed(2)}%
        </span>
      </div>
    </header>
  )
}
