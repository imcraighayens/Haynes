import type { ReactNode } from 'react'
import { useBook } from '../store/book'
import { supabaseHost } from '../lib/supabase'

/** Sync indicator: honest about where the book is being saved. */
export function SyncPill() {
  const { sync } = useBook()
  const local = sync.mode === 'local'
  const err = sync.status === 'error'
  const busy = sync.status === 'saving' || sync.status === 'loading'
  const color = err ? 'var(--red)' : local ? 'var(--amber)' : 'var(--green)'
  const label = err ? 'SYNC ERROR · SAVED ON THIS DEVICE' : local ? 'DEMO · SAVING ON THIS DEVICE' : busy ? 'SAVING…' : 'SAVED · SUPABASE'
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[9.5px] font-semibold tracking-[0.12em]" style={{ border: '1px solid var(--line2)', color: 'var(--mut)' }} title={err ? sync.error ?? '' : local ? 'No database connected — data stays in this browser' : `Connected to ${supabaseHost}`}>
      <span className={busy ? 'pulse' : ''} style={{ width: 6, height: 6, borderRadius: 99, background: color }} />
      {label}
    </span>
  )
}

export function PageHeader({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-extrabold uppercase tracking-[-0.01em]">{title}</h1>
        {sub && <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>{sub}</span>}
        <SyncPill />
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
