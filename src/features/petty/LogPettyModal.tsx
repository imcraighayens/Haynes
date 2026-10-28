import { useState } from 'react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Field, Input, Select, Textarea } from '../../ui/bits'
import { useActor, useBook } from '../../store/book'
import * as ops from '../../store/ops'
import { parseMoney, uid } from '../../domain/format'
import type { PettyCategory } from '../../domain/types'

export const PETTY_CATEGORIES: { value: PettyCategory; label: string }[] = [
  { value: 'travel', label: 'Travel & fuel' },
  { value: 'office', label: 'Office supplies' },
  { value: 'airtime', label: 'Airtime & data' },
  { value: 'meals', label: 'Meals' },
  { value: 'advance', label: 'Staff advance' },
  { value: 'other', label: 'Other' },
]

export function LogPettyModal({ onClose }: { onClose: () => void }) {
  const { book, commit, today } = useBook()
  const actor = useActor()
  const [f, setF] = useState({ borrower: '', amount: '', category: 'travel' as PettyCategory, purpose: '', notes: '', date: today })
  const [tried, setTried] = useState(false)
  const amount = parseMoney(f.amount)
  const errors = {
    amount: !(amount > 0) ? 'Enter an amount in rand' : amount > 50000 ? 'Petty cash is capped at R 50 000 per entry' : null,
    purpose: f.purpose.trim().length < 3 ? 'Say what the money was for' : null,
    date: !f.date ? 'Pick a date' : f.date > today ? 'Date cannot be in the future' : null,
  }
  const valid = !errors.amount && !errors.purpose && !errors.date
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const staff = book.employees.filter((e) => e.active)

  const save = () => {
    setTried(true)
    if (!valid) return
    commit(
      (b) =>
        ops.addPetty(
          b,
          {
            id: uid('p_'),
            date: f.date,
            amount: Math.round(amount * 100) / 100,
            category: f.category,
            purpose: f.purpose.trim(),
            borrower: f.borrower.trim(),
            notes: f.notes.trim(),
            status: 'PENDING',
            by: actor.name,
            createdAt: new Date().toISOString(),
          },
          actor,
        ),
      'Petty cash logged',
    )
    onClose()
  }

  return (
    <Modal
      title="Log petty cash"
      subtitle="Cash paid out of the office float. New entries wait for approval."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={tried && !valid}>Log petty cash</Button>
        </>
      }
    >
      <form className="grid grid-cols-2 gap-4" onSubmit={(e) => { e.preventDefault(); save() }}>
        <Field label="Amount (R)" error={tried ? errors.amount : null}>
          <Input inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0.00" autoFocus />
        </Field>
        <Field label="Date" error={tried ? errors.date : null}>
          <Input type="date" value={f.date} max={today} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Category" className="col-span-2">
          <Select value={f.category} onChange={(e) => set('category', e.target.value as PettyCategory)}>
            {PETTY_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Purpose" className="col-span-2" error={tried ? errors.purpose : null}>
          <Input value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Fuel — client visits Klerksdorp" />
        </Field>
        <Field label="Paid to / staff member" className="col-span-2" hint={f.category === 'advance' ? 'Advances stay outstanding until marked repaid.' : 'Optional'}>
          <Input list="petty-staff" value={f.borrower} onChange={(e) => set('borrower', e.target.value)} placeholder="Name" />
          <datalist id="petty-staff">{staff.map((s) => <option key={s.id} value={s.name} />)}</datalist>
        </Field>
        <Field label="Notes" className="col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Receipt number, slip reference…" />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
