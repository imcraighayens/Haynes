import { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'
import { Field, Input, Textarea } from './bits'

/**
 * Confirmation for destructive or irreversible actions. With `requireText`
 * the user must type it (e.g. the loan ref) before confirming — this replaces
 * the prototype's client-side delete PIN.
 */
export function ConfirmModal({
  title, body, confirmLabel = 'Confirm', danger, requireText, reasonLabel, onConfirm, onClose,
}: {
  title: string
  body: string
  confirmLabel?: string
  danger?: boolean
  requireText?: string
  reasonLabel?: string
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const ok = (!requireText || typed.trim().toUpperCase() === requireText.toUpperCase()) && (!reasonLabel || reason.trim().length > 2)
  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={!ok}
            onClick={() => {
              onConfirm(reason.trim())
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-[13.5px] leading-relaxed" style={{ color: 'var(--mut)' }}>{body}</p>
      {reasonLabel && (
        <Field label={reasonLabel} className="mt-4">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      )}
      {requireText && (
        <Field label={`Type ${requireText} to confirm`} className="mt-4">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus={!reasonLabel} />
        </Field>
      )}
    </Modal>
  )
}
