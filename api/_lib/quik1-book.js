// Quik1 view of one Ledger client's loans. Interest is never taken from the rate
// column. Open loans count the full principal. Settled loans put that principal
// back into available. The credit-limit stand-in is the largest principal on file.
import { loanStatusToDb } from './validate.js';

const SETTLED = new Set(['paid', 'settled_early']);

export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function isSettledStatus(status) {
  return SETTLED.has(loanStatusToDb(status) || '');
}

function principalOf(loan) {
  const n = Number(loan && loan.principal);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
}

function isoDate(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function scheduleDates(loan) {
  const raw = loan && loan.schedule;
  if (!Array.isArray(raw)) return [];
  return raw.map(isoDate).filter(Boolean);
}

function instalmentOf(loan) {
  const n = Number(loan && loan.instalment_amount);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
}

function paidDatesOf(loan) {
  const raw = loan && loan.paid_dates;
  if (!Array.isArray(raw)) return [];
  return raw.map(isoDate).filter(Boolean);
}

// Status lines only. A "marked paid" row is a ledger flag, not a collection.
export function statementsFromLoans(loans) {
  const rows = (Array.isArray(loans) ? loans : []).filter(l => l && !l.deleted_at);
  return rows.map(loan => {
    const principal = principalOf(loan);
    const instalment = instalmentOf(loan);
    const lines = [];
    const issued = isoDate(loan.issued_on);
    if (issued) lines.push({ date: issued, label: 'Loan recorded', kind: 'status', amount: principal });
    for (const date of scheduleDates(loan)) {
      lines.push({ date, label: 'Instalment due', kind: 'due', amount: instalment || principal });
    }
    for (const date of paidDatesOf(loan)) {
      lines.push({ date, label: 'Marked paid on the ledger', kind: 'status', amount: 0 });
    }
    return {
      ref: loan.ref || '',
      status: isSettledStatus(loan.status) ? 'settled' : 'open',
      lines
    };
  });
}

export function emptyAccount() {
  return {
    credit_limit: 0,
    outstanding_principal: 0,
    available: 0,
    next_due: null,
    next_debit: 0,
    loans: []
  };
}

export function accountFromLoans(loans) {
  const rows = (Array.isArray(loans) ? loans : []).filter(l => l && !l.deleted_at);
  let credit = 0;
  let outstanding = 0;
  let nextDue = '';
  let nextDebit = 0;
  const view = [];

  for (const loan of rows) {
    const principal = principalOf(loan);
    if (principal > credit) credit = principal;
    const settled = isSettledStatus(loan.status);
    const outP = settled ? 0 : principal;
    outstanding = roundMoney(outstanding + outP);
    const due = scheduleDates(loan).sort()[0] || '';
    if (!settled && due && (!nextDue || due < nextDue)) {
      nextDue = due;
      const inst = Number(loan.instalment_amount);
      nextDebit = Number.isFinite(inst) && inst > 0 ? roundMoney(inst) : outP;
    }
    const paidDates = paidDatesOf(loan);
    view.push({
      id: String(loan.id || ''),
      ref: loan.ref || '',
      principal,
      status: settled ? 'settled' : 'open',
      taken_at: isoDate(loan.issued_on) || null,
      due_date: due || null,
      outstanding_principal: outP,
      purpose: String(loan.purpose || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120),
      instalment: instalmentOf(loan),
      schedule: scheduleDates(loan),
      instalments_paid: Math.max(0, parseInt(loan.instalments_paid, 10) || 0),
      paid_dates: paidDates
    });
  }

  credit = roundMoney(credit);
  outstanding = roundMoney(outstanding);
  return {
    credit_limit: credit,
    outstanding_principal: outstanding,
    available: roundMoney(Math.max(0, credit - outstanding)),
    next_due: nextDue || null,
    next_debit: nextDue ? roundMoney(nextDebit) : 0,
    loans: view
  };
}

// Display fields only. No ID number, phone, email, or account number.
export function publicProfile(client) {
  if (!client || client.deleted_at) return { name: '', bank: '', ref: '' };
  return {
    name: String(client.name || '').trim(),
    bank: String(client.bank || '').trim(),
    ref: String(client.ref || '').trim()
  };
}

export function unidentified() {
  return { identified: false, profile: publicProfile(null), account: emptyAccount() };
}
