import { useMemo, useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Segmented } from '../../ui/bits'
import { useAuth } from '../../store/auth'
import { useActor, useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { can } from '../../domain/permissions'
import { notifications, type NotifItem } from '../../domain/loans'
import { dateStamp, zar } from '../../domain/format'
import { applyQuick, QuickActions, type QuickTarget } from './QuickActions'

const GROUPS: { kind: NotifItem['kind']; title: string; tone: string; hint: string }[] = [
  { kind: 'stale', title: 'Not updated', tone: 'var(--red)', hint: 'Collection date passed and nobody marked the result' },
  { kind: 'today', title: 'Due today', tone: 'var(--amber)', hint: 'Debit orders running today' },
  { kind: 'overdue', title: 'Overdue', tone: 'var(--red)', hint: 'Marked overdue — follow up with collections' },
]

const TARGET_LABEL: Record<QuickTarget, string> = { paid: 'Paid', overdue: 'Overdue', open: 'Still open' }

export function NotificationsModal({ onClose }: { onClose: () => void }) {
  const { book, today, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const items = useMemo(() => notifications(book.loans, today), [book.loans, today])
  const canUpdate = !!user && can(user.role, 'loan.status')
  const [bulk, setBulk] = useState(false)
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [to, setTo] = useState<QuickTarget>('paid')
  const selected = items.filter((n) => sel[n.loan.id])
  const toggle = (id: string) => setSel((s) => ({ ...s, [id]: !s[id] }))
  const selectGroup = (kind: NotifItem['kind']) => {
    const ids = items.filter((n) => n.kind === kind)
    const all = ids.every((n) => sel[n.loan.id])
    setSel((s) => ({ ...s, ...Object.fromEntries(ids.map((n) => [n.loan.id, !all])) }))
  }

  const apply = () => {
    if (!selected.length) return
    commit(
      (b) =>
        selected.reduce((acc, n) => {
          const loan = acc.loans.find((l) => l.id === n.loan.id)
          return loan ? applyQuick(acc, loan, to, actor, `Bulk update · inst ${n.no} · due ${dateStamp(n.date)}`) : acc
        }, b),
      `${selected.length} loan${selected.length === 1 ? '' : 's'} → ${TARGET_LABEL[to].toUpperCase()}`,
    )
    setSel({})
    setBulk(false)
  }

  return (
    <Modal
      title="Notifications"
      subtitle={items.length ? `${items.length} item${items.length === 1 ? '' : 's'} need attention · ${dateStamp(today)}` : `All clear · ${dateStamp(today)}`}
      onClose={onClose}
      size="lg"
      footer={
        bulk ? (
          <>
            <span className="mr-auto text-[12px]" style={{ color: 'var(--mut)' }}>{selected.length} selected</span>
            <Segmented<QuickTarget> size="sm" value={to} onChange={setTo} options={(['paid', 'overdue', 'open'] as QuickTarget[]).map((v) => ({ value: v, label: TARGET_LABEL[v] }))} />
            <Button variant="ghost" onClick={() => { setBulk(false); setSel({}) }}>Cancel</Button>
            <Button variant="primary" disabled={!selected.length} onClick={apply}>Apply to {selected.length || ''}</Button>
          </>
        ) : (
          <>
            {canUpdate && items.length > 1 && <Button variant="outline" onClick={() => setBulk(true)}>Bulk update</Button>}
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </>
        )
      }
    >
      {!items.length && <Empty>No collections due today and every past collection is up to date.</Empty>}
      <div className="flex flex-col gap-6">
        {GROUPS.map((g) => {
          const rows = items.filter((n) => n.kind === g.kind)
          if (!rows.length) return null
          const total = rows.reduce((s, n) => s + n.loan.instalmentAmount, 0)
          return (
            <section key={g.kind}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: g.tone }} />
                <span className="eyebrow">{g.title}</span>
                <span className="rounded-full px-2 py-[1px] text-[10px] font-bold" style={{ background: 'var(--panel3)' }}>{rows.length}</span>
                <span className="text-[11.5px]" style={{ color: 'var(--dim)' }}>{g.hint} · {zar(total)}</span>
                {bulk && (
                  <button onClick={() => selectGroup(g.kind)} className="ml-auto text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>
                    Select all
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {rows.map((n) => {
                  const c = book.clients.find((x) => x.id === n.loan.clientId)
                  return (
                    <div
                      key={n.loan.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
                      style={{ background: sel[n.loan.id] ? 'var(--accSoft)' : 'var(--panel2)', border: `1px solid ${sel[n.loan.id] ? 'var(--acc)' : 'var(--line)'}`, cursor: bulk ? 'pointer' : undefined }}
                      onClick={bulk ? () => toggle(n.loan.id) : undefined}
                    >
                      {bulk && <input type="checkbox" checked={!!sel[n.loan.id]} onChange={() => toggle(n.loan.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${n.loan.ref}`} className="h-4 w-4 accent-[var(--acc)]" />}
                      <button className="min-w-[200px] flex-1 text-left" disabled={bulk} onClick={() => ui.open({ kind: 'loan', loanId: n.loan.id })}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11.5px]" style={{ color: 'var(--mut)' }}>{n.loan.ref}</span>
                          <span className="truncate text-[14px] font-semibold">{c?.name ?? '—'}</span>
                        </div>
                        <div className="mt-1 text-[10.5px] font-semibold tracking-[0.05em]" style={{ color: n.kind === 'today' ? 'var(--amber)' : 'var(--red)' }}>
                          {n.kind === 'today' ? `DUE TODAY · ${dateStamp(n.date)}` : `${n.kind === 'stale' ? 'NOT UPDATED' : 'OVERDUE'} · ${n.days} DAY${n.days === 1 ? '' : 'S'} AGO`} · INST {n.no}/{n.total} ·{' '}
                          <span className="num" style={{ color: 'var(--ink)' }}>{zar(n.loan.instalmentAmount)}</span>
                        </div>
                      </button>
                      {!bulk && <QuickActions loan={n.loan} note={`Inst ${n.no} · due ${dateStamp(n.date)}`} />}
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </Modal>
  )
}
