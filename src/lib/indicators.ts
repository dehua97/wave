// 技术指标计算模块：MACD / RSI / KDJ
// 全部为纯函数，输入等长数组，输出与输入等长的 (number | null)[]（预热期不足的位置为 null），
// 便于与 K 线索引一一对应。

/** 指数移动平均（alpha = 2/(period+1)，以首个值播种） */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (values.length === 0) return out
  const alpha = 2 / (period + 1)
  let prev = values[0]
  out[0] = prev
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev
    out[i] = prev
  }
  return out
}

export interface MacdResult {
  /** 快线：ema(fast) - ema(slow) */
  dif: (number | null)[]
  /** 慢线：dif 的 ema(signal) */
  dea: (number | null)[]
  /** 柱：(dif - dea) * 2（国内行情软件习惯的 2 倍柱） */
  hist: (number | null)[]
}

/** MACD（默认 12/26/9） */
export function computeMACD(closes: number[], fast = 12, slow = 26, signal = 9): MacdResult {
  const n = closes.length
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const f = emaFast[i]
    const s = emaSlow[i]
    if (f !== null && s !== null) dif[i] = f - s
  }
  // dea 从首个非 null 的 dif 起算
  const firstIdx = dif.findIndex((v) => v !== null)
  const dea: (number | null)[] = new Array(n).fill(null)
  if (firstIdx >= 0) {
    const alpha = 2 / (signal + 1)
    let prev = dif[firstIdx]!
    dea[firstIdx] = prev
    for (let i = firstIdx + 1; i < n; i++) {
      prev = alpha * dif[i]! + (1 - alpha) * prev
      dea[i] = prev
    }
  }
  const hist: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (dif[i] !== null && dea[i] !== null) hist[i] = (dif[i]! - dea[i]!) * 2
  }
  return { dif, dea, hist }
}

/** RSI（Wilder 平滑，默认 14 周期），输出 0–100 */
export function computeRSI(closes: number[], period = 14): (number | null)[] {
  const n = closes.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (n <= period) return out
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const chg = closes[i] - closes[i - 1]
    if (chg > 0) avgGain += chg
    else avgLoss -= chg
  }
  avgGain /= period
  avgLoss /= period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < n; i++) {
    const chg = closes[i] - closes[i - 1]
    const gain = chg > 0 ? chg : 0
    const loss = chg < 0 ? -chg : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export interface KdjResult {
  k: (number | null)[]
  d: (number | null)[]
  j: (number | null)[]
}

/** KDJ（默认 9,3,3）：RSV = (c - llv(l,9)) / (hhv(h,9) - llv(l,9)) * 100，K/D 用 1/3 平滑（初值 50），J = 3K - 2D */
export function computeKDJ(highs: number[], lows: number[], closes: number[], n = 9): KdjResult {
  const len = closes.length
  const k: (number | null)[] = new Array(len).fill(null)
  const d: (number | null)[] = new Array(len).fill(null)
  const j: (number | null)[] = new Array(len).fill(null)
  if (len < n) return { k, d, j }
  let prevK = 50
  let prevD = 50
  for (let i = n - 1; i < len; i++) {
    let hh = -Infinity
    let ll = Infinity
    for (let m = i - n + 1; m <= i; m++) {
      hh = Math.max(hh, highs[m])
      ll = Math.min(ll, lows[m])
    }
    const rsv = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100
    prevK = (2 / 3) * prevK + (1 / 3) * rsv
    prevD = (2 / 3) * prevD + (1 / 3) * prevK
    k[i] = prevK
    d[i] = prevD
    j[i] = 3 * prevK - 2 * prevD
  }
  return { k, d, j }
}
