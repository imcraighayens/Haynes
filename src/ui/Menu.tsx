import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  hidden?: boolean
}

/** ⋮ row menu rendered in a portal so it never clips inside scroll areas. */
export function Menu({ items, label = 'Actions', trigger }: { items: MenuItem[]; label?: string; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const h = menu.current?.offsetHeight ?? 240
    const top = r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6
    setPos({ top, left: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true })
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[var(--hover)]"
        style={{ color: 'var(--mut)' }}
      >
        {trigger ?? <MoreVertical size={16} />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            className="modal-in fixed z-[250] w-[220px] overflow-hidden rounded-2xl p-1.5"
            style={{ top: pos.top, left: pos.left, background: 'var(--panel)', border: '1px solid var(--line2)', boxShadow: 'var(--shadow)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {items
              .filter((i) => !i.hidden)
              .map((i) => (
                <button
                  key={i.label}
                  role="menuitem"
                  disabled={i.disabled}
                  onClick={() => {
                    setOpen(false)
                    i.onClick()
                  }}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition hover:bg-[var(--hover)] disabled:opacity-40"
                  style={{ color: i.danger ? 'var(--red)' : 'var(--ink)' }}
                >
                  <span className="opacity-80">{i.icon}</span>
                  {i.label}
                </button>
              ))}
          </div>,
          document.body,
        )}
    </>
  )
}
