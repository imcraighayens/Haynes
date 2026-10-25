import type { Application, Book, Client, Employee, Expense, Loan, LogEntry, PettyEntry, Role } from './types'
import { blankClient, blankLoan, contractNo, DEFAULT_SETTINGS } from './factories'
import { round2, toIso, uid } from './format'
import { normalizeLoan } from './loans'

/**
 * Import a book saved by the LEDGER prototype (single-file console).
 *
 * Accepts either:
 *  - the prototype's browser save:  localStorage.getItem('evoltConsoleV4')
 *  - the prototype's Supabase payload (schema 'ledger-book/2')
 *
 * Both share the same keys: clients, loans, logbook, petty, employees,
 * applications, bank, bankTx, expenses, statusAt.
 *
 * To get it out of the prototype: open the console in the browser where you
 * used it, run  copy(localStorage.getItem('evoltConsoleV4'))  and paste.
 */

type Any = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const dash = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim()
  return !s || s === '—' || s === '-' ? null : s
}
const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function roleOf(label: unknown): Role {
  const k = String(label ?? '').trim().toLowerCase()
  if (k.startsWith('admin')) return 'admin'
  if (k.startsWith('manager')) return 'manager'
  if (k.startsWith('collect')) return 'collections'
  if (k.startsWith('audit')) return 'auditor'
  return 'agent'
}

/** Prototype logic: bank-report loans carry retAmt and a non ECL-0nn ref. */
const isCsvLoan = (l: Any) => l.retAmt != null && !/^ECL-0\d/.test(String(l.ref ?? ''))

export interface ImportResult {
  book: Book
  summary: string
  warnings: string[]
}

export function importPrototypeBook(raw: string | Any, base: Book): ImportResult {
  const src: Any = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!src || !Array.isArray(src.clients) || !Array.isArray(src.loans))
    throw new Error('This does not look like a LEDGER prototype book (no clients/loans arrays).')
  const warnings: string[] = []
  const nowIso = new Date().toISOString()

  const employees: Employee[] = (Array.isArray(src.employees) ? src.employees : []).map((e: Any) => ({
    id: String(e.id ?? uid('e_')),
    name: String(e.name ?? '—'),
    email: String(e.email ?? ''),
    role: roleOf(e.role),
    active: String(e.status ?? 'ACTIVE').toUpperCase() !== 'DISABLED',
    approvalLimit: num(e.approvalLimit),
    createdAt: (toIso(e.added) ?? nowIso.slice(0, 10)) + 'T08:00:00.000Z',
  }))
  const officerId = (name: unknown) => employees.find((e) => e.name === name)?.id ?? null

  const clients: Client[] = src.clients.map((c: Any, i: number) => {
    const created = toIso(c.added) ?? nowIso.slice(0, 10)
    return blankClient({
      id: String(c.id),
      ref: String(c.ref ?? ''),
      name: String(c.name ?? 'Unknown'),
      idNumber: dash(c.idFull),
      dob: toIso(c.dob),
      email: dash(c.email),
      phone: dash(c.phone),
      address: dash(c.address),
      city: dash(c.city),
      province: dash(c.province),
      employment: dash(c.employment),
      employer: dash(c.employer),
      jobTitle: dash(c.jobTitle),
      tenure: dash(c.tenure),
      netSalary: num(c.netSalary),
      grossSalary: num(c.grossSalary),
      otherIncome: num(c.otherIncome),
      expenses: { rent: num(c.expRent), transport: num(c.expTransport), groceries: num(c.expFood), otherDebt: num(c.expDebt), other: num(c.expOther) },
      bank: dash(c.bank),
      branchCode: dash(c.branchCode),
      accountNo: dash(c.account),
      accountType: dash(c.accountType),
      officerId: officerId(c.employee),
      score: num(c.score),
      blocked: !!c.blocked,
      contract: {
        no: String(c.contract?.no ?? contractNo(i)),
        signedOn: c.contract?.sig ? toIso(c.contract?.signedOn) : null,
        signature: c.contract?.sig ?? null,
      },
      createdAt: created + 'T08:00:00.000Z',
      createdBy: dash(c.employee),
    })
  })

  const statusAt: Any = src.statusAt ?? {}
  const loans: Loan[] = src.loans
    .filter((l: Any) => !l.deleted)
    .map((l: Any) => {
      const schedule = (Array.isArray(l.sched) && l.sched.length ? l.sched : [l.due]).map((d: string) => toIso(d)).filter(Boolean) as string[]
      if (!schedule.length) warnings.push(`${l.ref}: no due date — skipped schedule`)
      const n = Math.max(1, schedule.length)
      const ret = l.ret == null ? 35 : num(l.ret)
      const csv = isCsvLoan(l)
      const status = String(l.status ?? 'issued').toLowerCase()
      let loan: Loan
      if (csv) {
        // Prototype: amount = return per instalment, retAmt = client debit incl. NuPay PIF.
        const lent = l.lent != null ? num(l.lent) : null
        loan = blankLoan({
          principal: lent,
          principalDerived: lent == null,
          returnRatePct: 35,
          instalmentAmount: num(l.amount),
          collectionFee: round2(num(l.retAmt) - num(l.amount)),
        })
      } else {
        loan = blankLoan({
          principal: num(l.amount),
          returnRatePct: ret,
          instalmentAmount: round2((num(l.amount) * (1 + ret / 100)) / n),
          collectionFee: 0,
        })
      }
      const at = statusAt[l.id]
      return normalizeLoan({
        ...loan,
        id: String(l.id),
        ref: String(l.ref ?? ''),
        clientId: String(l.clientId),
        schedule: schedule.length ? schedule : [nowIso.slice(0, 10)],
        instalmentsPaid: status === 'paid' ? n : Math.min(num(l.paidInst), n),
        priorInstalments: num(l.instDone),
        status: status === 'paid' ? 'paid' : status === 'overdue' ? 'overdue' : status.startsWith('written') ? 'written_off' : 'issued',
        statusAt: at ? new Date(at).toISOString() : null,
        mandateId: dash(l.mandate),
        purpose: String(l.purpose ?? 'Personal'),
        issuedOn: toIso(l.issued),
        issuedBy: dash(l.issuedBy),
        createdAt: (toIso(l.issued) ?? schedule[0] ?? nowIso.slice(0, 10)) + 'T09:00:00.000Z',
      })
    })

  const orphan = loans.filter((l) => !clients.some((c) => c.id === l.clientId))
  if (orphan.length) warnings.push(`${orphan.length} loan(s) reference a client that is not in the book: ${orphan.map((l) => l.ref).join(', ')}`)

  const logbook: LogEntry[] = (Array.isArray(src.logbook) ? src.logbook : []).map((g: Any, i: number) => ({
    id: `imp_g${i}`,
    at: (toIso(g.date) ?? nowIso.slice(0, 10)) + 'T12:00:00.000Z',
    type: String(g.type ?? 'NOTE'),
    ref: String(g.ref ?? '—'),
    customer: String(g.customer ?? '—'),
    amount: num(g.amount),
    by: String(g.by ?? '—'),
    comment: String(g.comment ?? ''),
  }))

  const petty: PettyEntry[] = (Array.isArray(src.petty) ? src.petty : []).map((p: Any) => ({
    id: String(p.id ?? uid('p_')),
    date: toIso(p.iso ?? p.date) ?? nowIso.slice(0, 10),
    amount: num(p.amount),
    category: (['travel', 'office', 'airtime', 'meals', 'advance'].includes(p.cat) ? p.cat : 'other') as PettyEntry['category'],
    purpose: String(p.purpose ?? ''),
    borrower: dash(p.borrower) ?? '',
    notes: String(p.notes ?? ''),
    status: (['PENDING', 'APPROVED', 'REPAID', 'DECLINED'].includes(p.status) ? p.status : 'PENDING') as PettyEntry['status'],
    by: String(p.by ?? p.staffName ?? '—'),
    createdAt: (toIso(p.iso ?? p.date) ?? nowIso.slice(0, 10)) + 'T12:00:00.000Z',
  }))

  const expenses: Expense[] = (Array.isArray(src.expenses) ? src.expenses : []).map((x: Any) => ({
    id: String(x.id ?? uid('x_')),
    name: String(x.name ?? 'Expense'),
    amount: num(x.amount),
    deletedAt: null,
  }))

  const bankTx = (Array.isArray(src.bankTx) ? src.bankTx : []).map((t: Any) => ({
    id: uid('t_'),
    at: new Date(t.at ?? Date.now()).toISOString(),
    type: t.type === 'out' ? ('out' as const) : ('in' as const),
    amount: num(t.amount),
    ref: String(t.ref ?? '—'),
    label: String(t.label ?? ''),
    by: String(t.by ?? '—'),
  }))

  const applications: Application[] = (Array.isArray(src.applications) ? src.applications : []).map((a: Any, i: number) => ({
    id: String(a.id ?? uid('a_')),
    ref: String(a.ref ?? `APP-${2000 + i}`),
    clientId: a.clientId ?? null,
    name: String(a.name ?? '—'),
    phone: dash(a.phone),
    email: dash(a.email),
    idNumber: dash(a.idNumber),
    employer: dash(a.employer),
    jobTitle: dash(a.jobTitle),
    netIncome: num(a.income),
    bank: dash(a.bank),
    amount: num(a.amount),
    termMonths: num(a.term) || 1,
    purpose: String(a.purpose ?? 'Personal'),
    source: String(a.source ?? 'Imported'),
    status: (['new', 'reviewing', 'approved', 'declined'].includes(a.status) ? a.status : 'new') as Application['status'],
    declineReason: a.declineReason ?? null,
    decidedBy: null,
    decidedAt: null,
    loanId: a.loanId ?? null,
    createdAt: (toIso(a.submitted) ?? nowIso.slice(0, 10)) + 'T09:00:00.000Z',
  }))

  const bank = src.bank as Any | undefined
  const settings = {
    ...DEFAULT_SETTINGS,
    ...base.settings,
    bankOpeningBalance: bank && bank.balance != null ? num(bank.balance) : base.settings.bankOpeningBalance,
    bankOpeningAt: bank && bank.at ? new Date(bank.at).toISOString() : base.settings.bankOpeningAt,
  }

  const book: Book = {
    clients,
    loans,
    applications,
    logbook: [
      {
        id: uid('g_'),
        at: nowIso,
        type: 'BOOK IMPORTED',
        ref: '—',
        customer: '—',
        amount: 0,
        by: '—',
        comment: `Prototype book: ${clients.length} clients, ${loans.length} loans, ${logbook.length} log entries`,
      },
      ...logbook,
    ],
    petty,
    expenses,
    bankTx,
    employees: employees.length ? employees : base.employees,
    settings,
  }
  return {
    book,
    summary: `${clients.length} clients · ${loans.length} loans · ${logbook.length} log entries · ${petty.length} petty cash · ${applications.length} applications`,
    warnings,
  }
}
