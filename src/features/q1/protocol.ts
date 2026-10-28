/**
 * Q1 ⇄ Claude protocol, shared by the browser and the server function
 * (api/q1.ts). Pure TypeScript — no DOM, no React — so both sides agree on
 * the instructions, the context shape and the answer format.
 *
 * DATA MINIMISATION (POPIA): the context sent to Claude carries loan refs,
 * client names, amounts, dates and statuses only. ID numbers, bank account
 * and branch details, phone numbers, emails, addresses, salaries and
 * signatures are never included — buildQ1Context is the single place that
 * decides, and a unit test guards it.
 */
import type { Book, Role } from '../../domain/types'
import {
  effectiveStatus, expectedReturn, instalmentNo, isStale, kpis, live, nextCollectionDay, nextDue, notifications, outstanding,
  principalOf, tabTotals, totalReturn, collected,
} from '../../domain/loans'
import { bankPosition, monthlyExpenses } from '../../domain/bank'
import { dateLabel, dayStamp, parseDate, round2 } from '../../domain/format'

export const Q1_MODEL = 'claude-opus-5-5'

export type Q1Page = 'dashboard' | 'loans' | 'overdue' | 'clients' | 'applications' | 'logbook' | 'ledger' | 'petty'

export interface Q1ActionSpec {
  kind: 'open_loan' | 'open_client' | 'go' | 'notifications' | 'new_loan' | 'import_report'
  /** Loan ref (ECL-095) for open_loan / client ref (EC-032) for open_client and new_loan */
  ref: string | null
  page: Q1Page | null
  label: string
}

export interface Q1Answer {
  answer: string
  actions: Q1ActionSpec[]
}

export interface Q1Turn {
  role: 'user' | 'assistant'
  content: string
}

/** JSON Schema for the answer — used as structured output on the server. */
export const Q1_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'actions'],
  properties: {
    answer: { type: 'string', description: 'What Q1 says to the user. Plain text, no markdown.' },
    actions: {
      type: 'array',
      description: 'Up to 3 buttons the console can show under the answer. Empty when none help.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'ref', 'page', 'label'],
        properties: {
          kind: { type: 'string', enum: ['open_loan', 'open_client', 'go', 'notifications', 'new_loan', 'import_report'] },
          ref: { type: ['string', 'null'] },
          page: { type: ['string', 'null'], enum: ['dashboard', 'loans', 'overdue', 'clients', 'applications', 'logbook', 'ledger', 'petty', null] },
          label: { type: 'string' },
        },
      },
    },
  },
} as const

export const Q1_SYSTEM = `You are Q1, the assistant inside LEDGER — the loan-book console of a South African micro-lender. Staff ask you about their book: who owes what, what collects when, who is overdue or not updated, bank position, applications, petty cash and recent activity.

How to answer:
- Use ONLY the book data provided in the conversation. If the answer is not in it, say so plainly and suggest where in LEDGER to look. Never invent clients, loans, amounts or dates.
- Be brief: 1–3 short sentences. For a list, use at most 8 lines starting with "• ". Plain text only — no markdown, no tables, no headings.
- Money in rand with a space as thousands separator: "R 4 050", "R 27 996.40". Dates like "23 Oct 2026". Loan refs (ECL-095) and client refs (EC-032) exactly as given.
- "Not updated" means an instalment date has passed and nobody has marked it paid or overdue since. "Overdue" includes those plus loans marked overdue.
- Totals and counts are already calculated in the data — prefer them over adding things up yourself.
- You cannot change anything. When the user wants to act (record a payment, mark overdue, issue a loan), say what to do and offer an action button.
- You do not have ID numbers, bank details, phone numbers, emails, addresses or salaries, by design. If asked, say they are in the client's hub (behind Reveal details) and offer to open it.
- Do not give legal or regulatory rulings; point to the compliance officer.

Reply as JSON: {"answer": string, "actions": [{"kind", "ref", "page", "label"}]}.
Action kinds: open_loan (ref = loan ref), open_client (ref = client ref), go (page = dashboard | loans | overdue | clients | applications | logbook | ledger | petty), notifications, new_loan (ref = client ref or null), import_report. Use null for fields that don't apply. Labels are short, e.g. "Open ECL-095". At most 3 actions; [] when none help.`

const MAX_ROWS = 300

/** Build the minimised book snapshot Q1 reasons over. */
export function buildQ1Context(book: Book, today: string, user: { name: string; role: Role }, page: string) {
  const loans = live(book.loans)
  const clients = live(book.clients)
  const clientOf = new Map(clients.map((c) => [c.id, c]))
  const officer = new Map(book.employees.map((e) => [e.id, e.name]))
  const k = kpis(book, today)
  const tabs = tabTotals(book.loans, today)
  const er = expectedReturn(book.loans)
  const bank = bankPosition(book)
  const notif = notifications(book.loans, today)
  const nm = (id: string) => clientOf.get(id)?.name ?? '—'
  const cref = (id: string) => clientOf.get(id)?.ref ?? '—'

  const loanRows = loans
    .slice()
    .sort((a, b) => (nextDue(a) ?? '9').localeCompare(nextDue(b) ?? '9'))
    .slice(0, MAX_ROWS)
    .map((l) => {
      const { no, total } = instalmentNo(l)
      return {
        ref: l.ref,
        client: nm(l.clientId),
        clientRef: cref(l.clientId),
        status: effectiveStatus(l, today),
        notUpdated: isStale(l, today),
        lent: principalOf(l),
        lentIsEstimate: l.principal == null,
        returnRatePct: l.returnRatePct,
        instalmentReturn: l.instalmentAmount,
        debitPerInstalment: round2(l.instalmentAmount + l.collectionFee),
        instalments: `${Math.min(l.instalmentsPaid + l.priorInstalments, total)} paid of ${total}`,
        nextInstalmentNo: l.instalmentsPaid < l.schedule.length ? no : null,
        nextDue: nextDue(l) ? dateLabel(nextDue(l)) : null,
        lastDue: dateLabel(l.schedule[l.schedule.length - 1]),
        totalReturn: totalReturn(l),
        collected: collected(l),
        outstanding: outstanding(l),
        issued: l.issuedOn ? dateLabel(l.issuedOn) : null,
        purpose: l.purpose,
        writeOffReason: l.writeOffReason,
      }
    })

  const exposure = new Map<string, { open: number; outstanding: number }>()
  for (const l of loans) {
    const o = outstanding(l)
    const cur = exposure.get(l.clientId) ?? { open: 0, outstanding: 0 }
    if (o) {
      cur.open++
      cur.outstanding = round2(cur.outstanding + o)
    }
    exposure.set(l.clientId, cur)
  }
  const clientRows = clients.slice(0, MAX_ROWS).map((c) => ({
    ref: c.ref,
    name: c.name,
    openLoans: exposure.get(c.id)?.open ?? 0,
    outstanding: exposure.get(c.id)?.outstanding ?? 0,
    blocked: c.blocked,
    officer: c.officerId ? officer.get(c.officerId) ?? null : null,
    score: c.score || null,
    clientSince: dateLabel(c.createdAt),
    agreementSigned: !!c.contract.signature,
  }))

  return {
    today: dayStamp(parseDate(today)!),
    org: book.settings.orgName,
    askedBy: { name: user.name, role: user.role },
    currentPage: page,
    totals: {
      loanedOutThisMonth: k.loanedOutThisMonth,
      collectionOutstanding: k.collectionOutstanding,
      activeClients: k.activeClients,
      overdue: { amount: k.overdueAmount, accounts: k.overdueAccounts, notUpdated: k.notUpdated },
      byStatus: tabs,
      expectedReturn: er,
      nextCollectionDay: nextCollectionDay(book.loans, today) ? dateLabel(nextCollectionDay(book.loans, today)) : null,
    },
    bank: { balance: bank.balance, derivedFromActivity: bank.derived, recentMovements: bank.moves.slice(0, 15).map((t) => ({ date: dateLabel(t.at), type: t.type, amount: t.amount, ref: t.ref, label: t.label })) },
    monthlyOfficeExpenses: { total: monthlyExpenses(live(book.expenses)), items: live(book.expenses).map((x) => ({ name: x.name, amount: x.amount })) },
    attention: notif.slice(0, 60).map((n) => ({ kind: n.kind, ref: n.loan.ref, client: nm(n.loan.clientId), instalment: `${n.no}/${n.total}`, due: dateLabel(n.date), daysPast: n.days, amount: n.loan.instalmentAmount })),
    loans: loanRows,
    loansTruncated: loans.length > MAX_ROWS,
    clients: clientRows,
    applications: book.applications.slice(0, 60).map((a) => ({ ref: a.ref, name: a.name, amount: a.amount, termMonths: a.termMonths, purpose: a.purpose, status: a.status, submitted: dateLabel(a.createdAt) })),
    pettyCash: book.petty.slice(0, 40).map((p) => ({ date: dateLabel(p.date), amount: p.amount, category: p.category, purpose: p.purpose, borrower: p.borrower || null, status: p.status })),
    recentActivity: book.logbook.slice(0, 30).map((g) => ({ when: dateLabel(g.at), type: g.type, ref: g.ref, customer: g.customer, amount: g.amount || null, by: g.by })),
  }
}

export type Q1Context = ReturnType<typeof buildQ1Context>

/** The one user turn that carries the book: put before the conversation. */
export function contextTurn(ctx: Q1Context): string {
  return `BOOK DATA (current, JSON):\n${JSON.stringify(ctx)}`
}

/** Read a model reply into a Q1Answer; tolerant of a fenced or chatty reply. */
export function parseQ1Answer(raw: unknown): Q1Answer {
  let v: unknown = raw
  if (typeof raw === 'string') {
    const t = raw.trim()
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t)
    const body = fenced ? fenced[1] : t.slice(Math.max(0, t.indexOf('{')), t.lastIndexOf('}') + 1)
    try {
      v = JSON.parse(body)
    } catch {
      return { answer: t, actions: [] }
    }
  }
  const o = (v ?? {}) as Partial<Q1Answer>
  const kinds = ['open_loan', 'open_client', 'go', 'notifications', 'new_loan', 'import_report']
  const pages = ['dashboard', 'loans', 'overdue', 'clients', 'applications', 'logbook', 'ledger', 'petty']
  const actions = (Array.isArray(o.actions) ? o.actions : [])
    .filter((a): a is Q1ActionSpec => !!a && kinds.includes((a as Q1ActionSpec).kind))
    .slice(0, 3)
    .map((a) => ({
      kind: a.kind,
      ref: typeof a.ref === 'string' && a.ref ? a.ref.trim() : null,
      page: typeof a.page === 'string' && pages.includes(a.page) ? (a.page as Q1Page) : null,
      label: String(a.label || 'Open').slice(0, 40),
    }))
  return { answer: String(o.answer ?? '').trim() || 'I could not form an answer to that.', actions }
}
