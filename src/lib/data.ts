// 行情数据加载模块
// 数据契约以 market_data.json 实际结构为准（多品种 + 时事 + 宏观日历，日K，2023-08 起）

/** 日K线 */
export interface OhlcBar {
  date: string
  o: number
  h: number
  l: number
  c: number
}

/** 转折点（H=高点，L=低点） */
export interface Pivot {
  date: string
  price: number
  type: 'H' | 'L'
}

/** 波浪划分中的单个点 */
export interface WavePoint {
  date: string
  price: number
  type: 'H' | 'L'
}

/**
 * 一组艾略特波浪划分（固定 6 个点）。
 * detail 的键为中文指标名，如 "w2回撤"、"w3/w1"、"w4回撤"、"w5/w1"。
 */
export interface Wave {
  score: number
  direction: 'up' | 'down'
  detail: Record<string, number>
  points: WavePoint[]
}

/** 回测交易记录 */
export interface Trade {
  /** 信号日期 */
  signal: string
  /** 出场日期 */
  exit: string
  /** 所处浪段，如 "浪3"、"浪5" */
  wave: string
  /** 方向：1=做多，-1=做空 */
  dir: 1 | -1
  score: number
  /** 收益率（%） */
  ret: number
  /** 出场原因，如 "止损"、"超时"、"达标" */
  reason: string
}

/** 净值曲线点 */
export interface EquityPoint {
  date: string
  v: number
}

/** 品种分组：commodity=大宗商品/外汇，cn_index=A股指数，cn_stock=A股个股 */
export type InstrumentGroup = 'commodity' | 'cn_index' | 'cn_stock'

/** 单个交易品种 */
export interface Instrument {
  /** 品种标识，如 'gold'、'silver'、'sse'、'maotai' */
  key: string
  /** 展示名，如 "黄金 XAU/USD" */
  name: string
  group: InstrumentGroup
  /** 计价单位，如 "美元/盎司" */
  unit: string
  /** 数据来源说明，如 "Yahoo Finance · GC=F" */
  source: string
  ohlc: OhlcBar[]
  pivots: Pivot[]
  waves: Wave[]
  trades: Trade[]
  equity: EquityPoint[]
  /** 消息面事件日期（仅日期字符串，无描述文案） */
  events: string[]
}

/** 时事条目（策展） */
export interface NewsItem {
  id: string
  date: string
  title: string
  summary: string
  detail: string
  /** 情绪评分：正=利多，负=利空 */
  score: number
  tag: string
  /** 关联品种 key 列表 */
  instruments: string[]
}

/** 宏观日历事件 */
export interface CalendarEvent {
  date: string
  name: string
  impact: '极高' | '高' | '中'
  note: string
  /** 关联品种 key 列表 */
  instruments: string[]
}

/** 行情数据顶层结构 */
export interface MarketData {
  /** 数据截止日期 */
  asof: string
  instruments: Instrument[]
  news: NewsItem[]
  calendar: CalendarEvent[]
}

let marketData: MarketData | null = null

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** 对 JSON 做基本的运行时校验，结构不符时抛出带中文说明的错误 */
function validate(raw: unknown): MarketData {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('行情数据格式错误：顶层不是对象')
  }
  const d = raw as Record<string, unknown>
  if (!isString(d.asof)) {
    throw new Error('行情数据格式错误：缺少 asof 字段')
  }
  const arrayFields = ['instruments', 'news', 'calendar'] as const
  for (const key of arrayFields) {
    if (!Array.isArray(d[key])) {
      throw new Error(`行情数据格式错误：${key} 字段不是数组`)
    }
  }
  const data = d as unknown as MarketData
  if (data.instruments.length === 0) {
    throw new Error('行情数据格式错误：instruments 为空')
  }
  const inst = data.instruments[0]
  if (inst.ohlc.length === 0) {
    throw new Error('行情数据格式错误：首品种 ohlc 为空')
  }
  const bar = inst.ohlc[0]
  if (!isString(bar.date) || !isNumber(bar.o) || !isNumber(bar.h) || !isNumber(bar.l) || !isNumber(bar.c)) {
    throw new Error('行情数据格式错误：ohlc 条目缺少 date/o/h/l/c')
  }
  return data
}

/**
 * 加载行情数据（幂等，重复调用返回缓存结果）。
 * 使用 import.meta.env.BASE_URL 拼接路径，兼容 base: './' 的子路径部署。
 */
export async function loadMarketData(): Promise<MarketData> {
  if (marketData) return marketData
  const url = `${import.meta.env.BASE_URL}market_data.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`行情数据请求失败（HTTP ${res.status}）`)
  }
  marketData = validate(await res.json())
  return marketData
}

/** 读取已加载的行情数据；必须在 loadMarketData() 完成后调用 */
export function getMarketData(): MarketData {
  if (!marketData) {
    throw new Error('行情数据尚未加载，请先调用 loadMarketData()')
  }
  return marketData
}
