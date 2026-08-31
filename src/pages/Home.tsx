import { useState } from 'react'
import HeaderBar from '@/sections/HeaderBar'
import WatchlistPanel from '@/sections/WatchlistPanel'
import PriceChart from '@/sections/PriceChart'
import WavePanel from '@/sections/WavePanel'
import InsightPanel from '@/sections/InsightPanel'
import SignalPanel from '@/sections/SignalPanel'
import NewsPanel from '@/sections/NewsPanel'
import CalendarPanel from '@/sections/CalendarPanel'
import BacktestPanel from '@/sections/BacktestPanel'
import { getMarketData } from '@/lib/data'
import type { Instrument, Wave } from '@/lib/data'

/** 品种内评分最高的波浪划分 */
function bestWave(inst: Instrument): Wave {
  return [...inst.waves].sort((a, b) => b.score - a.score)[0]
}

export default function Home() {
  const { instruments } = getMarketData()
  // 默认选中黄金；找不到则用第一个品种
  const initial = instruments.find((i) => i.key === 'gold') ?? instruments[0]
  const [instrument, setInstrument] = useState<Instrument>(initial)
  // 默认选中评分最高的波浪划分；切换品种时重置为新品种最高分波浪
  const [selected, setSelected] = useState<Wave>(() => bestWave(initial))

  const onSelectInstrument = (inst: Instrument) => {
    setInstrument(inst)
    setSelected(bestWave(inst))
  }

  return (
    <div className="scanlines min-h-full bg-[radial-gradient(1200px_500px_at_70%_-10%,rgba(251,191,36,0.05),transparent_60%)]">
      <HeaderBar instrument={instrument} />
      <main className="mx-auto max-w-[1720px] space-y-4 px-4 py-4">
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_1fr_360px]">
          {/* 左栏：品种池 + 解读 / 引擎 / 历史形态 */}
          <div className="flex min-w-0 flex-col gap-4">
            <WatchlistPanel instruments={instruments} current={instrument} onSelect={onSelectInstrument} />
            <InsightPanel instrument={instrument} selected={selected} onSelect={setSelected} />
          </div>
          {/* 中栏：主图（移动端单列时排最前） */}
          <div className="panel order-first min-w-0 p-4 xl:order-none">
            <div className="section-label mb-3">价格走势 · 波浪叠加</div>
            <PriceChart instrument={instrument} wave={selected} />
          </div>
          {/* 右栏：信号 + 时事 + 日历 + 波浪列表 */}
          <div className="flex min-w-0 flex-col gap-4">
            <SignalPanel instrument={instrument} wave={selected} />
            <NewsPanel instrument={instrument} />
            <CalendarPanel instrument={instrument} />
            <div className="panel flex min-h-0 flex-col p-4">
              <div className="section-label mb-3">波浪划分 · 按评分排序</div>
              <WavePanel instrument={instrument} selected={selected} onSelect={setSelected} />
            </div>
          </div>
        </section>
        <BacktestPanel instrument={instrument} />
      </main>
    </div>
  )
}
