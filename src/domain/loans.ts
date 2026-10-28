import type { Book, Client, EffectiveStatus, Loan } from './types'
import { addMonths, monthKey, parseDate, round2, todayIso } from './format'

export const OPEN_STATUSES: Loan['status'][] = ['issued', 'overdue']

export const isOpen = (l: Loan) => !l.deletedAt && OPEN_STATUSES.includes(l.status) && l.instalmentsPaid < l.schedule.length

export const live = <T extends { deletedAt?: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt)

/** Instalment return + collection fee — what the client's account is debited each cycle. */
export const debitAmount = (l: Loan) => round2(l.instalmentAmount + l.collectionFee)

export const totalReturn = (l: Loan) => round2(l.instalmentAmount * l.schedule.length)

export const instalmentCount = (l: Loan) => l.schedule.length

export const remainingInstalments = (l: Loan) => Math.max(0, l.schedule.length - l.instalmentsPaid)

/** Return still to collect on this loan (excludes collection fees). */
export const outstanding = (l: Loan) =>
  l.status === 'paid' || l.status === 'written_off' || l.status === 'settled_early' ? 0 : round2(l.instalmentAmount * remainingInstalments(l))

export const collected = (l: Loan) => round2(l.instalmentAmount * Math.min(l.instalmentsPaid, l.schedule.length))

/** Lent amount, or a back-calculation from the return when not recorded. */
export const principalOf = (l: Loan) =>
  l.principal != null ? l.principal : round2(totalReturn(l) / (1 + l.returnRatePct / 100))

export const interestOf = (l: Loan) => round2(totalReturn(l) - principalOf(l))

/** Next unpaid instalment date, or null when fully collected. */
export const nextDue = (l: Loan): string | null => l.schedule[l.instalmentsPaid] ?? null

/** Display numbering for the next instalment, e.g. { no: 2, total: 6 }. */
export function instalmentNo(l: Loan) {
  const idx = Math.min(l.instalmentsPaid, Math.max(l.schedule.length - 1, 0))
  return { no: l.priorInstalments + idx + 1, total: l.priorInstalments + l.schedule.length }
}

/** Unpaid instalment dates strictly before `today`. */
export function pastDueDates(l: Loan, today = todayIso()): string[] {
  if (!isOpen(l)) return []
  return l.schedule.slice(l.instalmentsPaid).filter((d) => d < today)
}

export function effectiveStatus(l: Loan, today = todayIso()): EffectiveStatus {
  if (l.status === 'paid' || l.status === 'settled_early') return 'paid'
  if (l.status === 'written_off') return 'written_off'
  if (l.instalmentsPaid >= l.schedule.length && l.schedule.length > 0) return 'paid'
  if (l.status === 'overdue' || pastDueDates(l, today).length) return 'overdue'
  if (nextDue(l) === today) return 'duetoday'
  return 'issued'
}

/**
 * A loan is "not updated" when an instalment date has passed but nobody has
 * marked it paid or overdue since that date.
 */
export function isStale(l: Loan, today = todayIso()): boolean {
  if (l.status !== 'issued') return false
  const past = pastDueDates(l, today)
  if (!past.length) return false
  const last = past[past.length - 1]
  return !l.statusAt || l.statusAt.slice(0, 10) <= last
}

export const STATUS_META: Record<EffectiveStatus, { label: string; tone: 'blue' | 'amber' | 'red' | 'green' | 'mut' }> = {
  issued: { label: 'ISSUED', tone: 'blue' },
  duetoday: { label: 'DUE TODAY', tone: 'amber' },
  overdue: { label: 'OVERDUE', tone: 'red' },
  paid: { label: 'PAID', tone: 'green' },
  written_off: { label: 'WRITTEN OFF', tone: 'mut' },
}

/** Build an instalment schedule: n monthly dates starting at `first`. */
export function buildSchedule(firstIso: string, n: number): string[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => addMonths(firstIso, i))
}

/** Per-instalment return for a principal at a simple rate over n instalments. */
export function instalmentFor(principal: number, ratePct: number, n: number): number {
  return round2((principal * (1 + ratePct / 100)) / Math.max(1, n))
}

/** Normalise derived fields after any mutation. */
export function normalizeLoan(l: Loan): Loan {
  const n = l.schedule.length
  const paid = Math.max(0, Math.min(l.instalmentsPaid, n))
  let status = l.status
  if (n > 0 && paid >= n && status !== 'written_off' && status !== 'settled_early') status = 'paid'
  if (status === 'paid' && paid < n) status = 'issued'
  return { ...l, instalmentsPaid: paid, status }
}

/** Mark the loan fully paid (all instalments collected). */
export function markPaid(l: Loan): Loan {
  return { ...l, instalmentsPaid: l.schedule.length, status: 'paid' }
}

// ───────────────────────────── Book-level aggregates ─────────────────────────────

export interface Kpis {
  loanedOutThisMonth: number
  collectionOutstanding: number
  activeClients: number
  overdueAmount: number
  overdueAccounts: number
  notUpdated: number
}

export function kpis(book: Pick<Book, 'loans' | 'clients'>, today = todayIso()): Kpis {
  const loans = live(book.loans)
  const mk = monthKey(today)
  let overdueAmount = 0, overdueAccounts = 0, notUpdated = 0
  for (const l of loans) {
    if (effectiveStatus(l, today) === 'overdue') {
      overdueAccounts++
      const past = pastDueDates(l, today).length || 1
      overdueAmount += l.instalmentAmount * Math.min(past, remainingInstalments(l))
    }
    if (isStale(l, today)) notUpdated++
  }
  return {
    loanedOutThisMonth: round2(
      loans.filter((l) => (l.issuedOn ?? l.createdAt).slice(0, 7) === mk).reduce((s, l) => s + principalOf(l), 0),
    ),
    collectionOutstanding: round2(loans.reduce((s, l) => s + outstanding(l), 0)),
    activeClients: live(book.clients).filter((c) => !c.blocked).length,
    overdueAmount: round2(overdueAmount),
    overdueAccounts,
    notUpdated,
  }
}

export type TabKey = 'all' | EffectiveStatus

export function tabTotals(loans: Loan[], today = todayIso()) {
  const out: Record<TabKey, { count: number; amount: number }> = {
    all: { count: 0, amount: 0 }, issued: { count: 0, amount: 0 }, duetoday: { count: 0, amount: 0 },
    overdue: { count: 0, amount: 0 }, paid: { count: 0, amount: 0 }, written_off: { count: 0, amount: 0 },
  }
  for (const l of live(loans)) {
    const s = effectiveStatus(l, today)
    const amt = s === 'paid' ? collected(l) : s === 'written_off' ? outstandingAtWriteOff(l) : outstanding(l)
    out[s].count++
    out[s].amount = round2(out[s].amount + amt)
    out.all.count++
    out.all.amount = round2(out.all.amount + (s === 'paid' ? collected(l) : outstanding(l)))
  }
  return out
}

const outstandingAtWriteOff = (l: Loan) => round2(l.instalmentAmount * remainingInstalments(l))

export interface DueItem {
  loan: Loan
  date: string
  index: number
  no: number
  total: number
  amount: number
}

/** Every unpaid instalment falling on `dateIso` across open loans. */
export function dueOn(loans: Loan[], dateIso: string): DueItem[] {
  const out: DueItem[] = []
  for (const l of live(loans)) {
    if (!isOpen(l)) continue
    l.schedule.forEach((d, i) => {
      if (i >= l.instalmentsPaid && d === dateIso)
        out.push({ loan: l, date: d, index: i, no: l.priorInstalments + i + 1, total: l.priorInstalments + l.schedule.length, amount: l.instalmentAmount })
    })
  }
  return out
}

/** Map of ISO date → { count, amount } of unpaid instalments, for the calendar. */
export function collectionCalendar(loans: Loan[]): Map<string, { count: number; amount: number }> {
  const m = new Map<string, { count: number; amount: number }>()
  for (const l of live(loans)) {
    if (!isOpen(l)) continue
    l.schedule.forEach((d, i) => {
      if (i < l.instalmentsPaid) return
      const cur = m.get(d) ?? { count: 0, amount: 0 }
      cur.count++
      cur.amount = round2(cur.amount + l.instalmentAmount)
      m.set(d, cur)
    })
  }
  return m
}

/** Unpaid instalments grouped by month (YYYY-MM), ascending. */
export function collectionsByMonth(loans: Loan[]): { month: string; amount: number; count: number }[] {
  const m = new Map<string, { amount: number; count: number }>()
  for (const [d, v] of collectionCalendar(loans)) {
    const k = monthKey(d)
    const cur = m.get(k) ?? { amount: 0, count: 0 }
    cur.amount = round2(cur.amount + v.amount)
    cur.count += v.count
    m.set(k, cur)
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }))
}

/** Expected return across open loans, split pro-rata into principal and interest. */
export function expectedReturn(loans: Loan[]) {
  let total = 0, principal = 0, open = 0
  for (const l of live(loans)) {
    const o = outstanding(l)
    if (!o) continue
    open++
    total += o
    const tr = totalReturn(l)
    principal += tr ? (o * principalOf(l)) / tr : 0
  }
  return { total: round2(total), principal: round2(principal), interest: round2(total - principal), open }
}

/** Clients ranked by outstanding exposure. */
export function topExposures(book: Pick<Book, 'loans' | 'clients'>, n = 5) {
  const by = new Map<string, number>()
  for (const l of live(book.loans)) {
    const o = outstanding(l)
    if (o) by.set(l.clientId, round2((by.get(l.clientId) ?? 0) + o))
  }
  return [...by.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, amount]) => ({ client: book.clients.find((c) => c.id === id), clientId: id, amount }))
}

export interface NotifItem {
  loan: Loan
  kind: 'today' | 'stale' | 'overdue'
  date: string
  no: number
  total: number
  days: number
}

/** Due today + past-due loans nobody has updated (flagged) + marked overdue. */
export function notifications(loans: Loan[], today = todayIso()): NotifItem[] {
  const out: NotifItem[] = []
  const t = parseDate(today)!.getTime()
  for (const l of live(loans)) {
    if (!isOpen(l)) continue
    const { total } = instalmentNo(l)
    const unpaid = l.schedule.map((d, i) => ({ d, i })).filter((x) => x.i >= l.instalmentsPaid)
    const todayHit = unpaid.find((x) => x.d === today)
    const past = unpaid.filter((x) => x.d < today)
    const days = past.length ? Math.round((t - parseDate(past[past.length - 1].d)!.getTime()) / 864e5) : 0
    if (isStale(l, today)) {
      const p = past[past.length - 1]
      out.push({ loan: l, kind: 'stale', date: p.d, no: l.priorInstalments + p.i + 1, total, days })
    } else if (todayHit) {
      out.push({ loan: l, kind: 'today', date: todayHit.d, no: l.priorInstalments + todayHit.i + 1, total, days: 0 })
    } else if (l.status === 'overdue' || past.length) {
      const p = past[past.length - 1] ?? unpaid[0]
      out.push({ loan: l, kind: 'overdue', date: p.d, no: l.priorInstalments + p.i + 1, total, days })
    }
  }
  const rank = { stale: 0, today: 1, overdue: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.date.localeCompare(b.date))
}

/** First open instalment date on or after today (else the earliest open one). */
export function nextCollectionDay(loans: Loan[], today = todayIso()): string | null {
  const dates = [...collectionCalendar(loans).keys()].sort()
  return dates.find((d) => d >= today) ?? dates[0] ?? null
}

/** Next sequential loan ref: ECL-095 → ECL-096. Bank-report refs (ECL-F01) are ignored. */
export function nextLoanRef(loans: Loan[]): string {
  const hi = loans.reduce((m, l) => {
    const x = /^ECL-(\d+)$/.exec(l.ref)
    return x ? Math.max(m, +x[1]) : m
  }, 0)
  return `ECL-${String(hi + 1).padStart(3, '0')}`
}

export function nextBankLoanRef(loans: Loan[]): string {
  const hi = loans.reduce((m, l) => {
    const x = /^ECL-F(\d+)$/.exec(l.ref)
    return x ? Math.max(m, +x[1]) : m
  }, 0)
  return `ECL-F${String(hi + 1).padStart(2, '0')}`
}

export function nextClientRef(clients: Client[]): string {
  const hi = clients.reduce((m, c) => {
    const x = /(\d+)\s*$/.exec(c.ref)
    return x ? Math.max(m, +x[1]) : m
  }, 0)
  return `EC-0${hi + 1}`
}

export function clientLoans(loans: Loan[], clientId: string) {
  return live(loans).filter((l) => l.clientId === clientId)
}
