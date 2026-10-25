import { useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, Clock, Inbox, Layers, Plus, Sparkles, XCircle } from 'lucide-react'
import clsx from 'clsx'
import type { ApplicationStatus } from '../domain/types'
import { PageHeader } from '../shell/PageHeader'
import { useBook } from '../store/book'
import { useAuth } from '../store/auth'
import { useUi } from '../store/ui'
import { can } from '../domain/permissions'
import { dateLabel, round2, zar } from '../domain/format'
import { Button } from '../ui/Button'
import { Empty, Pill } from '../ui/bits'
import { APP_STATUS } from '../features/applications/meta'

type Filter = 'all' | ApplicationStatus

const TILES: { key: Filter; label: string; icon: ReactNode }[] = [
  { key: 'all', label: 'All', icon: <Layers size={14} /> },
  { key: 'new', label: 'New', icon: <Sparkles size={14} /> },
  { key: 'reviewing', label: 'Reviewing', icon: <Clock size={14} /> },
  { key: 'approved', label: 'Approved', icon: <CheckCircle2 size={14} /> },
  { key: 'declined', label: 'Declined', icon: <XCircle size={14} /> },
]

export function Applications() {
  const { book } = useBook()
  const { user } = useAuth()
  const ui = useUi()
  const [filter, setFilter] = useState<Filter>('all')
  const apps = book.applications
  const canCapture = can(user!.role, 'client.create') || can(user!.role, 'loan.create')

  const stats = useMemo(() => {
    const s = Object.fromEntries(TILES.map((t) => [t.key, { count: 0, amount: 0 }])) as Record<Filter, { count: number; amount: number }>
    for (const a of apps) {
      for (const k of ['all', a.status] as Filter[]) {
        s[k].count++
        s[k].amount = round2(s[k].amount + a.amount)
      }
    }
    return s
  }, [apps])

  const rows = useMemo(
    () => apps.filter((a) => filter === 'all' || a.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [apps, filter],
  )

  return (
    <>
      <PageHeader
        title="Applications"
        sub={`${stats.new.count} NEW · ${stats.all.count} TOTAL`}
        actions={canCapture && <Button variant="primary" icon={<Plus size={15} />} onClick={() => ui.open({ kind: 'application' })}>New application</Button>}
      />

      <div className="flex flex-wrap items-start gap-3 rounded-[20px] px-5 py-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--accSoft)', color: 'var(--acc)' }}>
          <Inbox size={17} />
        </span>
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed" style={{ color: 'var(--mut)' }}>
          Capture loan applications here — walk-ins, calls and WhatsApp requests. Review, run affordability, then approve straight into a loan or decline with a
          reason. Every decision is logged. <span style={{ color: 'var(--dim)' }}>The borrower-app feed (Quik1) connects here in a later release.</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" role="tablist" aria-label="Filter applications">
        {TILES.map((t) => {
          const on = filter === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setFilter(t.key)}
              className={clsx('rounded-[18px] px-4 py-3.5 text-left transition', !on && 'hover:-translate-y-0.5')}
              style={on ? { background: 'var(--ink)', color: 'var(--bg)', boxShadow: 'var(--cardLift)' } : { background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ opacity: on ? 1 : 0.75 }}>
                  {t.icon}
                  {t.label}
                </span>
                <span className="rounded-full px-2 text-[10.5px] font-bold" style={on ? { background: 'var(--bg)', color: 'var(--ink)' } : { color: 'var(--mut)' }}>{stats[t.key].count}</span>
              </div>
              <div className="mt-2 text-[17px] font-bold num" style={{ opacity: stats[t.key].count || on ? 1 : 0.55 }}>{zar(stats[t.key].amount)}</div>
            </button>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-[22px]" style={{ background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: 'var(--cardLift)' }}>
        <table className="hidden w-full text-left md:table">
          <thead>
            <tr className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)', background: 'var(--panel2)' }}>
              <th className="py-4 pl-5 font-semibold">Applicant</th>
              <th className="py-4 text-right font-semibold">Amount</th>
              <th className="py-4 pl-8 font-semibold">Purpose / term</th>
              <th className="py-4 font-semibold">Submitted</th>
              <th className="py-4 pr-5 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} onClick={() => ui.open({ kind: 'application', applicationId: a.id })} className="cursor-pointer text-[13.5px] transition hover:bg-[var(--hover)]" style={{ borderTop: '1px solid var(--line)' }}>
                <td className="py-3.5 pl-5">
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-[11.5px]" style={{ color: 'var(--mut)' }}>{a.ref} · {a.source}{a.clientId ? ' · on book' : ''}</div>
                </td>
                <td className="py-3.5 text-right font-semibold num">{zar(a.amount)}</td>
                <td className="py-3.5 pl-8" style={{ color: 'var(--mut)' }}>
                  {a.purpose} · {a.termMonths} month{a.termMonths > 1 ? 's' : ''}
                </td>
                <td className="py-3.5 num" style={{ color: 'var(--mut)' }}>{dateLabel(a.createdAt)}</td>
                <td className="py-3.5 pr-5 text-right"><Pill tone={APP_STATUS[a.status].tone}>{APP_STATUS[a.status].label}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="md:hidden">
          {rows.map((a) => (
            <li key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
              <button onClick={() => ui.open({ kind: 'application', applicationId: a.id })} className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{a.name}</span>
                  <span className="block truncate text-[11.5px]" style={{ color: 'var(--mut)' }}>{a.purpose} · {a.termMonths}m · {dateLabel(a.createdAt)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[13px] font-semibold num">{zar(a.amount)}</span>
                  <Pill tone={APP_STATUS[a.status].tone}>{APP_STATUS[a.status].label}</Pill>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {!rows.length && <Empty>No applications in this view.</Empty>}
      </div>
    </>
  )
}
