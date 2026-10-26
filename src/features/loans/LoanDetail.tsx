import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Pill, StatusPill } from '../../ui/bits'
import { Menu } from '../../ui/Menu'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { collected, debitAmount, effectiveStatus, isStale, outstanding, principalOf, totalReturn } from '../../domain/loans'
import { can } from '../../domain/permissions'
import { dateLabel, dateTimeLabel, zar } from '../../domain/format'
import { Stat, useLoanMenu } from './shared'

export function LoanDetail({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book, today } = useBook()
  const loan = book.loans.find((l) => l.id === loanId)
  if (!loan) {
    return (
      <Modal title="Loan not found" onClose={onClose} size="sm">
        <Empty>This loan is no longer on the book.</Empty>
      </Modal>
    )
  }
  return <Detail loanId={loanId} onClose={onClose} key={loan.id + today} />
}

function Detail({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book, commit, today } = useBook()
  const { user } = useAuth()
  const actor = useActor()
  const ui = useUi()
  const loan = book.loans.find((l) => l.id === loanId)!
  const menu = useLoanMenu(loan, { hideView: true })
  const client = book.clients.find((c) => c.id === loan.clientId)
  const officer = book.employees.find((e) => e.id === loan.officerId)
  const status = effectiveStatus(loan, today)
  const stale = isStale(loan, today)
  const total = totalReturn(loan)
  const got = collected(loan)
  const pct = total ? Math.round((got / total) * 100) : 0
  const history = book.logbook.filter((g) => g.ref === loan.ref)
  const canStatus = can(user?.role ?? 'auditor', 'loan.status')
  const closed = status === 'paid' || status === 'written_off'

  return (
    <Modal
      size="lg"
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-mono">{loan.ref}</span>
          <StatusPill status={status} />
          {stale && <Pill tone="amber">Not updated</Pill>}
          {loan.deletedAt && <Pill tone="red">Archived</Pill>}
        </span>
      }
      subtitle={
        <button className="font-semibold hover:underline" style={{ color: 'var(--ink)' }} onClick={() => client && ui.open({ kind: 'client', clientId: client.id })}>
          {client?.name ?? '—'} {client && <span style={{ color: 'var(--mut)' }}>· {client.ref}</span>}
        </button>
      }
      footer={
        <>
          <Menu items={menu} label="More actions" />
          <span className="flex-1" />
          {status === 'paid' ? (
            <Button variant="outline" onClick={() => ui.open({ kind: 'paidUp', loanId: loan.id })}>Generate paid-up letter</Button>
          ) : (
            status !== 'written_off' && <Button variant="outline" onClick={() => ui.open({ kind: 'settlement', loanId: loan.id })}>Settlement quote</Button>
          )}
          {!closed && canStatus && (
            <Button variant="primary" onClick={() => commit((b) => ops.recordPayment(b, loan.id, 1, actor), `${loan.ref} · instalment recorded`)}>
              Record payment
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-5 rounded-[20px] p-5 sm:grid-cols-4" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
        <Stat label="Lent" value={zar(principalOf(loan))} sub={loan.principalDerived ? 'Derived — not recorded' : `${loan.returnRatePct}% simple return`} />
        <Stat label="Total return" value={zar(total)} sub={`${loan.schedule.length} × ${zar(loan.instalmentAmount)}`} />
        <Stat label="Collected" value={zar(got)} tone="var(--green)" sub={`${loan.instalmentsPaid} of ${loan.schedule.length} instalments`} />
        <Stat label="Outstanding" value={zar(outstanding(loan))} tone={status === 'overdue' ? 'var(--red)' : 'var(--blue)'} sub={loan.collectionFee > 0 ? `Debit ${zar(debitAmount(loan))} incl. fee` : undefined} />
        <div className="col-span-2 sm:col-span-4">
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--panel3)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--acc)' }} />
          </div>
          <div className="mt-1.5 flex justify-between text-[11px]" style={{ color: 'var(--mut)' }}>
            <span>{pct}% repaid</span>
            {loan.status === 'written_off' && <span style={{ color: 'var(--red)' }}>Written off {dateLabel(loan.writtenOffAt)} · {loan.writeOffReason}</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-3">
        <Meta label="Issued" value={`${dateLabel(loan.issuedOn)}${loan.issuedBy ? ` · ${loan.issuedBy}` : ''}`} />
        <Meta label="Officer" value={officer?.name ?? 'Unassigned'} />
        <Meta label="Purpose" value={loan.purpose} />
        <Meta label="Debit mandate" value={loan.mandateId ?? 'None registered'} mono />
        {loan.contractRef && <Meta label="DebiCheck contract" value={loan.contractRef} mono />}
        <Meta label="Collecting bank" value={client?.bank ?? '—'} />
        <Meta label="Last status update" value={dateTimeLabel(loan.statusAt)} />
      </div>

      <h3 className="eyebrow mb-2 mt-6">Instalment schedule</h3>
      <div className="overflow-hidden rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[10.5px] font-semibold tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">DATE</th>
              <th className="px-4 py-2.5 text-right">AMOUNT</th>
              <th className="px-4 py-2.5 text-right">STATE</th>
            </tr>
          </thead>
          <tbody>
            {loan.schedule.map((d, i) => {
              const paid = i < loan.instalmentsPaid
              const isNext = i === loan.instalmentsPaid && !closed
              const state = paid
                ? { tone: 'green' as const, label: 'PAID' }
                : loan.status === 'written_off'
                  ? { tone: 'mut' as const, label: 'WRITTEN OFF' }
                  : d < today
                    ? { tone: 'red' as const, label: 'PAST DUE' }
                    : d === today
                      ? { tone: 'amber' as const, label: 'DUE TODAY' }
                      : { tone: 'blue' as const, label: 'UPCOMING' }
              return (
                <tr key={d + i} style={{ borderTop: '1px solid var(--line)', background: isNext ? 'var(--accSoft)' : undefined }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--mut)' }}>{loan.priorInstalments + i + 1}/{loan.priorInstalments + loan.schedule.length}</td>
                  <td className="px-4 py-2.5 font-semibold">{dateLabel(d)}</td>
                  <td className="px-4 py-2.5 text-right num">{zar(loan.instalmentAmount)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Pill tone={state.tone}>{state.label}</Pill>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <h3 className="eyebrow mb-2 mt-6">History</h3>
      {history.length ? (
        <ol className="relative flex flex-col gap-0">
          {history.map((g) => (
            <li key={g.id} className="flex gap-3 py-2" style={{ borderBottom: '1px solid var(--line)' }}>
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: g.type.includes('OVERDUE') || g.type.includes('WRITTEN') ? 'var(--red)' : g.type.includes('PAY') || g.type.includes('PAID') ? 'var(--green)' : 'var(--acc)' }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[12px] font-bold tracking-[0.04em]">{g.type}</span>
                  <span className="text-[11px]" style={{ color: 'var(--dim)' }}>{dateTimeLabel(g.at)} · {g.by}</span>
                </div>
                {(g.comment || g.amount > 0) && (
                  <div className="text-[12px]" style={{ color: 'var(--mut)' }}>
                    {g.amount > 0 && <span className="num">{zar(g.amount)}</span>}
                    {g.amount > 0 && g.comment && ' · '}
                    {g.comment}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[12.5px]" style={{ color: 'var(--mut)' }}>No logbook entries for this loan yet.</p>
      )}
    </Modal>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 sm:block" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className={`truncate font-semibold ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}
