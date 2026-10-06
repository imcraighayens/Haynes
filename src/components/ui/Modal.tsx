import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl surface animate-scale-in">
        <div className="flex items-start justify-between p-5 border-b border-slate-200 dark:border-white/5">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-white">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 max-h-[65vh] overflow-y-auto">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 p-5 border-t border-slate-200 dark:border-white/5">{footer}</div>
        )}
      </div>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: ReactNode
  hint?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="text-[11px] text-slate-400 mt-1 block">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full h-10 rounded-lg px-3 text-sm bg-slate-50 border border-slate-300 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 dark:bg-white/5 dark:border-white/10 dark:text-white dark:placeholder:text-slate-500'
