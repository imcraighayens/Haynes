import { describe, expect, it } from 'vitest'
import { blankLoan, blankClient } from './factories'
import {
  buildSchedule, collectionCalendar, collectionsByMonth, effectiveStatus, expectedReturn, instalmentFor, instalmentNo,
  isStale, kpis, nextLoanRef, nextClientRef, normalizeLoan, notifications, outstanding, principalOf, tabTotals, totalReturn,
} from './loans'
import { assessAffordability } from './affordability'
import { addBusinessDays, addMonths, dateLabel, parseDate, parseMoney, toIso, zar } from './format'
import { settlementData, verifyCode } from './settlement'
import { importPrototypeBook } from './importPrototype'
import { buildSeed } from './seed'
import { bankPosition } from './bank'
import * as ops from '../store/ops'
import { DEFAULT_SETTINGS } from './factories'
import type { Book } from './types'

const T = '2026-10-25'
const actor = { name: 'Tester' }

describe('format', () => {
  it('formats rand with space thousands and cents only when needed', () => {
    expect(zar(14000)).toBe('R 14 000')
    expect(zar(4962.96)).toBe('R 4 962.96')
    expect(zar(-250)).toBe('−R 250')
    expect(zar(null)).toBe('—')
  })
  it('parses prototype date labels and ISO', () => {
    expect(toIso('23 Oct 2026')).toBe('2026-10-23')
    expect(toIso('2026-10-23T08:00:00Z')).toBe('2026-10-23')
    expect(toIso('5/11/2026')).toBe('2026-11-05')
    expect(dateLabel('2026-09-03')).toBe('03 Sep 2026')
    expect(parseDate('—')).toBeNull()
  })
  it('parses money strings', () => {
    expect(parseMoney('R 4 500,50')).toBe(4500.5)
    expect(parseMoney('12,000')).toBe(12000)
  })
  it('adds months clamping to month end, and business days', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addBusinessDays('2026-10-23', 5)).toBe('2026-10-30') // Fri + 5 business days
  })
})

describe('loan math', () => {
  const loan = (p: Partial<Parameters<typeof blankLoan>[0]> = {}) =>
    normalizeLoan(blankLoan({ principal: 3000, returnRatePct: 35, instalmentAmount: instalmentFor(3000, 35, 2), schedule: buildSchedule('2026-10-23', 2), ...p }))

  it('splits a simple 35% return evenly across instalments', () => {
    expect(instalmentFor(3000, 35, 1)).toBe(4050)
    expect(instalmentFor(3000, 35, 2)).toBe(2025)
    const l = loan()
    expect(totalReturn(l)).toBe(4050)
    expect(outstanding(l)).toBe(4050)
  })

  it('derives status from schedule and today', () => {
    expect(effectiveStatus(loan({ schedule: ['2026-10-30'] }), T)).toBe('issued')
    expect(effectiveStatus(loan({ schedule: [T] }), T)).toBe('duetoday')
    expect(effectiveStatus(loan({ schedule: ['2026-10-01'] }), T)).toBe('overdue')
    expect(effectiveStatus(loan({ schedule: ['2026-10-01'], instalmentsPaid: 1 }), T)).toBe('paid')
    expect(effectiveStatus(loan({ status: 'written_off' }), T)).toBe('written_off')
  })

  it('flags loans whose due date passed without an update as stale', () => {
    const l = loan({ schedule: ['2026-10-20'], statusAt: '2026-09-20T09:00:00Z' })
    expect(isStale(l, T)).toBe(true)
    expect(isStale({ ...l, statusAt: '2026-10-21T09:00:00Z' }, T)).toBe(false)
    expect(isStale({ ...l, status: 'overdue' }, T)).toBe(false)
  })

  it('normalises: completing every instalment marks paid; reopening clears paid', () => {
    expect(normalizeLoan({ ...loan(), instalmentsPaid: 2 }).status).toBe('paid')
    expect(normalizeLoan({ ...loan(), status: 'paid', instalmentsPaid: 1 }).status).toBe('issued')
  })

  it('back-calculates principal when not recorded (bank-report loans)', () => {
    const l = blankLoan({ principal: null, principalDerived: true, instalmentAmount: 4050, schedule: ['2026-11-01'] })
    expect(principalOf(l)).toBe(3000)
  })

  it('numbers instalments including ones before the schedule', () => {
    const l = loan({ priorInstalments: 2, instalmentsPaid: 1 })
    expect(instalmentNo(l)).toEqual({ no: 4, total: 4 })
  })

  it('refs increment and ignore bank-report refs', () => {
    expect(nextLoanRef([blankLoan({ ref: 'ECL-094' }), blankLoan({ ref: 'ECL-F07' })])).toBe('ECL-095')
    expect(nextClientRef([blankClient({ ref: 'EC-039' }), blankClient({ ref: 'EC-09' })])).toBe('EC-040')
  })
})

describe('book aggregates', () => {
  const clients = [blankClient({ id: 'a', name: 'A' }), blankClient({ id: 'b', name: 'B', blocked: true })]
  const loans = [
    normalizeLoan(blankLoan({ id: 'x', clientId: 'a', principal: 1000, instalmentAmount: 1350, schedule: ['2026-10-10'], issuedOn: '2026-10-01', statusAt: '2026-09-30T00:00:00Z' })),
    normalizeLoan(blankLoan({ id: 'y', clientId: 'a', principal: 2000, instalmentAmount: 1350, schedule: buildSchedule('2026-11-05', 2), issuedOn: '2026-10-05' })),
    normalizeLoan(blankLoan({ id: 'z', clientId: 'b', principal: 500, instalmentAmount: 675, schedule: ['2026-09-01'], instalmentsPaid: 1, issuedOn: '2026-08-01' })),
  ]
  it('computes KPIs', () => {
    const k = kpis({ clients, loans }, T)
    expect(k.loanedOutThisMonth).toBe(3000)
    expect(k.collectionOutstanding).toBe(1350 + 2700)
    expect(k.activeClients).toBe(1)
    expect(k.overdueAccounts).toBe(1)
    expect(k.overdueAmount).toBe(1350)
    expect(k.notUpdated).toBe(1)
  })
  it('totals status tabs', () => {
    const t = tabTotals(loans, T)
    expect(t.overdue).toEqual({ count: 1, amount: 1350 })
    expect(t.issued).toEqual({ count: 1, amount: 2700 })
    expect(t.paid).toEqual({ count: 1, amount: 675 })
    expect(t.all.count).toBe(3)
  })
  it('builds the collection calendar and monthly buckets from unpaid instalments only', () => {
    const cal = collectionCalendar(loans)
    expect(cal.get('2026-11-05')).toEqual({ count: 1, amount: 1350 })
    expect(cal.has('2026-09-01')).toBe(false)
    expect(collectionsByMonth(loans).map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12'])
  })
  it('splits expected return into principal and interest', () => {
    const e = expectedReturn(loans)
    expect(e.total).toBe(4050)
    expect(e.principal).toBe(3000)
    expect(e.interest).toBe(1050)
  })
  it('lists stale loans first in notifications', () => {
    const n = notifications([...loans, normalizeLoan(blankLoan({ id: 't', clientId: 'a', instalmentAmount: 100, schedule: [T] }))], T)
    expect(n.map((x) => [x.loan.id, x.kind])).toEqual([['x', 'stale'], ['t', 'today']])
  })
})

describe('affordability (prototype rule)', () => {
  const f = (n: number) => zar(n)
  it('approves within limits', () => {
    const r = assessAffordability({ netSalary: 20000, obligations: 6000, amount: 3000, termMonths: 1, ratePct: 35 }, f)
    expect(r.repayment).toBe(4050)
    expect(r.verdict).toBe('APPROVE')
  })
  it('refers borderline DTI', () => {
    expect(assessAffordability({ netSalary: 10000, obligations: 4000, amount: 1500, termMonths: 1, ratePct: 35 }, f).verdict).toBe('REFER')
  })
  it('declines when repayment exceeds disposable income and suggests a max', () => {
    const r = assessAffordability({ netSalary: 8000, obligations: 6000, amount: 5000, termMonths: 1, ratePct: 35 }, f)
    expect(r.verdict).toBe('DECLINE')
    expect(r.maxLoan).toBe(1500)
  })
  it('asks for income first', () => {
    expect(assessAffordability({ netSalary: 0, obligations: 0, amount: 100, termMonths: 1, ratePct: 35 }, f).verdict).toBe('NO INCOME')
  })
})

describe('ops keep the audit trail and bank in step', () => {
  const base = (): Book => ({ ...buildSeed(T), logbook: [], bankTx: [] })
  it('issuing a loan logs it and moves principal out of the bank', () => {
    const b = base()
    const l = blankLoan({ ref: 'ECL-999', clientId: 'c1', principal: 2000, instalmentAmount: 2700, schedule: ['2026-11-25'] })
    const nb = ops.issueLoan(b, l, actor)
    expect(nb.loans.at(-1)!.ref).toBe('ECL-999')
    expect(nb.logbook[0].type).toBe('LOAN ISSUED')
    expect(nb.bankTx[0]).toMatchObject({ type: 'out', amount: 2000 })
  })
  it('recording the last instalment marks the loan paid and banks the collection', () => {
    const b = base()
    const open = b.loans.find((l) => l.schedule.length === 3 && l.instalmentsPaid === 2)!
    const nb = ops.recordPayment(b, open.id, 1, actor)
    const after = nb.loans.find((l) => l.id === open.id)!
    expect(after.status).toBe('paid')
    expect(nb.bankTx[0]).toMatchObject({ type: 'in', amount: open.instalmentAmount })
    expect(nb.logbook.map((g) => g.type)).toEqual(['STATUS → PAID', 'PAYMENT RECEIVED']) // newest first
  })
  it('un-marking a paid loan reverses one instalment', () => {
    const b = base()
    const paid = b.loans.find((l) => l.status === 'paid')!
    const nb = ops.setLoanStatus(b, paid.id, 'issued', actor)
    expect(nb.loans.find((l) => l.id === paid.id)!.instalmentsPaid).toBe(paid.schedule.length - 1)
    expect(nb.bankTx[0].type).toBe('out')
  })
  it('archiving is a soft delete and cascades to loans', () => {
    const b = base()
    const nb = ops.archiveClient(b, 'c1', actor, 'duplicate')
    expect(nb.clients.find((c) => c.id === 'c1')!.deletedAt).toBeTruthy()
    expect(nb.loans.filter((l) => l.clientId === 'c1').every((l) => l.deletedAt)).toBe(true)
    expect(nb.clients.length).toBe(b.clients.length)
  })
  it('bank position = opening balance + later movements', () => {
    let b = base()
    b = ops.setBankBalance(b, 10000, actor)
    expect(bankPosition(b)).toMatchObject({ balance: 10000, derived: false })
  })
})

describe('settlement letters', () => {
  it('produces a stable verify code and a 5-business-day expiry', () => {
    expect(verifyCode('ECL-094')).toBe(verifyCode('ECL-094'))
    expect(verifyCode('ECL-094')).toMatch(/^VC-0094-[0-9A-Z]{1,5}$/)
    const c = blankClient({ name: 'A', bank: 'Capitec' })
    const l = normalizeLoan(blankLoan({ ref: 'ECL-094', instalmentAmount: 1000, schedule: buildSchedule('2026-11-01', 3), instalmentsPaid: 1 }))
    const s = settlementData(l, c, DEFAULT_SETTINGS, '2026-10-23')
    expect(s.title).toBe('SETTLEMENT QUOTATION')
    expect(s.subtotal).toBe(2000)
    expect(s.total).toBe(2000 + DEFAULT_SETTINGS.protectionFee)
    expect(s.expires).toBe('2026-10-30')
  })
})

describe('prototype import', () => {
  it('maps prototype clients, manual loans and bank-report loans', () => {
    const proto = {
      clients: [{ id: 'c1', ref: 'EC-001', name: 'Test Person', idFull: '—', added: '15 Jul 2025', bank: 'Capitec Bank', account: '000123', employee: 'Craig Moatshe', contract: { no: 'MC-0031', signedOn: '15 Jul 2025', sig: null } }],
      loans: [
        { id: 'l1', ref: 'ECL-094', clientId: 'c1', amount: 2000, ret: 35, status: 'issued', due: '25 Nov 2026', purpose: 'Personal' },
        { id: 'l2', ref: 'ECL-F09', clientId: 'c1', amount: 4666, retAmt: 4770.23, status: 'issued', sched: ['23 Sep 2026', '23 Oct 2026'], paidInst: 1, mandate: '12345', due: '23 Oct 2026' },
        { id: 'l3', ref: 'ECL-090', clientId: 'c1', amount: 1000, ret: 35, status: 'paid', due: '15 Jun 2026' },
      ],
      employees: [{ id: 'e1', name: 'Craig Moatshe', email: 'c@x', role: 'Admin', status: 'ACTIVE' }],
      logbook: [{ ref: 'ECL-094', customer: 'Test Person', amount: 2000, type: 'LOAN ADDED', date: '20 OCT 2026', by: 'Craig', comment: '' }],
      statusAt: { l1: 1761200000000 },
    }
    const { book, warnings } = importPrototypeBook(JSON.stringify(proto), buildSeed(T))
    expect(warnings).toEqual([])
    const [c] = book.clients
    expect(c.idNumber).toBeNull()
    expect(c.officerId).toBe('e1')
    const [l1, l2, l3] = book.loans
    expect(l1).toMatchObject({ principal: 2000, instalmentAmount: 2700, schedule: ['2026-11-25'], collectionFee: 0 })
    expect(l2).toMatchObject({ principal: null, principalDerived: true, instalmentAmount: 4666, collectionFee: 104.23, instalmentsPaid: 1, mandateId: '12345' })
    expect(l3.status).toBe('paid')
    expect(book.logbook[0].type).toBe('BOOK IMPORTED')
    expect(book.logbook[1].at.slice(0, 10)).toBe('2026-10-20')
  })
  it('rejects non-book JSON', () => {
    expect(() => importPrototypeBook('{"a":1}', buildSeed(T))).toThrow(/prototype book/)
  })
})

describe('synthetic seed', () => {
  it('contains no real-looking SA ID numbers or bank accounts', () => {
    const b = buildSeed(T)
    for (const c of b.clients) {
      expect(c.idNumber?.startsWith('000000')).toBe(true)
      expect(c.accountNo?.startsWith('0000')).toBe(true)
    }
  })
  it('has something due today, something stale and something upcoming', () => {
    const b = buildSeed(T)
    const n = notifications(b.loans, T)
    expect(n.some((x) => x.kind === 'today')).toBe(true)
    expect(n.some((x) => x.kind === 'stale')).toBe(true)
  })
})
