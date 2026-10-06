import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/Badge'
import type { Loan } from '../../data/types'
import { useData } from '../../context/DataContext'
import { money, fmtDate, dueLabel } from '../../lib/format'
import { CheckCircle2, Pencil, Phone, Mail, MapPin, Calendar, Hash } from 'lucide-react'

export function LoanDetailModal({
  loan,
  onClose,
  onEdit,
}: {
  loan: Loan | null
  onClose: () => void
  onEdit?: (loan: Loan) => void
}) {
  const { data, markLoanPaid } = useData()
  if (!loan) return null
  const client = data.clients.find((c) => c.id === loan.clientId)
  const due = dueLabel(loan.dueDate)
  const profit = loan.returnAmount - loan.amount

  return (
    <Modal
      open={!!loan}
      onClose={onClose}
      title={loan.clientName}
      subtitle={`Loan ${loan.id.toUpperCase()}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {onEdit && (
            <Button
              variant="outline"
              icon={<Pencil size={16} />}
              onClick={() => {
                onEdit(loan)
                onClose()
              }}
            >
              Edit
            </Button>
          )}
          {loan.status !== 'paid' && (
            <Button
              icon={<CheckCircle2 size={16} />}
              onClick={() => {
                markLoanPaid(loan.id)
                onClose()
              }}
            >
              Mark as paid
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <StatusBadge status={loan.status} />
          {loan.status !== 'paid' && (
            <span
              className={
                due.tone === 'late'
                  ? 'text-sm font-medium text-red-500'
                  : due.tone === 'soon'
                    ? 'text-sm font-medium text-amber-500'
                    : 'text-sm font-medium text-slate-400'
              }
            >
              {due.label}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Principal" value={money(loan.amount)} />
          <Stat label={`Return ${Math.round(loan.interestRate * 100)}%`} value={money(loan.returnAmount, true)} />
          <Stat label="Profit" value={money(profit, true)} accent />
        </div>

        <div className="surface-muted rounded-xl p-4 space-y-2.5 text-sm">
          <Row icon={<Calendar size={15} />} label="Issued" value={fmtDate(loan.issuedDate)} />
          <Row icon={<Calendar size={15} />} label="Due" value={fmtDate(loan.dueDate)} />
          {loan.paidDate && <Row icon={<CheckCircle2 size={15} />} label="Paid on" value={fmtDate(loan.paidDate)} />}
          <Row icon={<Hash size={15} />} label="Reference" value={loan.id.toUpperCase()} />
        </div>

        {client && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Borrower</p>
            <div className="surface-muted rounded-xl p-4 space-y-2.5 text-sm">
              <Row icon={<Phone size={15} />} label="Phone" value={client.phone} />
              {client.email && <Row icon={<Mail size={15} />} label="Email" value={client.email} />}
              {client.address && <Row icon={<MapPin size={15} />} label="Address" value={client.address} />}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="surface-muted rounded-xl p-3 text-center">
      <p className="text-[11px] text-slate-400">{label}</p>
      <p className={accent ? 'text-base font-bold text-green-500' : 'text-base font-bold text-slate-800 dark:text-white'}>
        {value}
      </p>
    </div>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon} {label}
      </span>
      <span className="text-slate-800 dark:text-white font-medium">{value}</span>
    </div>
  )
}
