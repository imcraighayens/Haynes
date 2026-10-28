import { useMemo } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, StatusPill } from '../../ui/bits'
import { useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import { debitAmount, dueOn, effectiveStatus, instalmentNo } from '../../domain/loans'
import { dateStamp, dayStamp, parseDate, round2, zar } from '../../domain/format'
import { QuickActions } from '../notifications/QuickActions'

/** Instalments falling on one calendar day, plus anything already collected that day. */
export function DueDayModal({ date, onClose }: { date: string; onClose: () => void }) {
  const { book, today } = useBook()
  const ui = useUi()
  const rows = useMemo(() => dueOn(book.loans, date), [book.loans, date])
  // instalments on this date that are already collected, so the day reads complete
  const done = useMemo(
    () =>
      book.loans.filter((l) => !l.deletedAt && l.schedule.some((d, i) => d === date && i < l.instalmentsPaid)),
    [book.loans, date],
  )
  const total = round2(rows.reduce((s, r) => s + r.amount, 0))
  const debit = round2(rows.reduce((s, r) => s + debitAmount(r.loan), 0))
  const past = date < today

  return (
    <Modal
      title={`${date === today ? 'Due today' : past ? 'Was due' : 'Due'} · ${dateStamp(date)}`}
      subtitle={`${dayStamp(parseDate(date)!)} · ${rows.length} open instalment${rows.length === 1 ? '' : 's'} · ${zar(total)}${debit !== total ? ` · debit ${zar(debit)}` : ''}`}
      onClose={onClose}
      size="lg"
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      {rows.length === 0 && done.length === 0 && <Empty>Nothing collects on this day.</Empty>}
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const c = book.clients.find((x) => x.id === r.loan.clientId)
          return (
            <div key={`${r.loan.id}-${r.index}`} className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
              <button className="min-w-[200px] flex-1 text-left" onClick={() => ui.open({ kind: 'loan', loanId: r.loan.id })}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11.5px]" style={{ color: 'var(--mut)' }}>{r.loan.ref}</span>
                  <span className="truncate text-[14px] font-semibold">{c?.name ?? '—'}</span>
                  <StatusPill status={effectiveStatus(r.loan, today)} />
                </div>
                <div className="mt-1 text-[11px] font-semibold tracking-[0.05em]" style={{ color: 'var(--mut)' }}>
                  INST {r.no}/{r.total} · RETURN <span className="num" style={{ color: 'var(--ink)' }}>{zar(r.amount)}</span>
                  {r.loan.collectionFee > 0 && <> · DEBIT <span className="num">{zar(debitAmount(r.loan))}</span></>}
                  {r.loan.mandateId && <> · MANDATE {r.loan.mandateId}</>}
                </div>
              </button>
              {r.index === r.loan.instalmentsPaid ? (
                <QuickActions loan={r.loan} note={`Inst ${r.no} · ${dateStamp(date)}`} />
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--dim)' }}>Earlier instalment still open — settle that first</span>
              )}
              <Button size="sm" variant="outline" onClick={() => ui.open({ kind: 'loan', loanId: r.loan.id })}>Open</Button>
            </div>
          )
        })}
      </div>
      {done.length > 0 && (
        <div className="mt-5">
          <div className="eyebrow mb-2">Already collected</div>
          <div className="flex flex-col gap-1.5">
            {done.map((l) => {
              const c = book.clients.find((x) => x.id === l.clientId)
              const { total: tot } = instalmentNo(l)
              return (
                <button key={l.id} onClick={() => ui.open({ kind: 'loan', loanId: l.id })} className="row-hover flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px]">
                  <span className="font-mono text-[11px]" style={{ color: 'var(--mut)' }}>{l.ref}</span>
                  <span className="flex-1 truncate">{c?.name ?? '—'}</span>
                  <span className="text-[10.5px]" style={{ color: 'var(--mut)' }}>{tot} inst</span>
                  <span className="font-semibold num" style={{ color: 'var(--green)' }}>{zar(l.instalmentAmount)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
