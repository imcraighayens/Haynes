import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import clsx from 'clsx'

interface Props {
  title?: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** sm 440 · md 620 · lg 860 · xl 1280 (hub) */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Render children edge to edge (custom layouts like the client hub) */
  bare?: boolean
  className?: string
}

const WIDTH = { sm: 440, md: 620, lg: 860, xl: 1280 }

export function Modal({ title, subtitle, onClose, children, footer, size = 'md', bare, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    return () => prev?.focus?.()
  }, [])
  return (
    <div className="scrim-in fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6" style={{ background: 'var(--scrim)', backdropFilter: 'blur(6px)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={clsx('modal-in relative flex max-h-[calc(100vh-24px)] w-full flex-col overflow-hidden rounded-[26px] outline-none sm:max-h-[calc(100vh-48px)]', className)}
        style={{ maxWidth: WIDTH[size], background: 'var(--modalBg)', border: '1px solid var(--modalLine)', boxShadow: 'var(--modalShadow)', color: 'var(--ink)' }}
      >
        {bare ? (
          children
        ) : (
          <>
            {(title || subtitle) && (
              <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5" style={{ borderBottom: '1px solid var(--modalLine)' }}>
                <div className="min-w-0">
                  {title && <h2 className="text-[19px] font-bold leading-tight">{title}</h2>}
                  {subtitle && <div className="mt-1 text-[12.5px]" style={{ color: 'var(--mut)' }}>{subtitle}</div>}
                </div>
                <CloseButton onClick={onClose} />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid var(--modalLine)' }}>
                {footer}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button aria-label="Close" onClick={onClick} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition hover:brightness-125" style={{ border: '1px solid var(--line2)', color: 'var(--ink)' }}>
      <X size={16} />
    </button>
  )
}
