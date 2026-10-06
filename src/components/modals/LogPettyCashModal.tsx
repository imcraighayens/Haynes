import { useState } from 'react'
import { Modal, Field, inputClass } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useData } from '../../context/DataContext'

export function LogPettyCashModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { logPettyCash } = useData()
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  const amt = parseFloat(amount) || 0
  const valid = description.trim() && amt > 0

  function submit() {
    if (!valid) return
    logPettyCash({ description: description.trim(), amount: amt, date })
    setDescription('')
    setAmount('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Log Petty Cash"
      subtitle="Record a small cash expense"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Log Expense
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Description">
          <input
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Transport, airtime…"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Amount (R)">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Date">
            <input className={inputClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
