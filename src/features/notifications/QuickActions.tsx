import { Check, Clock, AlertTriangle } from 'lucide-react'
import type { Loan } from '../../domain/types'
import { can } from '../../domain/permissions'
import { useAuth } from '../../store/auth'
import { useActor, useBook } from '../../store/book'
import * as ops from '../../store/ops'

export type QuickTarget = 'paid' | 'overdue' | 'open'

/** Apply one quick status update to a loan (pure, for batching). */
export function applyQuick(b: Parameters<typeof ops.recordPayment>[0], loan: Loan, to: QuickTarget, actor: { name: string }, note: string) {
  if (to === 'paid') return ops.recordPayment(b, loan.id, 1, actor, note)
  if (to === 'overdue') return ops.setLoanStatus(b, loan.id, 'overdue', actor, note)
  return ops.confirmStatus(b, loan.id, actor, note || 'Still open — checked')
}

/** Mark paid / Overdue / Still open buttons for one instalment. */
export function QuickActions({ loan, note = '', compact }: { loan: Loan; note?: string; compact?: boolean }) {
  const { commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  if (!user || !can(user.role, 'loan.status')) return null
  const btn = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em] transition hover:brightness-110'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        className={btn}
        style={{ background: 'var(--greenSoft)', color: 'var(--green)' }}
        onClick={(e) => {
          e.stopPropagation()
          commit((b) => applyQuick(b, loan, 'paid', actor, note), `${loan.ref} · instalment marked paid`)
        }}
      >
        <Check size={11} /> {compact ? 'Paid' : 'Mark paid'}
      </button>
      <button
        className={btn}
        style={{ background: 'var(--redSoft)', color: 'var(--red)' }}
        disabled={loan.status === 'overdue'}
        onClick={(e) => {
          e.stopPropagation()
          commit((b) => applyQuick(b, loan, 'overdue', actor, note), `${loan.ref} → OVERDUE`)
        }}
      >
        <AlertTriangle size={11} /> Overdue
      </button>
      <button
        className={btn}
        style={{ background: 'var(--hover)', color: 'var(--mut)' }}
        onClick={(e) => {
          e.stopPropagation()
          commit((b) => applyQuick(b, loan, 'open', actor, note), `${loan.ref} · still open`)
        }}
      >
        <Clock size={11} /> Still open
      </button>
    </div>
  )
}
