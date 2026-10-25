import { useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Field, Input, Select } from '../../ui/bits'
import { useActor, useBook } from '../../store/book'
import * as ops from '../../store/ops'
import type { Loan } from '../../domain/types'
import { buildSchedule, instalmentFor } from '../../domain/loans'
import { dateLabel, parseMoney, round2, toIso, zar } from '../../domain/format'

const num = (s: string) => {
  const n = parseMoney(s)
  return Number.isFinite(n) ? n : NaN
}

export function LoanEditModal({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book } = useBook()
  const loan = book.loans.find((l) => l.id === loanId)
  if (!loan) {
    return (
      <Modal title="Loan not found" onClose={onClose} size="sm">
        <Empty>This loan is no longer on the book.</Empty>
      </Modal>
    )
  }
  return <Editor loan={loan} onClose={onClose} />
}

function Editor({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const [principal, setPrincipal] = useState(loan.principal == null ? '' : String(loan.principal))
  const [rate, setRate] = useState(String(loan.returnRatePct))
  const [inst, setInst] = useState(String(loan.instalmentAmount))
  const [fee, setFee] = useState(String(loan.collectionFee || ''))
  const [dates, setDates] = useState<string[]>(loan.schedule)
  const [paid, setPaid] = useState(String(loan.instalmentsPaid))
  const [purpose, setPurpose] = useState(loan.purpose)
  const [mandate, setMandate] = useState(loan.mandateId ?? '')
  const [officerId, setOfficerId] = useState(loan.officerId ?? '')

  const p = principal.trim() === '' ? null : num(principal)
  const r = num(rate)
  const i = num(inst)
  const f = fee.trim() === '' ? 0 : num(fee)
  const n = dates.length
  const paidN = Math.round(num(paid))
  const badDates = dates.some((d) => !toIso(d))
  const errors = [
    p != null && !(p > 0) && 'Lent amount must be positive (or blank if not recorded)',
    !(r >= 0) && 'Return % is required',
    !(i > 0) && 'Instalment must be positive',
    !(f >= 0) && 'Collection fee cannot be negative',
    badDates && 'Every instalment needs a valid date',
    !(paidN >= 0 && paidN <= n) && `Instalments paid must be 0–${n}`,
  ].filter(Boolean) as string[]

  const recompute = () => {
    if (p != null && p > 0 && r >= 0) setInst(String(instalmentFor(p, r, n)))
  }
  const setCount = (count: number) => {
    const first = toIso(dates[0]) ?? loan.schedule[0]
    setDates(buildSchedule(first, count))
  }

  const save = () => {
    const sorted = dates.map((d) => toIso(d)!).sort()
    const patch: Partial<Loan> = {
      principal: p,
      principalDerived: p == null ? loan.principalDerived || true : false,
      returnRatePct: r,
      instalmentAmount: round2(i),
      collectionFee: round2(f),
      schedule: sorted,
      instalmentsPaid: paidN,
      purpose: purpose.trim() || 'Personal',
      mandateId: mandate.trim() || null,
      officerId: officerId || null,
    }
    const changes: string[] = []
    if (patch.principal !== loan.principal) changes.push(`lent ${zar(loan.principal)} → ${zar(patch.principal ?? null)}`)
    if (patch.returnRatePct !== loan.returnRatePct) changes.push(`rate ${loan.returnRatePct}% → ${r}%`)
    if (patch.instalmentAmount !== loan.instalmentAmount) changes.push(`instalment ${zar(loan.instalmentAmount)} → ${zar(patch.instalmentAmount!)}`)
    if (patch.collectionFee !== loan.collectionFee) changes.push(`fee ${zar(loan.collectionFee)} → ${zar(patch.collectionFee!)}`)
    if (JSON.stringify(sorted) !== JSON.stringify(loan.schedule)) changes.push(`schedule ${loan.schedule.length}× from ${dateLabel(loan.schedule[0])} → ${sorted.length}× from ${dateLabel(sorted[0])}`)
    if (paidN !== loan.instalmentsPaid) changes.push(`paid ${loan.instalmentsPaid} → ${paidN}`)
    if (patch.purpose !== loan.purpose) changes.push(`purpose → ${patch.purpose}`)
    if (patch.mandateId !== loan.mandateId) changes.push(`mandate → ${patch.mandateId ?? 'none'}`)
    if (patch.officerId !== loan.officerId) changes.push(`officer → ${book.employees.find((e) => e.id === patch.officerId)?.name ?? 'unassigned'}`)
    if (!changes.length) return onClose()
    commit((b) => ops.updateLoan(b, loan.id, patch, actor, changes.join(' · ')), `${loan.ref} updated`)
    onClose()
  }

  return (
    <Modal
      title={`Edit ${loan.ref}`}
      subtitle="Every change is written to the logbook with before and after values"
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!errors.length} onClick={save}>Save changes</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lent (R)" hint={loan.principalDerived ? 'Not recorded — currently back-calculated' : undefined}>
          <Input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="Not recorded" />
        </Field>
        <Field label="Return %">
          <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Return per instalment (R)" hint={<button type="button" className="font-semibold underline-offset-2 hover:underline" style={{ color: 'var(--acc)' }} onClick={recompute}>Recalculate from lent × return</button>}>
          <Input inputMode="decimal" value={inst} onChange={(e) => setInst(e.target.value)} />
        </Field>
        <Field label="Collection fee per debit (R)">
          <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Number of instalments">
          <Select value={String(n)} onChange={(e) => setCount(+e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 9, 12].map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="Instalments already paid">
          <Input inputMode="numeric" value={paid} onChange={(e) => setPaid(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--mut)' }}>Instalment dates</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {dates.map((d, k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="w-9 text-[11px] font-semibold" style={{ color: 'var(--dim)' }}>{k + 1}.</span>
                <Input type="date" value={toIso(d) ?? ''} onChange={(e) => setDates((ds) => ds.map((x, j) => (j === k ? e.target.value : x)))} aria-label={`Instalment ${k + 1} date`} />
              </label>
            ))}
          </div>
        </div>
        <Field label="Purpose">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field label="Debit mandate ID">
          <Input value={mandate} onChange={(e) => setMandate(e.target.value)} className="font-mono" />
        </Field>
        <Field label="Loan officer" className="sm:col-span-2">
          <Select value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
            <option value="">Unassigned</option>
            {book.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.active ? '' : ' (inactive)'}</option>)}
          </Select>
        </Field>
      </div>
      <div className="mt-4 rounded-2xl p-4 text-[12.5px]" style={{ background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
        Total return <b className="num" style={{ color: 'var(--ink)' }}>{zar(Number.isFinite(i) ? round2(i * n) : null)}</b> over {n} instalment{n > 1 ? 's' : ''}
        {f > 0 && <> · client debit <b className="num" style={{ color: 'var(--ink)' }}>{zar(round2(i + f))}</b></>}
      </div>
      {!!errors.length && (
        <ul className="mt-3 text-[12px]" style={{ color: 'var(--red)' }}>
          {errors.map((e) => <li key={e}>• {e}</li>)}
        </ul>
      )}
    </Modal>
  )
}
