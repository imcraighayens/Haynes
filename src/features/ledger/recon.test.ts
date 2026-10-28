import { describe, expect, it } from 'vitest'
import { analyse, applyRecon, brIso, cleanReference, gridToRows, outcomeOf, parseDelimited, readXlsxSheets } from './recon'
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

// ── Multi-tab .xlsx (NuPay puts "Success" and "At Issuer" on separate tabs) ──

/** Build an uncompressed (stored) zip — enough for readXlsxSheets in tests. */
function storedZip(files: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder()
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), data = enc.encode(text), c = crc(data)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, c, true)
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, n.length, true)
    const local = new Uint8Array([...new Uint8Array(lh.buffer), ...n, ...data])
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, c, true)
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, n.length, true); ch.setUint32(42, offset, true)
    centrals.push(new Uint8Array([...new Uint8Array(ch.buffer), ...n]))
    locals.push(local)
    offset += local.length
  }
  const cdSize = centrals.reduce((s, x) => s + x.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, centrals.length, true); end.setUint16(10, centrals.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  const all = new Uint8Array([...locals.flatMap((x) => [...x]), ...centrals.flatMap((x) => [...x]), ...new Uint8Array(end.buffer)])
  return all.buffer
}

const cell = (ref: string, v: string | number) =>
  typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`
const sheetXml = (rows: (string | number)[][]) =>
  `<worksheet><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(String.fromCharCode(65 + j) + (i + 1), v)).join('')}</row>`).join('')}</sheetData></worksheet>`

const HEAD = ['Mandate ID', 'Debtor ID', 'Instalment Amount', 'Status', 'Client Reference', 'Date of First Instalment', 'Instalment', 'Cycle Date', 'Total Instalments', 'PIF Value', 'Original Amount']

function twoTabWorkbook() {
  return storedZip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Success" sheetId="1" r:id="rId1"/><sheet name="At Issuer" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheetXml([
      HEAD,
      ['90000001', '0000000000011', 2760.31, 'Success', 'EcoloansA Demo', '2026-09-25', 2, '2026-10-25', 2, 60.31, 2700],
      ['90000002', '0000000000011', 1380.15, 'Success', 'EcoloansA Demo', '2026-10-23', 1, '2026-10-23', 1, 30.15, 1350],
      ['90000003', '0000000000022', 1932.22, 'Success', 'ECOLOANS-B.Sample', '2026-05-29', 6, '2026-10-29', 6, 42.22, 1890],
      ['', '', 6072.68, '', '', '', '', '', '', 132.68, 5940],
    ]),
    'xl/worksheets/sheet2.xml': sheetXml([HEAD, ['90000004', '0000000000011', 4140.47, 'At Issuer', 'EcoloansA Demo', '2026-09-23', 2, '2026-10-24', 2, 90.47, 4050]]),
  })
}

describe('NuPay .xlsx workbooks', () => {
  it('reads every tab in workbook order, with tab names', async () => {
    const sheets = await readXlsxSheets(twoTabWorkbook())
    expect(sheets.map((s) => s.name)).toEqual(['Success', 'At Issuer'])
    expect(sheets[0].grid[1][0]).toBe('90000001')
    expect(sheets[1].grid[1][3]).toBe('At Issuer')
  })

  it('cleans client references', () => {
    expect(cleanReference('EcoloansP Dube')).toBe('P Dube')
    expect(cleanReference('ECOLOANS-K.Moatshe')).toBe('K. Moatshe')
    expect(cleanReference('EcoloansNkele Moagi')).toBe('Nkele Moagi')
  })

  it('imports a multi-tab report without duplicating a client who has several mandates', async () => {
    const raw = (await readXlsxSheets(twoTabWorkbook())).flatMap((s) => gridToRows(s.grid, s.name === 'At Issuer' ? 'In Tracking' : 'Success'))
    expect(raw).toHaveLength(4) // totals row dropped
    const base = { ...buildSeed('2026-10-26'), logbook: [], bankTx: [] }
    const rows = analyse(raw, base)
    expect(rows.map((r) => [r.kind, r.outcome])).toEqual([['new', 'paid'], ['new', 'paid'], ['new', 'paid'], ['new', 'pending']])
    const { book, counts } = applyRecon(base, rows, 'report.xlsx', { name: 'Tester' })
    expect(counts).toMatchObject({ new: 4, clients: 2 })
    const demo = book.clients.filter((c) => c.idNumber === '0000000000011')
    expect(demo).toHaveLength(1)
    expect(demo[0].name).toBe('A Demo')
    const theirs = book.loans.filter((l) => l.clientId === demo[0].id)
    expect(theirs.map((l) => l.mandateId).sort()).toEqual(['90000001', '90000002', '90000004'])
    const six = book.loans.find((l) => l.mandateId === '90000003')!
    expect(six).toMatchObject({ status: 'paid', instalmentAmount: 1890, collectionFee: 42.22 })
    const pending = book.loans.find((l) => l.mandateId === '90000004')!
    expect(pending).toMatchObject({ status: 'issued', instalmentsPaid: 1 })
  })
})

describe('NuPay preview wording', () => {
  it('marks later rows for the same new debtor as sharing the client', async () => {
    const raw = (await readXlsxSheets(twoTabWorkbook())).flatMap((s) => gridToRows(s.grid))
    const rows = analyse(raw, { ...buildSeed('2026-10-26') })
    expect(rows.map((r) => !!r.sharedClient)).toEqual([false, true, false, true])
  })
})
