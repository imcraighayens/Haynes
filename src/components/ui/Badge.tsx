import { clsx } from 'clsx'
import type { LoanStatus } from '../../data/types'

const styles: Record<LoanStatus, string> = {
  issued: 'bg-brand-500/15 text-brand-500 dark:text-brand-300 ring-1 ring-brand-500/30',
  paid: 'bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/30',
  overdue: 'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30',
  due_today: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30',
}

const labels: Record<LoanStatus, string> = {
  issued: 'Issued',
  paid: 'Paid',
  overdue: 'Overdue',
  due_today: 'Due Today',
}

export function StatusBadge({ status }: { status: LoanStatus }) {
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium', styles[status])}>
      {labels[status]}
    </span>
  )
}
