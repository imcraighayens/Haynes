import { useMemo, useState } from 'react'
import { Modal, Field, inputClass } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useData } from '../../context/DataContext'
import { money } from '../../lib/format'
import { loadSettings } from '../../lib/settings'

export function NewLoanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addLoan } = useData()
  const [clientId, setClientId] = useState('')
  const [amount, setAmount] = useState('')
  const [rate, setRate] = useState(() => String(loadSettings().defaultInterestRate))
  const [issuedDate, setIssuedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 1)
    return d.toISOString().slice(0, 10)
  })

  const amt = parseFloat(amount) || 0
  const ratePct = parseFloat(rate) || 0
  const returnAmount = useMemo(() => amt * (1 + ratePct / 100), [amt, ratePct])
  const valid = clientId && amt > 0 && ratePct >= 0 && issuedDate && dueDate

  function submit() {
    if (!valid) return
    addLoan({ clientId, amount: amt, interestRate: ratePct / 100, issuedDate, dueDate })
    reset()
    onClose()
  }
  function reset() {
    setClientId('')
    setAmount('')
    setRate(String(loadSettings().defaultInterestRate))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Loan"
      subtitle="Disburse a loan to an existing client"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Issue Loan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Client">
          <select className={inputClass} value={clientId} onChange={(e) => setClientId(e.target.value)}>
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
          <Field label="Due date">
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
