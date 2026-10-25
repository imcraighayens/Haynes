/**
 * Every change to the book, as pure functions: (book, …) → book.
 * Each op appends its own logbook (audit) entries and any bank movements,
 * so the trail is complete no matter which screen triggered it.
 */
import type {
  Application, Book, Client, Employee, Expense, Loan, LoanStatus, LogEntry, PettyEntry, PettyStatus, Settings,
} from '../domain/types'
import { round2, uid, zar } from '../domain/format'
import { normalizeLoan, principalOf, remainingInstalments } from '../domain/loans'

export interface Actor {
  name: string
}

export function entry(by: Actor, e: Partial<LogEntry> & { type: string }): LogEntry {
  return { id: uid('g_'), at: new Date().toISOString(), ref: '—', customer: '—', amount: 0, comment: '', by: by.name, ...e }
}

const withLog = (b: Book, ...es: LogEntry[]): Book => ({ ...b, logbook: [...es.reverse(), ...b.logbook] })

const bankMove = (by: Actor, type: 'in' | 'out', amount: number, ref: string, label: string) => ({
  id: uid('t_'), at: new Date().toISOString(), type, amount: round2(amount), ref, label, by: by.name,
})

const clientName = (b: Book, id: string) => b.clients.find((c) => c.id === id)?.name ?? '—'

const patchRow = <T extends { id: string }>(rows: T[], id: string, fn: (r: T) => T): T[] =>
  rows.map((r) => (r.id === id ? fn(r) : r))

// ───────────────────────────── Clients ─────────────────────────────

export function addClient(b: Book, c: Client, by: Actor): Book {
  return withLog({ ...b, clients: [...b.clients, c] }, entry(by, { type: 'CLIENT ADDED', ref: c.ref, customer: c.name, comment: c.employer ? `Employer ${c.employer}` : '' }))
}

export function updateClient(b: Book, id: string, patch: Partial<Client>, by: Actor, note = 'Details updated'): Book {
  const c = b.clients.find((x) => x.id === id)
  if (!c) return b
  return withLog(
    { ...b, clients: patchRow(b.clients, id, (x) => ({ ...x, ...patch })) },
    entry(by, { type: 'CLIENT UPDATED', ref: c.ref, customer: c.name, comment: note }),
  )
}

export function setClientBlocked(b: Book, id: string, blocked: boolean, by: Actor, reason = ''): Book {
  const c = b.clients.find((x) => x.id === id)
  if (!c) return b
  return withLog(
    { ...b, clients: patchRow(b.clients, id, (x) => ({ ...x, blocked })) },
    entry(by, { type: blocked ? 'CLIENT BLOCKED' : 'CLIENT UNBLOCKED', ref: c.ref, customer: c.name, comment: reason }),
  )
}

/** Soft delete: the client and their loans are archived, never removed (NCA s170 / FICA retention). */
export function archiveClient(b: Book, id: string, by: Actor, reason: string): Book {
  const c = b.clients.find((x) => x.id === id)
  if (!c) return b
  const now = new Date().toISOString()
  return withLog(
    {
      ...b,
      clients: patchRow(b.clients, id, (x) => ({ ...x, deletedAt: now })),
      loans: b.loans.map((l) => (l.clientId === id && !l.deletedAt ? { ...l, deletedAt: now } : l)),
    },
    entry(by, { type: 'CLIENT ARCHIVED', ref: c.ref, customer: c.name, comment: reason }),
  )
}

// ───────────────────────────── Loans ─────────────────────────────

export function issueLoan(b: Book, loan: Loan, by: Actor, note = ''): Book {
  const l = normalizeLoan({ ...loan, statusAt: loan.statusAt ?? new Date().toISOString(), issuedBy: loan.issuedBy ?? by.name })
  const name = clientName(b, l.clientId)
  const n = l.schedule.length
  const out = l.principal != null && l.principal > 0 ? [bankMove(by, 'out', l.principal, l.ref, 'Loan issued')] : []
  return withLog(
    { ...b, loans: [...b.loans, l], bankTx: [...out, ...b.bankTx] },
    entry(by, {
      type: 'LOAN ISSUED', ref: l.ref, customer: name, amount: l.principal ?? 0,
      comment: [`${n} × ${zar(l.instalmentAmount)}`, `return ${l.returnRatePct}%`, note].filter(Boolean).join(' · '),
    }),
  )
}

export function updateLoan(b: Book, id: string, patch: Partial<Loan>, by: Actor, note = 'Loan edited'): Book {
  const l = b.loans.find((x) => x.id === id)
  if (!l) return b
  return withLog(
    { ...b, loans: patchRow(b.loans, id, (x) => normalizeLoan({ ...x, ...patch })) },
    entry(by, { type: 'LOAN UPDATED', ref: l.ref, customer: clientName(b, l.clientId), amount: l.principal ?? 0, comment: note }),
  )
}

/** Collect `count` instalments. Completing the schedule marks the loan paid. */
export function recordPayment(b: Book, id: string, count: number, by: Actor, note = ''): Book {
  const l = b.loans.find((x) => x.id === id)
  if (!l) return b
  const k = Math.max(0, Math.min(count, remainingInstalments(l)))
  if (!k) return b
  const next = normalizeLoan({ ...l, instalmentsPaid: l.instalmentsPaid + k, status: l.status === 'overdue' ? 'issued' : l.status, statusAt: new Date().toISOString() })
  const amount = round2(l.instalmentAmount * k)
  const from = l.priorInstalments + l.instalmentsPaid + 1
  const label = k > 1 ? `Inst ${from}–${from + k - 1}` : `Inst ${from}`
  const es = [entry(by, { type: 'PAYMENT RECEIVED', ref: l.ref, customer: clientName(b, l.clientId), amount, comment: [`${label}/${l.priorInstalments + l.schedule.length}`, note].filter(Boolean).join(' · ') })]
  if (next.status === 'paid') es.push(entry(by, { type: 'STATUS → PAID', ref: l.ref, customer: clientName(b, l.clientId), amount: 0, comment: 'All instalments collected' }))
  return withLog({ ...b, loans: patchRow(b.loans, id, () => next), bankTx: [bankMove(by, 'in', amount, l.ref, k > 1 ? `${k} instalments collected` : 'Instalment collected'), ...b.bankTx] }, ...es)
}

export const STATUS_LABEL: Record<LoanStatus, string> = {
  issued: 'ISSUED', overdue: 'OVERDUE', paid: 'PAID', settled_early: 'SETTLED EARLY', written_off: 'WRITTEN OFF',
}

/**
 * Set a loan's status by hand.
 *  - paid: collects every remaining instalment (bank in)
 *  - issued from paid: re-opens the last instalment (bank reversal)
 *  - written_off: records reason and time
 */
export function setLoanStatus(b: Book, id: string, status: LoanStatus, by: Actor, note = ''): Book {
  const l = b.loans.find((x) => x.id === id)
  if (!l || (l.status === status && status !== 'issued')) return b
  const name = clientName(b, l.clientId)
  const now = new Date().toISOString()
  let next: Loan = { ...l, status, statusAt: now }
  let bankTx = b.bankTx
  if (status === 'paid' || status === 'settled_early') {
    const k = remainingInstalments(l)
    if (k) bankTx = [bankMove(by, 'in', l.instalmentAmount * k, l.ref, status === 'paid' ? 'Collected · marked paid' : 'Settled early'), ...bankTx]
    next = { ...next, instalmentsPaid: l.schedule.length }
  } else if (l.status === 'paid' || l.status === 'settled_early') {
    next = { ...next, instalmentsPaid: Math.max(0, l.schedule.length - 1) }
    bankTx = [bankMove(by, 'out', l.instalmentAmount, l.ref, 'Reversed · unmarked paid'), ...bankTx]
  }
  if (status === 'written_off') next = { ...next, writtenOffAt: now, writeOffReason: note || 'Written off' }
  else next = { ...next, writtenOffAt: null, writeOffReason: null }
  next = status === 'settled_early' ? next : normalizeLoan(next)
  return withLog(
    { ...b, loans: patchRow(b.loans, id, () => next), bankTx },
    entry(by, { type: `STATUS → ${STATUS_LABEL[status]}`, ref: l.ref, customer: name, amount: status === 'written_off' ? principalOf(l) : 0, comment: note }),
  )
}

/** Mark a loan's status as checked today without changing it (clears the "not updated" flag). */
export function confirmStatus(b: Book, id: string, by: Actor, note = 'Status confirmed'): Book {
  const l = b.loans.find((x) => x.id === id)
  if (!l) return b
  return withLog(
    { ...b, loans: patchRow(b.loans, id, (x) => ({ ...x, statusAt: new Date().toISOString() })) },
    entry(by, { type: 'STATUS CONFIRMED', ref: l.ref, customer: clientName(b, l.clientId), comment: note }),
  )
}

export function archiveLoan(b: Book, id: string, by: Actor, reason: string): Book {
  const l = b.loans.find((x) => x.id === id)
  if (!l) return b
  return withLog(
    { ...b, loans: patchRow(b.loans, id, (x) => ({ ...x, deletedAt: new Date().toISOString() })) },
    entry(by, { type: 'LOAN ARCHIVED', ref: l.ref, customer: clientName(b, l.clientId), amount: l.principal ?? 0, comment: reason }),
  )
}

// ───────────────────────────── Applications ─────────────────────────────

export function addApplication(b: Book, a: Application, by: Actor): Book {
  return withLog({ ...b, applications: [a, ...b.applications] }, entry(by, { type: 'APPLICATION RECEIVED', ref: a.ref, customer: a.name, amount: a.amount, comment: `${a.termMonths}m · ${a.purpose} · ${a.source}` }))
}

export function updateApplication(b: Book, id: string, patch: Partial<Application>, by: Actor, note?: string): Book {
  const a = b.applications.find((x) => x.id === id)
  if (!a) return b
  const nb = { ...b, applications: patchRow(b.applications, id, (x) => ({ ...x, ...patch })) }
  return note ? withLog(nb, entry(by, { type: 'APPLICATION UPDATED', ref: a.ref, customer: a.name, amount: a.amount, comment: note })) : nb
}

export function decideApplication(b: Book, id: string, decision: 'approved' | 'declined', by: Actor, extra: { reason?: string; loanId?: string; clientId?: string } = {}): Book {
  const a = b.applications.find((x) => x.id === id)
  if (!a) return b
  return withLog(
    {
      ...b,
      applications: patchRow(b.applications, id, (x) => ({
        ...x, status: decision, decidedBy: by.name, decidedAt: new Date().toISOString(),
        declineReason: decision === 'declined' ? extra.reason ?? null : null,
        loanId: extra.loanId ?? x.loanId, clientId: extra.clientId ?? x.clientId,
      })),
    },
    entry(by, { type: decision === 'approved' ? 'APPLICATION APPROVED' : 'APPLICATION DECLINED', ref: a.ref, customer: a.name, amount: a.amount, comment: extra.reason ?? '' }),
  )
}

// ───────────────────────────── Petty cash, expenses, bank ─────────────────────────────

export function addPetty(b: Book, p: PettyEntry, by: Actor): Book {
  return withLog({ ...b, petty: [p, ...b.petty] }, entry(by, { type: 'PETTY CASH', ref: p.category.toUpperCase(), customer: p.borrower || '—', amount: p.amount, comment: p.purpose }))
}

export function setPettyStatus(b: Book, id: string, status: PettyStatus, by: Actor): Book {
  const p = b.petty.find((x) => x.id === id)
  if (!p) return b
  return withLog({ ...b, petty: patchRow(b.petty, id, (x) => ({ ...x, status })) }, entry(by, { type: `PETTY → ${status}`, ref: p.category.toUpperCase(), customer: p.borrower || '—', amount: p.amount, comment: p.purpose }))
}

export function upsertExpense(b: Book, x: Expense, by: Actor): Book {
  const exists = b.expenses.some((e) => e.id === x.id)
  return withLog(
    { ...b, expenses: exists ? patchRow(b.expenses, x.id, () => x) : [...b.expenses, x] },
    entry(by, { type: exists ? 'EXPENSE UPDATED' : 'EXPENSE ADDED', ref: 'EXP', amount: x.amount, comment: x.name }),
  )
}

export function removeExpense(b: Book, id: string, by: Actor): Book {
  const x = b.expenses.find((e) => e.id === id)
  if (!x) return b
  return withLog({ ...b, expenses: patchRow(b.expenses, id, (e) => ({ ...e, deletedAt: new Date().toISOString() })) }, entry(by, { type: 'EXPENSE REMOVED', ref: 'EXP', amount: x.amount, comment: x.name }))
}

export function setBankBalance(b: Book, balance: number, by: Actor, note = ''): Book {
  return withLog(
    { ...b, settings: { ...b.settings, bankOpeningBalance: round2(balance), bankOpeningAt: new Date().toISOString() } },
    entry(by, { type: 'BANK BALANCE SET', ref: 'BANK', amount: balance, comment: note }),
  )
}

export function addBankTx(b: Book, type: 'in' | 'out', amount: number, ref: string, label: string, by: Actor): Book {
  return withLog({ ...b, bankTx: [bankMove(by, type, amount, ref, label), ...b.bankTx] }, entry(by, { type: type === 'in' ? 'BANK IN' : 'BANK OUT', ref, amount, comment: label }))
}

// ───────────────────────────── Team & settings ─────────────────────────────

export function upsertEmployee(b: Book, e: Employee, by: Actor): Book {
  const exists = b.employees.some((x) => x.id === e.id)
  return withLog(
    { ...b, employees: exists ? patchRow(b.employees, e.id, () => e) : [...b.employees, e] },
    entry(by, { type: exists ? 'EMPLOYEE UPDATED' : 'EMPLOYEE ADDED', ref: e.role.toUpperCase(), customer: e.name, comment: e.email }),
  )
}

export function updateSettings(b: Book, patch: Partial<Settings>, by: Actor, note = 'Settings changed'): Book {
  return withLog({ ...b, settings: { ...b.settings, ...patch } }, entry(by, { type: 'SETTINGS', ref: 'ORG', comment: note }))
}

export function addNote(b: Book, by: Actor, e: Partial<LogEntry> & { type: string }): Book {
  return withLog(b, entry(by, e))
}
