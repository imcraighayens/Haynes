/**
 * Q1's answers, computed locally from the book. No network, no model:
 * deterministic summaries and lookups. Open-ended AI answers are planned for a
 * server-side assistant (PRD P3) so client data never leaves the backend.
 */
import type { Book } from '../../domain/types'
import {
  clientLoans, dueOn, effectiveStatus, expectedReturn, instalmentNo, kpis, live, nextCollectionDay, nextDue, notifications, outstanding, STATUS_META, tabTotals, topExposures,
} from '../../domain/loans'
import { bankPosition, monthlyExpenses } from '../../domain/bank'
import { dateLabel, dayStamp, parseDate, zar } from '../../domain/format'

export type Q1Action = 'notifications' | 'overdue' | 'ledger' | 'newLoan' | 'loans' | { loanId: string } | { clientId: string }

export interface Q1Msg {
  id: number
  from: 'q1' | 'me'
  text: string
  alert?: boolean
  chips?: { label: string; action: Q1Action }[]
}

type Reply = Omit<Q1Msg, 'id' | 'from'>

const name = (b: Book, id: string) => b.clients.find((c) => c.id === id)?.name ?? '—'

export function greeting(hour = new Date().getHours()) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export function dailyBrief(b: Book, today: string, userName: string): Reply {
  const first = userName.split(/\s+/)[0] || 'there'
  const due = dueOn(b.loans, today)
  const notif = notifications(b.loans, today)
  const stale = notif.filter((n) => n.kind === 'stale')
  const lines = [`${greeting()}, ${first}. Here is today, ${dayStamp(parseDate(today)!)}.`, '']
  if (due.length) {
    lines.push(`${due.length} collection${due.length === 1 ? '' : 's'} today · ${zar(due.reduce((s, d) => s + d.amount, 0))}`)
    due.slice(0, 4).forEach((d) => lines.push(`• ${d.loan.ref} ${name(b, d.loan.clientId)} · ${zar(d.amount)}`))
  } else {
    const next = nextCollectionDay(b.loans, today)
    lines.push(`Nothing collects today.${next ? ` Next collection: ${dateLabel(next)}.` : ''}`)
  }
  if (stale.length) {
    lines.push('', `Needs updating: ${stale.length} past collection${stale.length === 1 ? '' : 's'} still not marked`)
    stale.slice(0, 4).forEach((n) => lines.push(`• ${n.loan.ref} ${name(b, n.loan.clientId)} · due ${dateLabel(n.date)}`))
    if (stale.length > 4) lines.push(`• …and ${stale.length - 4} more`)
  }
  lines.push('', bankLine(b))
  return {
    text: lines.join('\n'),
    alert: stale.length > 0,
    chips: stale.length ? [{ label: 'Update statuses →', action: 'notifications' }] : due.length ? [{ label: 'Open notifications →', action: 'notifications' }] : undefined,
  }
}

function bankLine(b: Book) {
  const p = bankPosition(b)
  return p.derived
    ? `Bank: ${zar(p.balance)} net movement recorded (no opening balance captured yet — set it in Ledger).`
    : `Bank balance: ${zar(p.balance)}`
}

export const QUICK = ["What's due today?", "Who hasn't been updated?", "What's in the bank?", 'Summarise the book']

export function answer(q: string, b: Book, today: string): Reply {
  const s = q.trim().toLowerCase()
  if (!s) return { text: 'Ask me about a loan ref, a client, what is due, overdue accounts, the bank or expenses.' }

  // Loan ref lookup: ECL-095, ecl f01, 095
  const refM = /\becl[-\s]?(f?\d{1,3})\b/i.exec(q)
  if (refM) {
    const want = refM[1].toUpperCase()
    const key = (r: string) => {
      const m = /^(F?)(\d+)$/.exec(r.toUpperCase().replace(/^ECL-/, ''))
      return m ? `${m[1]}${+m[2]}` : r.toUpperCase()
    }
    const l = live(b.loans).find((x) => key(x.ref) === key(want))
    if (!l) return { text: `I can't find loan ECL-${want} on the book.` }
    const st = STATUS_META[effectiveStatus(l, today)].label
    const { no, total } = instalmentNo(l)
    const nd = nextDue(l)
    return {
      text: [
        `${l.ref} · ${name(b, l.clientId)} · ${st}`,
        `Lent ${l.principal == null ? 'not recorded' : zar(l.principal)} at ${l.returnRatePct}% · ${l.schedule.length} × ${zar(l.instalmentAmount)}${l.collectionFee ? ` (debit ${zar(l.instalmentAmount + l.collectionFee)})` : ''}`,
        `Paid ${l.instalmentsPaid}/${l.schedule.length} · outstanding ${zar(outstanding(l))}`,
        nd ? `Next: inst ${no}/${total} on ${dateLabel(nd)}` : 'Fully collected.',
      ].join('\n'),
      chips: [{ label: `Open ${l.ref} →`, action: { loanId: l.id } }],
    }
  }

  if (/due|collect/.test(s) && /today|now/.test(s)) return dueToday(b, today)
  if (/not (been )?updated|hasn'?t been|stale|update|mark/.test(s)) return staleList(b, today)
  if (/bank|balance|cash ?flow/.test(s)) return { text: bankLine(b), chips: [{ label: 'Open Ledger →', action: 'ledger' }] }
  if (/expense|rent|cost/.test(s)) {
    const xs = live(b.expenses)
    return xs.length
      ? { text: [`Monthly office expenses: ${zar(monthlyExpenses(xs))}`, ...xs.map((x) => `• ${x.name} · ${zar(x.amount)}`)].join('\n'), chips: [{ label: 'Open Ledger →', action: 'ledger' }] }
      : { text: 'No monthly expenses captured yet. Add them in Ledger.', chips: [{ label: 'Open Ledger →', action: 'ledger' }] }
  }
  if (/overdue|arrear|late|default/.test(s)) {
    const od = live(b.loans).filter((l) => effectiveStatus(l, today) === 'overdue')
    if (!od.length) return { text: 'No overdue accounts. 👍' }
    const k = kpis(b, today)
    return {
      text: [`${od.length} overdue account${od.length === 1 ? '' : 's'} · ${zar(k.overdueAmount)} past due`, ...od.slice(0, 6).map((l) => `• ${l.ref} ${name(b, l.clientId)} · ${zar(outstanding(l))} outstanding`)].join('\n'),
      chips: [{ label: 'Show overdue loans →', action: 'overdue' }],
    }
  }
  if (/summar|book|portfolio|overview|how are we/.test(s)) return summary(b, today)
  if (/next|upcoming|when/.test(s) && /collect|due|payment/.test(s)) {
    const next = nextCollectionDay(b.loans, today)
    if (!next) return { text: 'Nothing left to collect on the book.' }
    const d = dueOn(b.loans, next)
    return { text: [`Next collection: ${dateLabel(next)} · ${d.length} instalment${d.length === 1 ? '' : 's'} · ${zar(d.reduce((a, x) => a + x.amount, 0))}`, ...d.slice(0, 6).map((x) => `• ${x.loan.ref} ${name(b, x.loan.clientId)} · ${zar(x.amount)}`)].join('\n') }
  }
  if (/top|biggest|largest|exposure/.test(s)) {
    const t = topExposures(b, 5)
    return { text: ['Largest exposures:', ...t.map((x) => `• ${x.client?.name ?? '—'} · ${zar(x.amount)}`)].join('\n') }
  }
  if (/new loan|issue|lend/.test(s)) return { text: 'Opening a new loan for you.', chips: [{ label: 'New loan →', action: 'newLoan' }] }

  // Client name lookup — every word of a client's first/last name that appears in the question
  const words = s.split(/[^a-z]+/).filter((w) => w.length > 2)
  const hit = live(b.clients).find((c) => c.name.toLowerCase().split(/\s+/).some((p) => p.length > 2 && words.includes(p)))
  if (hit) {
    const ls = clientLoans(b.loans, hit.id)
    const open = ls.filter((l) => outstanding(l) > 0)
    return {
      text: [
        `${hit.name} · ${hit.ref}${hit.blocked ? ' · BLOCKED' : ''}`,
        `${ls.length} loan${ls.length === 1 ? '' : 's'} on book · ${open.length} open · ${zar(open.reduce((a, l) => a + outstanding(l), 0))} outstanding`,
        ...open.slice(0, 4).map((l) => `• ${l.ref} · ${STATUS_META[effectiveStatus(l, today)].label} · next ${dateLabel(nextDue(l))}`),
      ].join('\n'),
      chips: [{ label: `Open ${hit.name.split(' ')[0]} →`, action: { clientId: hit.id } }],
    }
  }

  return {
    text: "I can answer from the book: loan refs (e.g. ECL-075), client names, what's due today, who hasn't been updated, overdue accounts, the bank, expenses or a summary. Open-ended questions will come with the server-side assistant — I don't send your book anywhere.",
  }
}

function dueToday(b: Book, today: string): Reply {
  const due = dueOn(b.loans, today)
  if (!due.length) {
    const next = nextCollectionDay(b.loans, today)
    return { text: `Nothing collects today.${next ? ` Next collection: ${dateLabel(next)}.` : ''}` }
  }
  return {
    text: [`${due.length} due today · ${zar(due.reduce((s, d) => s + d.amount, 0))}`, ...due.map((d) => `• ${d.loan.ref} ${name(b, d.loan.clientId)} · inst ${d.no}/${d.total} · ${zar(d.amount)}`)].join('\n'),
    chips: [{ label: 'Update statuses →', action: 'notifications' }],
  }
}

function staleList(b: Book, today: string): Reply {
  const st = notifications(b.loans, today).filter((n) => n.kind === 'stale')
  if (!st.length) return { text: 'Everyone is up to date — every past collection has been marked.' }
  return {
    text: [`${st.length} past collection${st.length === 1 ? '' : 's'} not marked:`, ...st.map((n) => `• ${n.loan.ref} ${name(b, n.loan.clientId)} · due ${dateLabel(n.date)} · ${n.days} day${n.days === 1 ? '' : 's'} ago`)].join('\n'),
    alert: true,
    chips: [{ label: 'Update statuses →', action: 'notifications' }],
  }
}

function summary(b: Book, today: string): Reply {
  const k = kpis(b, today)
  const t = tabTotals(b.loans, today)
  const er = expectedReturn(b.loans)
  return {
    text: [
      `The book on ${dateLabel(today)}:`,
      `• ${k.activeClients} active clients · ${t.all.count} loans`,
      `• Expected return ${zar(er.total)} across ${er.open} open loans (principal ${zar(er.principal)}, interest ${zar(er.interest)})`,
      `• Loaned out this month ${zar(k.loanedOutThisMonth)}`,
      `• Overdue ${zar(k.overdueAmount)} · ${k.overdueAccounts} account${k.overdueAccounts === 1 ? '' : 's'} · ${k.notUpdated} not updated`,
      `• Paid ${t.paid.count} · written off ${t.written_off.count}`,
      `• ${bankLine(b)}`,
    ].join('\n'),
    chips: [{ label: 'Open loans →', action: 'loans' }],
  }
}
