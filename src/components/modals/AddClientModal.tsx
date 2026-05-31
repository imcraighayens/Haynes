import { useState } from 'react'
import { Modal, Field, inputClass } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useData } from '../../context/DataContext'

export function AddClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addClient } = useData()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [address, setAddress] = useState('')

  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const valid = Boolean(name.trim() && phone.trim() && emailOk)

  function submit() {
    if (!valid) return
    addClient({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || undefined,
      idNumber: idNumber.trim() || undefined,
      address: address.trim() || undefined,
    })
    setName('')
    setPhone('')
    setEmail('')
    setIdNumber('')
    setAddress('')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Client"
      subtitle="Register a new borrower"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid}>
            Add Client
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Full name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <input
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+27 ..."
            />
          </Field>
          <Field label="ID number">
            <input className={inputClass} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </Field>
        </div>
        <Field label="Email" hint={!emailOk ? 'Enter a valid email address' : undefined}>
          <input
            className={inputClass}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@mail.com"
          />
        </Field>
        <Field label="Address">
          <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
