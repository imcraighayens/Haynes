import { describe, expect, it } from 'vitest'
import { blankClient, blankLoan, DEFAULT_SETTINGS } from './factories'
import { buildSchedule, normalizeLoan } from './loans'
import { bankShort, idGrouped, initialsName, isFullyPaid, letterMoney, longDate, paidUpBlocker, paidUpLetter, paymentDatesLabel } from './paidUp'
import { paidUpHtml } from '../features/loans/PaidUpLetter'
import * as ops from '../store/ops'
import type { Book } from './types'

const actor = { name: 'Tester' }
// Synthetic borrower: ID starts 000000 (no valid birth date)
const client = blankClient({ id: 'c1', ref: 'EC-01', name: 'Palesa Test', idNumber: '0000005000086', bank: 'First National Bank (FNB)' })
const loan = (id: string, n: number, patch = {}) =>
  normalizeLoan(blankLoan({ id, ref: `ECL-${id}`, clientId: 'c1', instalmentAmount: 3474, collectionFee: 104.18, schedule: buildSchedule('2026-09-25', n), mandateId: '7770001', contractRef: `DCPRD000${id}`, ...patch }))
const book = (...loans: ReturnType<typeof loan>[]): Book => ({ clients: [client], loans, applications: [], logbook: [], petty: [], expenses: [], bankTx: [], employees: [], settings: DEFAULT_SETTINGS })

describe('paid-up letter gate', () => {
  it('blocks open, written-off and status-not-set accounts', () => {
    expect(paidUpBlocker(loan('A', 2, { instalmentsPaid: 1 }))).toMatch(/not fully paid: 1 of 2/)
    expect(paidUpBlocker(loan('A', 1, { status: 'written_off' }))).toMatch(/written off/)
    // all collected but stored status left as issued (bypassing normalizeLoan)
    expect(paidUpBlocker({ ...loan('A', 1), instalmentsPaid: 1 })).toMatch(/never set to Paid/)
    expect(paidUpBlocker({ ...loan('A', 2), status: 'paid', instalmentsPaid: 1 })).toMatch(/still open/)
    expect(() => paidUpLetter([loan('A', 2)], client, { name: 'x', title: '' })).toThrow()
  })

  it('certifies a loan paid through recorded debits, with the actual debit dates', () => {
    let b = book(loan('A', 2))
    b = ops.recordPayment(b, 'A', 1, actor, '', '2026-09-25')
    b = ops.recordPayment(b, 'A', 1, actor, '', '2026-10-23')
    const l = b.loans[0]
    expect(l.status).toBe('paid')
    expect(isFullyPaid(l)).toBe(true)
    const L = paidUpLetter([l], client, { name: 'Agent', title: 'Loan Agent' }, '2026-10-26')
    expect(L.accounts[0]).toMatchObject({ accountRef: 'DCPRD000A', paidCount: 2, totalCount: 2, totalPaid: 7156.36 })
    expect(paymentDatesLabel(L.accounts[0].paymentDates)).toBe('25 Sep & 23 Oct 2026')
  })

  it('keeps paid dates aligned when a paid loan is re-opened', () => {
    let b = book(loan('A', 2))
    b = ops.setLoanStatus(b, 'A', 'paid', actor)
    expect(b.loans[0].paidDates).toHaveLength(2)
    b = ops.setLoanStatus(b, 'A', 'issued', actor)
    expect(b.loans[0].paidDates).toHaveLength(1)
    expect(isFullyPaid(b.loans[0])).toBe(false)
  })
})

describe('paid-up letter wording', () => {
  it('formats names, IDs, dates, banks and money like the template', () => {
    expect(initialsName('Palesa Test')).toBe('P. Test')
    expect(initialsName('K. Moatshe')).toBe('K. Moatshe')
    expect(initialsName('Kagiso Thabo Molefe')).toBe('K. T. Molefe')
    expect(idGrouped('0000005000086')).toBe('000000 5000 086')
    expect(longDate('2026-10-26')).toBe('26 October 2026')
    expect(paymentDatesLabel(['2026-10-23'])).toBe('23 Oct 2026')
    expect(paymentDatesLabel(['2025-12-23', '2026-01-23'])).toBe('23 Dec 2025 & 23 Jan 2026')
    expect(paymentDatesLabel(['2026-10-23'], 3)).toBe('3 earlier & 23 Oct 2026')
    expect(bankShort('First National Bank (FNB)')).toBe('FNB')
    expect(bankShort('Capitec Bank')).toBe('Capitec Bank')
    expect(letterMoney(15437.3)).toBe('R15 437.30')
    expect(letterMoney(0)).toBe('R0.00')
  })

  it('renders one or several accounts with matching grammar and escapes text', () => {
    const paid = (id: string) => ({ ...loan(id, 1), status: 'paid' as const, instalmentsPaid: 1, paidDates: ['2026-10-23'] })
    const one = paidUpHtml(paidUpLetter([paid('A')], client, { name: 'A <b>', title: 'Loan Agent' }, '2026-10-26'), DEFAULT_SETTINGS, '000000 5000 086')
    expect(one).toContain('the account is closed')
    expect(one).toContain('Section 71A')
    expect(one).toContain('A &lt;b&gt;')
    expect(one).toContain("client's FNB account")
    const two = paidUpHtml(paidUpLetter([paid('A'), paid('B')], client, { name: 'x', title: '' }, '2026-10-26'), DEFAULT_SETTINGS, '—')
    expect(two).toContain('both accounts are closed')
    expect(two).toContain('mandates linked to these accounts have')
  })
})
