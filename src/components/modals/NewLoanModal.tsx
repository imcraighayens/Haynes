import { useEffect, useMemo, useState } from 'react'
import { Modal, Field, inputClass } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useData } from '../../context/DataContext'
import { money } from '../../lib/format'
import { loadSettings } from '../../lib/settings'
import type { Loan } from '../../data/types'

export function NewLoanModal({
  open,
  onClose,
  loan,
}: {
  open: boolean
  onClose: () => void
  /** When provided, the modal edits this loan instead of issuing a new one. */
  loan?: Loan | null
}) {
  const { data, addLoan, editLoan } = useData()
  const isEdit = Boolean(loan)

  const [clientId, setClientId] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState(() => String(loadSettings().defaultInterestRate))
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 10)
  })

  // Hydrate from the loan being edited, or reset for a fresh issue.
  useEffect(() => {
    if (!open) return
    if (loan) {
      setClientId(loan.clientId)
      setAmount(String(loan.amount))
      setRate(String(Math.round(loan.interestRate * 100)))
      setIssuedDate(loan.issuedDate)
      setDueDate(loan.dueDate)
    } else {
      const d = new Date()
      d.setMonth(d.getMonth() + 1)
      setClientId('')
      setAmount('')
      setRate(String(loadSettings().defaultInterestRate))
      setIssuedDate(new Date().toISOString().slice(0, 10))
      setDueDate(d.toISOString().slice(0, 10))
    }
  }, [open, loan])

  const amt = parseFloat(amount) || 0
  const ratePct = parseFloat(rate) || 0
  const returnAmount = useMemo(() => amt * (1 + ratePct / 100), [amt, ratePct])
  const datesOk = Boolean(issuedDate && dueDate && dueDate >= issuedDate)
  const valid = Boolean(clientId && amt > 0 && ratePct >= 0 && datesOk)
  const noClients = data.clients.length === 0

  function submit() {
    if (!valid) return
    if (isEdit && loan) {
      editLoan(loan.id, { amount: amt, interestRate: ratePct / 100, issuedDate, dueDate })
    } else {
      addLoan({ clientId, amount: amt, interestRate: ratePct / 100, issuedDate, dueDate })
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Loan' : 'New Loan'}
      subtitle={isEdit ? 'Update the terms of this loan' : 'Disburse a loan to an existing client'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            {isEdit ? 'Save changes' : 'Issue Loan'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {noClients && !isEdit && (
          <div className="rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-sm px-3 py-2 border border-amber-500/20">
            No clients yet — add a client first before issuing a loan.
          </div>
        )}
        <Field label="Client">
          <select
            className={inputClass}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={noClients || isEdit}
          >
            <option value="">Select a client…</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (R)">
            <input
              className={inputClass}
              type="number"
              min={0}
              placeholder="5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Interest rate (%)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Issued date">
            <input
              className={inputClass}
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
            />
          </Field>
          <Field label="Due date" hint={!datesOk && issuedDate && dueDate ? 'Due date must be on or after the issued date' : undefined}>
            <input className={inputClass} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="surface-muted rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-slate-500 dark:text-slate-400">Expected return</span>
          <span className="text-lg font-bold text-brand-500 dark:text-brand-300">{money(returnAmount)}</span>
        </div>
      </div>
    </Modal>
  )
}
