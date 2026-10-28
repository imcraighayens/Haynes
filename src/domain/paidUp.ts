import type { Book, Client, Loan, Role } from './types'
import { MONTH_NAMES, parseDate, round2, todayIso, zar } from './format'
import { debitAmount, outstanding } from './loans'

/**
 * Paid-up letters (NCA s71A): issued only for an account whose status is
 * fully paid and whose balance is nil. Several paid accounts of one client
 * can go on one letter, as in the Ecoloans template.
 */

export const PAID_UP_LOG_TYPE = 'PAID-UP LETTER ISSUED'

/** Why a paid-up letter can't be issued for this loan, or null when it can. */
export function paidUpBlocker(l: Loan): string | null {
  if (l.deletedAt) return 'This loan is archived.'
  if (l.status === 'written_off') return 'This loan was written off, not paid. A paid-up letter would misstate the account.'
  const left = l.schedule.length - l.instalmentsPaid
  if (l.status !== 'paid' && l.status !== 'settled_early') {
    return left > 0
      ? `The account is not fully paid: ${left} of ${l.priorInstalments + l.schedule.length} instalments (${zar(outstanding(l))}) still to collect.`
      : 'Every instalment is collected but the status was never set to Paid. Confirm the status first.'
  }
  if (left > 0) return `Status says paid but ${left} instalment${left > 1 ? 's are' : ' is'} (${zar(l.instalmentAmount * left)}) still open. Correct the loan before issuing.`
  return null
}

export const isFullyPaid = (l: Loan) => paidUpBlocker(l) === null

/** Refs that already have a paid-up letter in the logbook. */
export function lettersIssued(book: Book): Set<string> {
  return new Set(book.logbook.filter((g) => g.type === PAID_UP_LOG_TYPE).map((g) => g.ref))
}

export interface PaidUpAccount {
  loanId: string
  /** Account reference printed on the letter: the DebiCheck mandate, else the book ref */
  accountRef: string
  loanRef: string
  paidCount: number
  totalCount: number
  /** Collection dates, earliest first */
  paymentDates: string[]
  /** Instalments collected before this schedule (bank-report loans picked up mid-way) */
  earlierPayments: number
  /** What the client paid, debit-order fee included */
  totalPaid: number
}

export interface PaidUpLetter {
  issued: string
  client: Client
  accounts: PaidUpAccount[]
  total: number
  /** Every account was collected by DebiCheck mandate */
  debiCheck: boolean
  bank: string | null
  signatory: { name: string; title: string }
}

export function paidUpAccount(l: Loan): PaidUpAccount {
  const settledOn = (l.statusAt ?? '').slice(0, 10) || l.schedule[l.schedule.length - 1]
  // Actual collection dates where recorded; otherwise the scheduled date, capped at the settlement date
  const dates = [...new Set(l.schedule.slice(0, l.instalmentsPaid).map((d, i) => l.paidDates?.[i] || (settledOn && d > settledOn ? settledOn : d)))].sort()
  const paidCount = l.priorInstalments + l.instalmentsPaid
  return {
    loanId: l.id,
    accountRef: l.contractRef || l.mandateId || l.ref,
    loanRef: l.ref,
    paidCount,
    totalCount: l.priorInstalments + l.schedule.length,
    paymentDates: dates,
    earlierPayments: l.priorInstalments,
    totalPaid: round2(debitAmount(l) * paidCount),
  }
}

export const SIGNATORY_TITLE: Record<Role, string> = {
  admin: 'Director',
  manager: 'Branch Manager',
  agent: 'Loan Agent',
  collections: 'Collections Officer',
  auditor: 'Compliance Officer',
}

export function paidUpLetter(loans: Loan[], client: Client, signatory: { name: string; title: string }, today = todayIso()): PaidUpLetter {
  const ok = loans.filter(isFullyPaid)
  if (!ok.length) throw new Error('No fully paid account to certify')
  const accounts = ok.map(paidUpAccount).sort((a, b) => (a.paymentDates[0] ?? '').localeCompare(b.paymentDates[0] ?? ''))
  return {
    issued: today,
    client,
    accounts,
    total: round2(accounts.reduce((s, a) => s + a.totalPaid, 0)),
    debiCheck: ok.every((l) => !!l.mandateId),
    bank: client.bank,
    signatory,
  }
}

// ───────────────────────────── Wording helpers ─────────────────────────────

/** "26 October 2026" */
export function longDate(iso: string): string {
  const d = parseDate(iso)
  if (!d) return '—'
  return `${d.getDate()} ${LONG_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "25 Sep & 23 Oct 2026"; the year is printed once when every date shares it. */
export function paymentDatesLabel(isos: string[], earlier = 0): string {
  const ds = isos.map((s) => parseDate(s)).filter((d): d is Date => !!d)
  const sameYear = ds.every((d) => d.getFullYear() === ds[0]?.getFullYear())
  const parts = ds.map((d, i) => `${d.getDate()} ${MONTH_NAMES[d.getMonth()]}${!sameYear || i === ds.length - 1 ? ` ${d.getFullYear()}` : ''}`)
  if (earlier) parts.unshift(`${earlier} earlier`)
  if (!parts.length) return '—'
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
}

/** "Phindile Dube" → "P. Dube"; names already in initials are kept. */
export function initialsName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return full.trim()
  const last = parts.pop()!
  const initials = parts.flatMap((p) => p.split('.').filter(Boolean)).map((p) => `${p[0].toUpperCase()}.`)
  return `${initials.join(' ')} ${last}`
}

/** "751112 6083 186" */
export function idGrouped(id: string | null | undefined): string {
  const d = (id ?? '').replace(/\D/g, '')
  return d.length === 13 ? `${d.slice(0, 6)} ${d.slice(6, 10)} ${d.slice(10)}` : d || '—'
}

/** "First National Bank (FNB)" → "FNB" */
export function bankShort(bank: string | null | undefined): string | null {
  if (!bank) return null
  const m = /\(([^)]+)\)/.exec(bank)
  return (m ? m[1] : bank).trim() || null
}

/** "R7 156.36" — the letter's money style: no space after R, always cents. */
export function letterMoney(n: number): string {
  const [i, d] = Math.abs(round2(n)).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}R${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${d}`
}
