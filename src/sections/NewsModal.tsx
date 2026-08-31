// 通用详情弹窗：时事条目与宏观日历事件共用
// 两种内容在调用方映射为同一组 props（title/date/badges/body）

import type { ReactNode } from 'react'

export interface ModalBadge {
  text: string
  /** 徽章底色（完整 CSS 颜色值），默认金色 */
  background?: string
  /** 徽章文字颜色，默认深色底字 */
  color?: string
}

interface Props {
  title: string
  date: string
  badges: ModalBadge[]
  /** 正文，按段落展示 */
  body: string[]
  onClose: () => void
}

/** 居中详情弹窗：半透明遮罩（点击关闭）+ .panel 内容卡片 */
export default function NewsModal({ title, date, badges, body, onClose }: Props) {
  const paragraphs: ReactNode = body.map((p, i) => (
    <p key={i} className="text-xs leading-6" style={{ color: 'var(--text)' }}>
      {p}
    </p>
  ))

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md p-4"
        style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-bold leading-5">{title}</div>
          <span className="font-mono2 shrink-0 pt-0.5 text-[10px]" style={{ color: 'var(--text2)' }}>
            {date}
          </span>
        </div>
        {badges.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b.text}
                className="font-mono2 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
                style={{ background: b.background ?? 'var(--gold)', color: b.color ?? '#050810' }}
              >
                {b.text}
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto pr-1">{paragraphs}</div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-sm py-1.5 text-xs font-semibold transition-colors"
          style={{ background: 'var(--panel2)', color: 'var(--gold)', border: '1px solid var(--border)' }}
        >
          关闭
        </button>
      </div>
    </div>
  )
}
