// 摆动点浪级标注的本地持久化模块（按品种隔离）
// 存储结构：Record<品种key, Record<pivot日期, 浪级标签>>，标签如 ①、Ⓑ、3、A
// localStorage 不可用时静默降级为纯内存行为

const STORAGE_KEY = 'wave-labels-v2'

type AllLabels = Record<string, Record<string, string>>

/** 读取全部品种的全部标注；storage 不可用或数据损坏时返回空对象 */
function loadAll(): AllLabels {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    return parsed as AllLabels
  } catch {
    return {}
  }
}

function save(all: AllLabels): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 存储不可用（隐私模式/配额满）时静默忽略
  }
}

/** 读取某个品种的全部标注 */
export function loadLabels(instKey: string): Record<string, string> {
  return loadAll()[instKey] ?? {}
}

/** 设置某个品种某个摆动点的浪级标注，写回 storage 并返回该品种的新标注对象（方便 setState） */
export function setLabel(instKey: string, date: string, label: string): Record<string, string> {
  const all = loadAll()
  const next = { ...(all[instKey] ?? {}), [date]: label }
  all[instKey] = next
  save(all)
  return next
}

/** 清除某个品种某个摆动点的标注，写回 storage 并返回该品种的新标注对象（方便 setState） */
export function clearLabel(instKey: string, date: string): Record<string, string> {
  const all = loadAll()
  const next = { ...(all[instKey] ?? {}) }
  delete next[date]
  all[instKey] = next
  save(all)
  return next
}
