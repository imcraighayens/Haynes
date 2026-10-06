import { parseISO, format } from 'date-fns'
import type { DashboardData, Loan } from '../data/types'

export interface Metrics {
  totalLoans: number
  activeClients: number
  totalLoanedOut: number
  expectedReturn: number
  overdueAmount: number
  collectedThisMonth: number
  outstanding: number
  expectedProfit: number
  repaymentRate: number
  counts: { all: number; issued: number; dueToday: number; overdue: number; paid: number }
}

export function computeMetrics(data: DashboardData): Metrics {
  const { loans } = data
  const outstanding = loans.filter((l) => l.status !== 'paid')
  const activeClientIds = new Set(outstanding.map((l) => l.clientId))

  const totalLoanedOut = outstanding.reduce((s, l) => s + l.amount, 0)
  const expectedReturn = outstanding.reduce((s, l) => s + l.returnAmount, 0)
  const overdueAmount = loans.filter((l) => l.status === 'overdue').reduce((s, l) => s + l.returnAmount, 0)

  const now = new Date()
  const collectedThisMonth = loans
    .filter((l) => l.status === 'paid' && l.paidDate && sameMonth(parseISO(l.paidDate), now))
    .reduce((s, l) => s + l.returnAmount, 0)

  const paidCount = loans.filter((l) => l.status === 'paid').length

  return {
    totalLoans: loans.length,
    activeClients: activeClientIds.size,
    totalLoanedOut,
    expectedReturn,
    overdueAmount,
    collectedThisMonth,
    outstanding: totalLoanedOut,
    expectedProfit: expectedReturn - totalLoanedOut,
    repaymentRate: loans.length ? Math.round((paidCount / loans.length) * 100) : 0,
    counts: {
      all: loans.length,
      issued: loans.filter((l) => l.status === 'issued').length,
      dueToday: loans.filter((l) => l.status === 'due_today').length,
      overdue: loans.filter((l) => l.status === 'overdue').length,
      paid: paidCount,
    },
  }
}

function sameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

/** Monthly disbursed vs collected for the last `months` months. */
export function monthlySeries(loans: Loan[], months = 6) {
  const buckets = new Map<string, { label: string; disbursed: number; collected: number }>()
  const now = new Date()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = format(d, 'yyyy-MM')
    buckets.set(key, { label: format(d, 'MMM'), disbursed: 0, collected: 0 })
  }
  loans.forEach((l) => {
    const issuedKey = l.issuedDate.slice(0, 7)
    if (buckets.has(issuedKey)) buckets.get(issuedKey)!.disbursed += l.amount
    if (l.status === 'paid' && l.paidDate) {
      const paidKey = l.paidDate.slice(0, 7)
      if (buckets.has(paidKey)) buckets.get(paidKey)!.collected += l.returnAmount
    }
  })
  return Array.from(buckets.values())
}

export function statusBreakdown(loans: Loan[]) {
  return [
    { name: 'Paid', value: loans.filter((l) => l.status === 'paid').length, color: '#22c55e' },
    { name: 'Issued', value: loans.filter((l) => l.status === 'issued').length, color: '#3366ff' },
    { name: 'Due today', value: loans.filter((l) => l.status === 'due_today').length, color: '#f59e0b' },
    { name: 'Overdue', value: loans.filter((l) => l.status === 'overdue').length, color: '#ef4444' },
  ].filter((s) => s.value > 0)
}
