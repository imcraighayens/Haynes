import { useMemo, type ReactNode } from 'react'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { notifications, topExposures, type NotifItem } from '../../domain/loans'
import { dateStamp, zar } from '../../domain/format'
import { Avatar, Empty } from '../../ui/bits'
import { QuickActions } from '../notifications/QuickActions'

function Section({ title, count, tone, children }: { title: string; count?: number; tone?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone ?? 'var(--mut)' }} />
        <span className="eyebrow">{title}</span>
        {count != null && (
          <span className="rounded-full px-2 py-[1px] text-[10px] font-bold" style={{ background: 'var(--panel3)', color: 'var(--ink)' }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function NotifRow({ n }: { n: NotifItem }) {
  const { book } = useBook()
  const ui = useUi()
  const c = book.clients.find((x) => x.id === n.loan.clientId)
  return (
    <div className="row-hover flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-3 py-2.5" style={{ border: '1px solid var(--line)' }}>
      <button className="min-w-[200px] flex-1 text-left" onClick={() => ui.open({ kind: 'loan', loanId: n.loan.id })}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px]" style={{ color: 'var(--mut)' }}>{n.loan.ref}</span>
          <span className="truncate text-[13.5px] font-semibold">{c?.name ?? '—'}</span>
        </div>
        <div className="mt-0.5 text-[10.5px] font-semibold tracking-[0.05em]" style={{ color: n.kind === 'stale' ? 'var(--red)' : 'var(--mut)' }}>
          INST {n.no}/{n.total} · {n.kind === 'stale' ? `DUE ${dateStamp(n.date)} · ${n.days} DAY${n.days === 1 ? '' : 'S'} AGO` : 'DUE TODAY'} · <span className="num" style={{ color: 'var(--ink)' }}>{zar(n.loan.instalmentAmount)}</span>
        </div>
      </button>
      <QuickActions loan={n.loan} compact note={n.kind === 'stale' ? `Inst ${n.no} · due ${dateStamp(n.date)}` : 'Due today'} />
    </div>
  )
}

/** Right-hand dashboard panel: what needs a human today. */
export function AttentionPanel() {
  const { book, today } = useBook()
  const ui = useUi()
  const notif = useMemo(() => notifications(book.loans, today), [book.loans, today])
  const stale = notif.filter((n) => n.kind === 'stale')
  const due = notif.filter((n) => n.kind === 'today')
  const top = useMemo(() => topExposures(book, 5), [book])
  const maxTop = Math.max(1, ...top.map((t) => t.amount))

  return (
    <div className="panel flex h-full flex-col gap-5 p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: stale.length ? 'var(--tlR)' : 'var(--tlG)' }} />
          ATTENTION
        </div>
        <button onClick={() => ui.open({ kind: 'notifications' })} className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
          All notifications →
        </button>
      </div>

      <Section title="Not updated" count={stale.length} tone="var(--red)">
        {stale.length ? (
          <div className="flex flex-col gap-2">
            {stale.slice(0, 5).map((n) => <NotifRow key={n.loan.id} n={n} />)}
            {stale.length > 5 && (
              <button onClick={() => ui.open({ kind: 'notifications' })} className="text-left text-[12px] font-semibold" style={{ color: 'var(--mut)' }}>
                +{stale.length - 5} more · bulk update →
              </button>
            )}
          </div>
        ) : (
          <p className="text-[12.5px]" style={{ color: 'var(--mut)' }}>Every past collection has been marked. Nice.</p>
        )}
      </Section>

      <Section title="Due today" count={due.length} tone="var(--amber)">
        {due.length ? (
          <div className="flex flex-col gap-2">{due.map((n) => <NotifRow key={n.loan.id} n={n} />)}</div>
        ) : (
          <p className="text-[12.5px]" style={{ color: 'var(--mut)' }}>Nothing collects today.</p>
        )}
      </Section>

      <Section title="Top exposures" tone="var(--blue)">
        {top.length ? (
          <div className="flex flex-col gap-1">
            {top.map((t) => (
              <button key={t.clientId} onClick={() => ui.open({ kind: 'client', clientId: t.clientId })} className="row-hover flex items-center gap-3 rounded-xl px-2 py-2 text-left">
                <Avatar name={t.client?.name ?? '—'} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{t.client?.name ?? '—'}</div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background: 'var(--panel3)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(t.amount / maxTop) * 100}%`, background: 'var(--acc)' }} />
                  </div>
                </div>
                <span className="text-[13px] font-bold num">{zar(t.amount)}</span>
              </button>
            ))}
          </div>
        ) : (
          <Empty>No open exposure.</Empty>
        )}
      </Section>
    </div>
  )
}
