import { useMemo } from 'react'
import { AlertTriangle, Archive, CheckCircle2, Eye, FileText, Pencil, Receipt, RefreshCw, User } from 'lucide-react'
import type { Client, Loan } from '../../domain/types'
import { effectiveStatus, nextDue, remainingInstalments } from '../../domain/loans'
import { can } from '../../domain/permissions'
import { maskTail, zar } from '../../domain/format'
import { useAuth } from '../../store/auth'
import { useActor, useBook } from '../../store/book'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import type { MenuItem } from '../../ui/Menu'

export const TERMS = [1, 2, 3, 6] as const

/** Lookup helpers shared by the loan screens. */
export function useClientMap() {
  const { book } = useBook()
  return useMemo(() => new Map(book.clients.map((c) => [c.id, c])), [book.clients])
}

/** Whether PII should be masked on screen right now. */
export function usePiiMasked() {
  const { book } = useBook()
  const { revealed } = useUi()
  return book.settings.maskPii && !revealed
}

export function showId(c: Client | undefined, masked: boolean) {
  if (!c?.idNumber) return '—'
  return masked ? maskTail(c.idNumber, 3, 6) : c.idNumber
}

export function showAccount(c: Client | undefined, masked: boolean) {
  if (!c?.accountNo) return '—'
  return masked ? maskTail(c.accountNo, 4, 3) : c.accountNo
}

/** Row actions for a loan, permission-gated. Used by the table and the detail modal. */
export function useLoanMenu(loan: Loan, opts: { hideView?: boolean } = {}): MenuItem[] {
  const { user } = useAuth()
  const { book, commit, today } = useBook()
  const actor = useActor()
  const ui = useUi()
  const role = user?.role ?? 'auditor'
  const eff = effectiveStatus(loan, today)
  const closed = eff === 'paid' || eff === 'written_off'
  const remaining = remainingInstalments(loan)
  const client = book.clients.find((c) => c.id === loan.clientId)
  return [
    { label: 'View & history', icon: <Eye size={15} />, onClick: () => ui.open({ kind: 'loan', loanId: loan.id }), hidden: opts.hideView },
    {
      label: remaining > 1 ? `Record instalment paid` : 'Record payment',
      icon: <Receipt size={15} />,
      hidden: closed || !can(role, 'loan.status'),
      onClick: () => commit((b) => ops.recordPayment(b, loan.id, 1, actor, `Due ${nextDue(loan) ?? '—'}`), `${loan.ref} · instalment recorded`),
    },
    {
      label: 'Mark fully paid',
      icon: <CheckCircle2 size={15} />,
      hidden: closed || !can(role, 'loan.status'),
      onClick: () => commit((b) => ops.setLoanStatus(b, loan.id, 'paid', actor), `${loan.ref} → PAID`),
    },
    {
      label: 'Mark overdue',
      icon: <AlertTriangle size={15} />,
      hidden: closed || loan.status === 'overdue' || !can(role, 'loan.status'),
      onClick: () => commit((b) => ops.setLoanStatus(b, loan.id, 'overdue', actor, 'Debit not received'), `${loan.ref} → OVERDUE`),
    },
    { label: 'Change status', icon: <RefreshCw size={15} />, hidden: !can(role, 'loan.status'), onClick: () => ui.open({ kind: 'loanStatus', loanId: loan.id }) },
    { label: 'Edit loan', icon: <Pencil size={15} />, hidden: !can(role, 'loan.edit'), onClick: () => ui.open({ kind: 'loanEdit', loanId: loan.id }) },
    { label: 'Generate paid-up letter', icon: <FileText size={15} />, hidden: eff !== 'paid', onClick: () => ui.open({ kind: 'paidUp', loanId: loan.id }) },
    { label: 'Settlement quote', icon: <FileText size={15} />, hidden: eff === 'paid' || eff === 'written_off', onClick: () => ui.open({ kind: 'settlement', loanId: loan.id }) },
    { label: 'Open client', icon: <User size={15} />, hidden: !client, onClick: () => ui.open({ kind: 'client', clientId: loan.clientId }) },
    {
      label: 'Archive loan',
      icon: <Archive size={15} />,
      danger: true,
      hidden: !can(role, 'loan.delete'),
      onClick: () =>
        ui.open({
          kind: 'confirm',
          title: `Archive ${loan.ref}?`,
          body: `The loan for ${client?.name ?? '—'} (${zar(loan.instalmentAmount * loan.schedule.length)} return) is removed from the book but kept in the archive for the 5-year retention period. This is logged.`,
          confirmLabel: 'Archive',
          danger: true,
          requireText: loan.ref,
          reasonLabel: 'Reason',
          onConfirm: (reason) => commit((b) => ops.archiveLoan(b, loan.id, actor, reason), `${loan.ref} archived`),
        }),
    },
  ]
}

/** Next 25th at least ~2 weeks away, else one month from today — the usual payday collection date. */
export function defaultFirstDue(todayIso: string): string {
  const [y, m, d] = todayIso.split('-').map(Number)
  const t = new Date(y, m - 1, d)
  const c = new Date(y, m - 1, 25)
  if ((c.getTime() - t.getTime()) / 864e5 < 14) c.setMonth(c.getMonth() + 1)
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`
}

/** Small uppercase stat block used in loan modals. */
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className="mt-1 truncate text-[19px] font-bold num" style={{ color: tone }}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--dim)' }}>{sub}</div>}
    </div>
  )
}
