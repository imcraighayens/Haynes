/**
 * NuPay debit-order report import — pure functions, ported from the
 * prototype's brRead / brAnalyse / brApply.
 *
 * Flow: file → grid (CSV/TSV/XLSX) → raw rows keyed by lower-case header →
 * analyse against the book (one ReconRow per transaction) → apply the rows the
 * user left switched on, as one audited change to the book.
 */
import type { Book } from '../../domain/types'
import { blankClient, blankLoan } from '../../domain/factories'
import { dateLabel, round2, zar } from '../../domain/format'
import { buildSchedule, debitAmount, instalmentNo, nextBankLoanRef, nextClientRef } from '../../domain/loans'
import * as ops from '../../store/ops'

export type RawRow = Record<string, string> & { _section: string }

export type Outcome = 'paid' | 'pending' | 'unpaid'
export type ReconKind = 'new' | 'paid' | 'unpaid' | 'skip'

export interface ReconRow {
  key: string
  mid: string
  idno: string
  res: string
  outcome: Outcome
  /** Instalment number on the report (1-based) */
  K: number
  /** Total instalments on the report */
  V: number
  /** Debit amount (incl. collection fee) */
  deb: number
  /** Original amount = return per instalment */
  orig: number
  pif: number
  cycle: string
  first: string
  nameRaw: string
  clientId: string | null
  clientName: string
  loanId?: string
  ref?: string
  /** Schedule index this transaction maps to */
  idx?: number
  dueLbl?: string
  kind: ReconKind
  action: string
  warn: string
  on: boolean
}

// ───────────────────────────── Reading files ─────────────────────────────

const xmlDecode = (s: string) =>
  String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** Split delimited text into a grid. Sniffs tab / semicolon / comma and honours quotes. */
export function parseDelimited(txt: string): string[][] {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter((x) => x.trim())
  const first = lines[0] ?? ''
  const count = (re: RegExp) => (first.match(re) || []).length
  const d = count(/\t/g) > 1 ? '\t' : count(/;/g) > count(/,/g) ? ';' : ','
  return lines.map((line) => {
    const a: string[] = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = !q
      } else if (ch === d && !q) {
        a.push(cur)
        cur = ''
      } else cur += ch
    }
    a.push(cur)
    return a
  })
}

/** Minimal .xlsx reader: unzips sharedStrings + sheet1 and builds a grid. */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const u = new Uint8Array(buf), dv = new DataView(buf), files: Record<string, string> = {}
  let e = u.length - 22
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--
  if (e < 0) throw new Error('Not a valid .xlsx file')
  const cnt = dv.getUint16(e + 10, true)
  let p = dv.getUint32(e + 16, true)
  for (let i = 0; i < cnt; i++) {
    const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true)
    const xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(u.slice(p + 46, p + 46 + nl))
    p += 46 + nl + xl + cl
    if (!/^xl\/(sharedStrings|worksheets\/sheet1)\.xml$/.test(name)) continue
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true)
    const raw = u.slice(ds, ds + cs)
    files[name] =
      method === 0
        ? new TextDecoder().decode(raw)
        : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
  }
  const ss = files['xl/sharedStrings.xml'] || '', sh = files['xl/worksheets/sheet1.xml'] || ''
  const strs = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => xmlDecode(x[1])).join(''))
  const col = (c: string) => c.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
  return [...sh.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const a: string[] = []
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/), is = (c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/)
      a[col(c[1])] = v ? (/t="s"/.test(c[2]) ? strs[+v[1]] : xmlDecode(v[1])) : is ? xmlDecode(is[1]) : ''
    }
    return Array.from(a, (x) => x ?? '')
  })
}

const sectionOf = (t: string) =>
  /^success/i.test(t) ? 'Success' : /^failed/i.test(t) ? 'Failed' : /tracking/i.test(t) ? 'In Tracking' : /^revers/i.test(t) ? 'Reversed' : /^cancel/i.test(t) ? 'Cancelled' : ''

/** Turn a report grid into transaction rows keyed by lower-case column header. */
export function gridToRows(grid: string[][]): RawRow[] {
  const hi = grid.findIndex((r) => (r || []).some((x) => /mandate\s*id/i.test(String(x || ''))))
  if (hi < 0) throw new Error('No "Mandate ID" column found — is this a NuPay transaction report?')
  let H = grid[hi].map((x) => String(x || '').trim().toLowerCase())
  let sec = ''
  const out: RawRow[] = []
  for (let ri = 0; ri < grid.length; ri++) {
    const cells = (grid[ri] || []).map((x) => String(x ?? '').trim())
    const filled = cells.filter(Boolean)
    if (filled.length === 1 && sectionOf(filled[0])) {
      sec = sectionOf(filled[0])
      continue
    }
    if (cells.some((x) => /^mandate\s*id$/i.test(x))) {
      H = cells.map((x) => x.toLowerCase())
      continue
    }
    if (ri <= hi) continue
    const o = { _section: sec } as RawRow
    H.forEach((k, i) => {
      if (k) o[k] = cells[i] || ''
    })
    if (!o['mandate id'] || !/\d/.test(o['mandate id'])) continue
    if (!o['status'] && sec) o['status'] = sec
    out.push(o)
  }
  return out
}

export async function readReport(file: File): Promise<RawRow[]> {
  const grid = /\.xlsx$/i.test(file.name) ? await readXlsx(await file.arrayBuffer()) : parseDelimited(await file.text())
  return gridToRows(grid)
}

/** Excel serial (45953) or any string containing YYYY-MM-DD → ISO date; else ''. */
export function brIso(v: string | undefined): string {
  const s = String(v || '').trim()
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((+s - 25569) * 864e5)).toISOString().slice(0, 10)
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[0]
  const dmy = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : ''
}

// ───────────────────────────── Analysis ─────────────────────────────

const num = (v: string | undefined) => parseFloat(String(v || '').replace(/[^\d.-]/g, '')) || 0

export function outcomeOf(res: string, section: string): Outcome {
  if (/^success/i.test(res) || section === 'Success' || /paid|processed|honou?red/i.test(res)) return 'paid'
  if (/at issuer|tracking|pending|submitted|loaded/i.test(res) || section === 'In Tracking') return 'pending'
  if (/fail|unpaid|reject|insuff|disput|revers|stop|return|cancel/i.test(res)) return 'unpaid'
  return 'pending'
}

export function analyse(raw: RawRow[], book: Pick<Book, 'loans' | 'clients'>): ReconRow[] {
  const loans = book.loans.filter((l) => !l.deletedAt)
  const clients = book.clients.filter((c) => !c.deletedAt)
  return raw.map((o, i) => {
    const mid = String(o['mandate id'] || '').trim()
    const idno = String(o['debtor id'] || '').trim()
    const res = o['status'] || ''
    const K = parseInt(o['instalment'], 10) || 1
    const V = parseInt(o['total instalments'], 10) || 1
    const deb = num(o['instalment amount']), orig = num(o['original amount']), pif = num(o['pif value'])
    const cycle = brIso(o['cycle date'] || o['action date'])
    const first = brIso(o['date of first instalment'])
    const outcome = outcomeOf(res, o._section)
    const l = loans.find((x) => String(x.mandateId || '') === mid)
    const cli = l ? clients.find((c) => c.id === l.clientId) : idno ? clients.find((c) => String(c.idNumber || '') === idno) : undefined
    const nameRaw = String(o['client reference'] || '').replace(/^ecoloans\s*/i, '').trim()
    const r: ReconRow = {
      key: `r${i}`, mid, idno, res, outcome, K, V, deb, orig, pif, cycle, first, nameRaw,
      clientId: cli?.id ?? null, clientName: cli?.name ?? (nameRaw || 'Unknown'),
      kind: 'skip', action: '', warn: '', on: true, dueLbl: cycle ? dateLabel(cycle) : undefined,
    }
    if (!l) {
      r.kind = 'new'
      r.action = `Not on the book · add as new loan (${V} instalment${V > 1 ? 's' : ''})${cli ? '' : ' + new client'}`
      if (!(r.first || r.cycle)) {
        r.kind = 'skip'
        r.on = false
        r.action = 'No dates on report row · cannot build a schedule'
      }
      return r
    }
    r.loanId = l.id
    r.ref = l.ref
    const ds = l.schedule
    let idx = K - 1 - l.priorInstalments
    if (idx < 0 || idx >= ds.length) idx = cycle ? ds.findIndex((d) => d === cycle) : -1
    r.idx = idx
    r.dueLbl = idx >= 0 ? dateLabel(ds[idx]) : dateLabel(cycle)
    const w: string[] = []
    if (orig && Math.abs(orig - l.instalmentAmount) > 0.009) w.push(`report return ${zar(orig)} ≠ book ${zar(l.instalmentAmount)}`)
    if (deb && Math.abs(deb - debitAmount(l)) > 0.009) w.push(`report debit ${zar(deb)} ≠ book ${zar(debitAmount(l))}`)
    r.warn = w.length ? `${w.join(' · ')} — book amounts kept` : ''
    const total = l.priorInstalments + ds.length
    if (idx < 0) {
      r.kind = 'skip'
      r.on = false
      r.action = `Instalment ${K} not found on schedule`
      return r
    }
    if (outcome === 'paid') {
      if (idx < l.instalmentsPaid || l.status === 'paid' || l.status === 'settled_early') {
        r.kind = 'skip'
        r.on = false
        r.action = `Inst ${K}/${total} already paid`
      } else {
        r.kind = 'paid'
        const extra = idx - l.instalmentsPaid
        r.action = `Mark inst ${K}/${total} paid${extra > 0 ? ` (and ${extra} earlier)` : ''}`
      }
    } else if (outcome === 'unpaid') {
      r.kind = 'unpaid'
      r.action = `Mark overdue · debit ${res.toLowerCase() || 'unpaid'}`
    } else {
      r.kind = 'skip'
      r.on = false
      r.action = 'Pending at bank · no change'
    }
    return r
  })
}

// ───────────────────────────── Apply ─────────────────────────────

export interface ApplyCounts {
  paid: number
  unpaid: number
  new: number
  clients: number
}

/** Apply the switched-on rows as audited ops. Pure: returns the new book. */
export function applyRecon(book: Book, rows: ReconRow[], file: string, actor: ops.Actor): { book: Book; counts: ApplyCounts } {
  const src = ` · bank report ${file}`
  const counts: ApplyCounts = { paid: 0, unpaid: 0, new: 0, clients: 0 }
  let b = book
  for (const r of rows.filter((x) => x.on && x.kind !== 'skip')) {
    if (r.kind === 'new') {
      let cid = r.clientId
      if (!cid) {
        const c = blankClient({ ref: nextClientRef(b.clients), name: r.nameRaw || 'Unknown', idNumber: r.idno || null, createdBy: actor.name })
        b = ops.addClient(b, c, actor)
        cid = c.id
        counts.clients++
      }
      const first = r.first || r.cycle
      const V = Math.max(1, r.V)
      const paidN = r.outcome === 'paid' ? Math.min(r.K, V) : Math.max(0, r.K - 1)
      const loan = blankLoan({
        ref: nextBankLoanRef(b.loans),
        clientId: cid,
        principal: null,
        principalDerived: true,
        instalmentAmount: r.orig,
        collectionFee: round2(Math.max(0, r.deb - r.orig)),
        schedule: buildSchedule(first, V),
        // the instalment collected in this report is booked through recordPayment so it reaches the bank
        instalmentsPaid: r.outcome === 'paid' ? paidN - 1 : paidN,
        status: r.outcome === 'unpaid' ? 'overdue' : 'issued',
        mandateId: r.mid,
        issuedOn: first,
        createdAt: `${first}T09:00:00.000Z`,
      })
      b = ops.issueLoan(b, loan, actor, `Mandate ${r.mid}${src}`)
      if (r.outcome === 'paid') b = ops.recordPayment(b, loan.id, 1, actor, `${r.res || 'Success'}${src}`)
      counts.new++
      continue
    }
    const l = b.loans.find((x) => x.id === r.loanId)
    if (!l || r.idx == null) continue
    if (r.kind === 'paid') {
      const k = r.idx + 1 - l.instalmentsPaid
      if (k > 0) {
        b = ops.recordPayment(b, l.id, k, actor, `${r.dueLbl} · ${r.res || 'Success'}${src}`)
        counts.paid++
      }
    } else if (r.kind === 'unpaid') {
      const { no, total } = instalmentNo(l)
      const note = `Inst ${r.K || no}/${total} · ${r.dueLbl} · ${r.res}${src}`
      b = l.status === 'overdue'
        ? ops.addNote(b, actor, { type: 'DEBIT FAILED', ref: l.ref, customer: r.clientName, amount: l.instalmentAmount, comment: note })
        : ops.setLoanStatus(b, l.id, 'overdue', actor, note)
      counts.unpaid++
    }
  }
  b = ops.addNote(b, actor, {
    type: 'BANK REPORT IMPORTED',
    ref: `BANK-${rows.filter((x) => x.on && x.kind !== 'skip').length}`,
    comment: `${counts.paid} paid · ${counts.unpaid} unpaid · ${counts.new} new${counts.clients ? ` (${counts.clients} new client${counts.clients > 1 ? 's' : ''})` : ''}${src}`,
  })
  return { book: b, counts }
}
