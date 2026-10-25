import { describe, expect, it } from 'vitest'
import { analyse, applyRecon, brIso, gridToRows, outcomeOf, parseDelimited } from './recon'
import { buildSeed } from '../../domain/seed'
import { addMonths } from '../../domain/format'

const T = '2026-10-25'
const actor = { name: 'Tester' }

/** Seed loan ECL-F01: mandate 0000771234, 6 instalments from T-31, 1 paid, R4 666 + R104.23 fee. */
function report(book = buildSeed(T)) {
  const f01 = book.loans.find((l) => l.ref === 'ECL-F01')!
  const inst2 = f01.schedule[1]
  const csv = [
    'NuPay Transaction Report,,,,,,,,,,',
    'Mandate ID,Debtor ID,Client Reference,Instalment,Total Instalments,Instalment Amount,Original Amount,PIF Value,Cycle Date,Date of First Instalment,Status',
    'Success',
    `0000771234,,Ecoloans Pule Sekgobela,2,6,4770.23,4666,104.23,${inst2},${f01.schedule[0]},`,
    `"0000999001",0000000000001,"Ecoloans New Person, Jr",1,3,1400.00,1350.00,50.00,${T},${T},Successful`,
    'Failed',
    `0000999002,0000000000002,Ecoloans Other Person,2,2,700,675,25,${T},${addMonths(T, -1)},Insufficient funds`,
    'In Tracking',
    `0000771234,,Ecoloans Pule Sekgobela,3,6,4770.23,4666,104.23,${f01.schedule[2]},${f01.schedule[0]},At issuer`,
  ].join('\n')
  return { book, f01, csv }
}

describe('NuPay report parsing', () => {
  it('sniffs delimiters and honours quotes', () => {
    expect(parseDelimited('a;b;c\n1;"x;y";3')).toEqual([['a', 'b', 'c'], ['1', 'x;y', '3']])
    expect(parseDelimited('a\tb\tc\n1\t2\t3')[1]).toEqual(['1', '2', '3'])
    expect(parseDelimited('a,"he said ""hi""",c')[0][1]).toBe('he said "hi"')
  })
  it('finds the header, skips preamble and tags section rows', () => {
    const rows = gridToRows(parseDelimited(report().csv))
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ 'mandate id': '0000771234', status: 'Success', _section: 'Success' })
    expect(rows[2]._section).toBe('Failed')
    expect(rows[3].status).toBe('At issuer')
  })
  it('rejects files without a Mandate ID column', () => {
    expect(() => gridToRows([['a', 'b']])).toThrow(/Mandate ID/)
  })
  it('converts excel serials and ISO dates', () => {
    expect(brIso('45953')).toBe('2025-10-23')
    expect(brIso('2026-10-23 00:00')).toBe('2026-10-23')
    expect(brIso('23/10/2026')).toBe('2026-10-23')
    expect(brIso('')).toBe('')
  })
  it('classifies bank outcomes', () => {
    expect(outcomeOf('', 'Success')).toBe('paid')
    expect(outcomeOf('At issuer', '')).toBe('pending')
    expect(outcomeOf('Insufficient funds', 'Failed')).toBe('unpaid')
  })
})

describe('NuPay analyse + apply', () => {
  it('maps each row to new / paid / unpaid / skip', () => {
    const { book, csv } = report()
    const rows = analyse(gridToRows(parseDelimited(csv)), book)
    expect(rows.map((r) => r.kind)).toEqual(['paid', 'new', 'new', 'skip'])
    expect(rows[0]).toMatchObject({ ref: 'ECL-F01', idx: 1, warn: '' })
    expect(rows[0].action).toMatch(/Mark inst 2\/6 paid/)
    expect(rows[1].clientName).toBe('New Person, Jr')
    expect(rows[3].action).toMatch(/Pending/)
  })
  it('warns when report amounts differ from the book', () => {
    const { book, csv } = report()
    const rows = analyse(gridToRows(parseDelimited(csv.replace('4770.23,4666,104.23,', '4800,4700,100,'))), book)
    expect(rows[0].warn).toMatch(/≠ book/)
  })
  it('skips instalments that are already paid', () => {
    const { book, f01, csv } = report()
    const rows = analyse(gridToRows(parseDelimited(csv.replace(`,2,6,4770.23,4666,104.23,${f01.schedule[1]}`, `,1,6,4770.23,4666,104.23,${f01.schedule[0]}`))), book)
    expect(rows[0]).toMatchObject({ kind: 'skip', on: false })
  })
  it('applies paid, new and unpaid rows as one audited change', () => {
    const { book, f01, csv } = report()
    const rows = analyse(gridToRows(parseDelimited(csv)), book)
    const { book: nb, counts } = applyRecon(book, rows, 'report.csv', actor)
    expect(counts).toEqual({ paid: 1, unpaid: 0, new: 2, clients: 2 })
    expect(nb.loans.find((l) => l.id === f01.id)!.instalmentsPaid).toBe(2)
    const added = nb.loans.filter((l) => l.mandateId === '0000999001' || l.mandateId === '0000999002')
    expect(added.map((l) => l.ref)).toEqual(['ECL-F02', 'ECL-F03'])
    expect(added[0]).toMatchObject({ principal: null, principalDerived: true, instalmentAmount: 1350, collectionFee: 50, instalmentsPaid: 1, status: 'issued' })
    expect(added[0].schedule).toHaveLength(3)
    expect(added[1]).toMatchObject({ instalmentsPaid: 1, status: 'overdue' })
    expect(nb.clients.length).toBe(book.clients.length + 2)
    expect(nb.logbook[0].type).toBe('BANK REPORT IMPORTED')
    // collections reach the bank: F01 instalment + new loan's first instalment
    expect(nb.bankTx.filter((t) => t.type === 'in').map((t) => t.amount).sort()).toEqual([1350, 4666])
    expect(nb.bankTx.some((t) => t.type === 'out')).toBe(false)
  })
})
