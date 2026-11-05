// Quik1 view of the Ledger book. Ledger rows stay the source of truth.
// Interest is never derived from return_rate_pct. Available ignores interest.
// Open loans count the full principal; settled loans contribute 0 outstanding
// so the original landed principal returns to available.
import { loanStatusToDb } from './validate.js';

const SETTLED = new Set(['paid', 'settled_early']);

export function roundMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

export function isSettledStatus(status) {
  const db = loanStatusToDb(status);
  return SETTLED.has(db);
}

function principalOf(loan) {
  const n = Number(loan && loan.principal);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
}

// Only an explicit interest amount counts. A rate column is not an amount.
export function explicitInterest(loan) {
  if (!loan || loan.interest == null || loan.interest === '') return 0;
  const n = Number(loan.interest);
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
}

function isoDate(v) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

export function scheduleDates(loan) {
  const raw = loan && loan.schedule;
  if (!Array.isArray(raw)) return [];
  return raw.map(isoDate).filter(Boolean);
}

function earliest(dates) {
  return dates.length ? dates.slice().sort()[0] : '';
}

export function emptyAccount() {
  return {
    credit_limit: 0,
    outstanding_principal: 0,
    outstanding_interest: 0,
    total_owed: 0,
    available: 0,
    next_due: null,
    next_debit: 0,
    loans: []
  };
}

// explicitLimit is used only when a caller already has a confirmed limit.
// This module does not invent one; omit it and the stand-in is the largest principal.
export function accountFromLoans(loans, explicitLimit) {
  const rows = (Array.isArray(loans) ? loans : []).filter(l => l && !l.deleted_at);
  let credit = 0;
  let outstanding = 0;
  let interest = 0;
  let nextDue = '';
  let nextDebit = 0;
  const view = [];

  for (const loan of rows) {
    const principal = principalOf(loan);
    if (principal > credit) credit = principal;
    const settled = isSettledStatus(loan.status);
    const outP = settled ? 0 : principal;
    const outI = settled ? 0 : explicitInterest(loan);
    outstanding = roundMoney(outstanding + outP);
    interest = roundMoney(interest + outI);
    const dates = scheduleDates(loan);
    const due = earliest(dates);
    if (!settled && due && (!nextDue || due < nextDue)) {
      nextDue = due;
      const inst = Number(loan.instalment_amount);
      nextDebit = Number.isFinite(inst) && inst > 0 ? roundMoney(inst) : outP;
    }
    view.push({
      id: loan.id || null,
      ref: loan.ref || '',
      principal,
      interest: settled ? 0 : explicitInterest(loan),
      status: settled ? 'settled' : 'open',
      book_status: loanStatusToDb(loan.status) || String(loan.status || ''),
      taken_at: isoDate(loan.issued_on) || null,
      due_date: due || null,
      outstanding_principal: outP,
      outstanding_interest: outI,
      total_due: roundMoney(outP + outI)
    });
  }

  if (explicitLimit != null && explicitLimit !== '') {
    const n = Number(explicitLimit);
    if (Number.isFinite(n) && n >= 0) credit = roundMoney(n);
  } else {
    credit = roundMoney(credit);
  }

  const available = roundMoney(Math.max(0, credit - outstanding));
  return {
    credit_limit: credit,
    outstanding_principal: roundMoney(outstanding),
    outstanding_interest: roundMoney(interest),
    total_owed: roundMoney(outstanding + interest),
    available,
    next_due: nextDue || null,
    next_debit: nextDue ? roundMoney(nextDebit) : 0,
    loans: view
  };
}

const CLIENT_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function validClientId(id) {
  return typeof id === 'string' && CLIENT_ID.test(id);
}

// Display fields only. Never pass through an ID number, phone, email, or account number.
export function publicProfile(client) {
  if (!client) return { name: '', bank: '', ref: '' };
  return {
    name: String(client.name || '').trim(),
    bank: String(client.bank || '').trim(),
    ref: String(client.ref || '').trim()
  };
}

export function unidentified() {
  return { identified: false, profile: publicProfile(null), account: emptyAccount() };
}
