import type { Book, Expense } from './types'
import { monthKey, round2, todayIso } from './format'

export interface BankPosition {
  balance: number
  /** true when no opening balance has been captured and the figure is derived from activity */
  derived: boolean
  moves: Book['bankTx']
}

/**
 * Bank position = captured opening balance + every transaction after it.
 * Without an opening balance the figure is net activity (collections − loans
 * issued), flagged as derived.
 */
export function bankPosition(book: Pick<Book, 'bankTx' | 'settings'>): BankPosition {
  const { bankOpeningBalance, bankOpeningAt } = book.settings
  const sorted = book.bankTx.slice().sort((a, b) => b.at.localeCompare(a.at))
  if (bankOpeningBalance == null || !bankOpeningAt) {
    const bal = sorted.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
    return { balance: round2(bal), derived: true, moves: sorted }
  }
  const after = sorted.filter((t) => t.at > bankOpeningAt)
  const bal = bankOpeningBalance + after.reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0)
  return { balance: round2(bal), derived: false, moves: after }
}

export const monthlyExpenses = (xs: Expense[]) => round2(xs.reduce((s, x) => s + x.amount, 0))

/** Money in / out this calendar month from the bank feed. */
export function monthFlows(book: Pick<Book, 'bankTx'>, today = todayIso()) {
  const mk = monthKey(today)
  let inflow = 0, outflow = 0
  for (const t of book.bankTx) {
    if (t.at.slice(0, 7) !== mk) continue
    if (t.type === 'in') inflow += t.amount
    else outflow += t.amount
  }
  return { inflow: round2(inflow), outflow: round2(outflow) }
}
