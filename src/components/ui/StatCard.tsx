import { clsx } from 'clsx'
import type { ReactNode } from 'react'

type Tone = 'brand' | 'green' | 'amber' | 'red' | 'violet'

const toneRing: Record<Tone, string> = {
  brand: 'text-brand-400 bg-brand-500/15',
  green: 'text-green-400 bg-green-500/15',
  amber: 'text-amber-400 bg-amber-500/15',
  red: 'text-red-400 bg-red-500/15',
  violet: 'text-violet-400 bg-violet-500/15',
}

export function StatCard({
  label,
  value,
  icon,
  tone = 'brand',
  delta,
}: {
  label: string
  value: string
  icon: ReactNode
  tone?: Tone
  delta?: { value: string; up: boolean }
}) {
  return (
    <div className="surface rounded-2xl p-4 flex items-center gap-4">
      <div className={clsx('h-11 w-11 shrink-0 rounded-xl grid place-items-center', toneRing[tone])}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{label}</p>
        <p className="text-lg font-bold text-slate-800 dark:text-white leading-tight">{value}</p>
        {delta && (
          <p className={clsx('text-[11px] font-medium', delta.up ? 'text-green-500' : 'text-red-500')}>
            {delta.up ? '▲' : '▼'} {delta.value}
          </p>
        )}
      </div>
    </div>
  )
}
