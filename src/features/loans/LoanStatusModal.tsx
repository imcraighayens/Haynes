import { useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Field, Input, StatusPill, Textarea } from '../../ui/bits'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import * as ops from '../../store/ops'
import type { LoanStatus } from '../../domain/types'
import { effectiveStatus, nextDue, outstanding, remainingInstalments } from '../../domain/loans'
import { can } from '../../domain/permissions'
import { dateLabel, round2, zar } from '../../domain/format'

type Choice = 'payment' | LoanStatus | 'confirm'

export function LoanStatusModal({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book, commit, today } = useBook()
  const { user } = useAuth()
  const actor = useActor()
  const loan = book.loans.find((l) => l.id === loanId)
  const remaining = loan ? remainingInstalments(loan) : 0
  const [choice, setChoice] = useState<Choice>(remaining > 0 && loan?.status !== 'written_off' ? 'payment' : 'issued')
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')
  if (!loan) {
    return (
      <Modal title="Loan not found" onClose={onClose} size="sm">
        <Empty>This loan is no longer on the book.</Empty>
      </Modal>
    )
  }
  const role = user?.role ?? 'auditor'
  const eff = effectiveStatus(loan, today)
  const k = Math.max(1, Math.min(remaining, Math.round(+count) || 1))

  const options: { value: Choice; label: string; desc: string; hidden?: boolean }[] = [
    { value: 'payment', label: 'Record payment', desc: `Collect ${k} instalment${k > 1 ? 's' : ''} · ${zar(round2(loan.instalmentAmount * k))}`, hidden: !remaining || loan.status === 'written_off' },
    { value: 'confirm', label: 'Confirm still issued', desc: 'Clears the “not updated” flag without changing the loan', hidden: loan.status !== 'issued' },
    { value: 'paid', label: 'Paid in full', desc: `Collects all ${remaining} remaining · ${zar(outstanding(loan))}`, hidden: eff === 'paid' },
    { value: 'overdue', label: 'Overdue', desc: 'The debit failed or the client missed the date', hidden: loan.status === 'overdue' || eff === 'paid' },
    { value: 'issued', label: eff === 'paid' ? 'Re-open (unmark paid)' : 'Back to issued', desc: eff === 'paid' ? 'Reverses the last instalment in the bank' : 'Arrears resolved; collection continues', hidden: loan.status === 'issued' },
    { value: 'settled_early', label: 'Settled early', desc: 'Client settled the outstanding balance before the schedule ended', hidden: eff === 'paid' || eff === 'written_off' },
    { value: 'written_off', label: 'Write off', desc: `Removes ${zar(outstanding(loan))} from the expected return`, hidden: loan.status === 'written_off' || !can(role, 'loan.writeoff') },
  ]
  const visible = options.filter((o) => !o.hidden)
  const ok = visible.some((o) => o.value === choice) && (choice !== 'written_off' || note.trim().length > 2)

  const apply = () => {
    if (choice === 'payment') commit((b) => ops.recordPayment(b, loan.id, k, actor, note.trim()), `${loan.ref} · ${k} instalment${k > 1 ? 's' : ''} recorded`)
    else if (choice === 'confirm') commit((b) => ops.confirmStatus(b, loan.id, actor, note.trim() || 'Status confirmed'), `${loan.ref} confirmed`)
    else commit((b) => ops.setLoanStatus(b, loan.id, choice, actor, note.trim()), `${loan.ref} → ${ops.STATUS_LABEL[choice]}`)
    onClose()
  }

  return (
    <Modal
      title={`Update ${loan.ref}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          Now <StatusPill status={eff} /> · next due {dateLabel(nextDue(loan))} · {remaining} of {loan.schedule.length} instalments open
        </span>
      }
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={choice === 'written_off' ? 'danger' : 'primary'} disabled={!ok} onClick={apply}>Apply</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="New status">
        {visible.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-3 rounded-2xl px-4 py-3 transition"
            style={{ background: choice === o.value ? 'var(--accSoft)' : 'var(--panel2)', border: `1px solid ${choice === o.value ? 'var(--acc)' : 'var(--line)'}` }}
          >
            <input type="radio" name="status" className="mt-1" checked={choice === o.value} onChange={() => setChoice(o.value)} />
            <span>
              <span className="block text-[13.5px] font-semibold">{o.label}</span>
              <span className="block text-[12px]" style={{ color: 'var(--mut)' }}>{o.desc}</span>
            </span>
          </label>
        ))}
      </div>
      {choice === 'payment' && remaining > 1 && (
        <Field label="Instalments received" className="mt-4">
          <Input type="number" min={1} max={remaining} value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
      )}
      <Field label={choice === 'written_off' ? 'Write-off reason (required)' : 'Note (logged)'} className="mt-4">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={choice === 'overdue' ? 'e.g. Debit returned — insufficient funds' : ''} />
      </Field>
    </Modal>
  )
}
