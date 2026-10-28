import type { CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'
import type { EffectiveStatus } from '../domain/types'
import { STATUS_META } from '../domain/loans'

export type Tone = 'blue' | 'amber' | 'red' | 'green' | 'mut' | 'acc'

const TONE: Record<Tone, { fg: string; bg: string }> = {
  blue: { fg: 'var(--blue)', bg: 'var(--blueSoft)' },
  amber: { fg: 'var(--amber)', bg: 'var(--amberSoft)' },
  red: { fg: 'var(--red)', bg: 'var(--redSoft)' },
  green: { fg: 'var(--green)', bg: 'var(--greenSoft)' },
  mut: { fg: 'var(--mut)', bg: 'var(--hover)' },
  acc: { fg: 'var(--accInk)', bg: 'var(--acc)' },
}

export function Pill({ tone = 'mut', children, className, style }: { tone?: Tone; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={clsx('inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.05em]', className)} style={{ background: TONE[tone].bg, color: TONE[tone].fg, ...style }}>
      {children}
    </span>
  )
}

export function StatusPill({ status }: { status: EffectiveStatus }) {
  const m = STATUS_META[status]
  return <Pill tone={m.tone}>{m.label}</Pill>
}

export function Card({ children, className, style, glass }: { children: ReactNode; className?: string; style?: CSSProperties; glass?: boolean }) {
  return (
    <div className={clsx(glass ? 'glass' : 'panel', className)} style={style}>
      {children}
    </div>
  )
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('eyebrow', className)}>{children}</div>
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--mut)' }}>
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11.5px]" style={{ color: 'var(--red)' }}>{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px]" style={{ color: 'var(--dim)' }}>{hint}</span>
      ) : null}
    </label>
  )
}

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={clsx('field', className)} {...p} />
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={clsx('field min-h-[84px] resize-y', className)} {...p} />
export const Select = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={clsx('field appearance-none bg-no-repeat pr-9', className)} style={{ backgroundImage: 'linear-gradient(45deg,transparent 50%,var(--mut) 50%),linear-gradient(135deg,var(--mut) 50%,transparent 50%)', backgroundPosition: 'calc(100% - 18px) 55%, calc(100% - 13px) 55%', backgroundSize: '5px 5px' }} {...p}>
    {children}
  </select>
)

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-[13px]" style={{ color: 'var(--mut)' }}>
      {icon}
      {children}
    </div>
  )
}

export function Avatar({ name, size = 36, ring }: { name: string; size?: number; ring?: boolean }) {
  const init = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold" style={{ width: size, height: size, fontSize: size * 0.36, background: 'var(--panel3)', color: 'var(--ink)', border: ring ? '2px solid var(--acc)' : '1px solid var(--line2)' }}>
      {init || '—'}
    </span>
  )
}

/** Label / value pair used in detail grids. */
export function KV({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 pb-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="text-[10.5px] font-medium tracking-[0.06em]" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className={clsx('mt-1 truncate text-[14.5px] font-semibold', mono && 'font-mono')}>{value ?? '—'}</div>
    </div>
  )
}

/** Segmented control */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full p-1" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-full font-semibold uppercase tracking-[0.04em] transition', size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-[11px]')}
          style={o.value === value ? { background: 'var(--acc)', color: 'var(--accInk)' } : { color: 'var(--mut)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
