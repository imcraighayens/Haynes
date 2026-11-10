// Pure helpers for the Ledger "accounts need attention" popup.
// The popup lists loans whose saved status is overdue or due today.
// An acknowledgement holds only while that overdue episode is unchanged.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toIso(value) {
  if (value == null || value === '' || value === '—' || value === '-' || value === '–') return '';
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  const lbl = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (!lbl) return '';
  const mi = MONTHS.findIndex(m => m.toLowerCase() === lbl[2].slice(0, 3).toLowerCase());
  if (mi < 0) return '';
  return lbl[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(lbl[1]).padStart(2, '0');
}

export function labelOfIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || !MONTHS[+m[2] - 1]) return '';
  return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
}

function dateList(loan, keys) {
  for (const key of keys) {
    if (Array.isArray(loan && loan[key])) return loan[key].map(toIso).filter(Boolean);
  }
  return [];
}

export function firstMissedDue(loan, todayIso) {
  const today = toIso(todayIso);
  if (!today) return '';
  const paid = new Set(dateList(loan, ['paidDates', 'paid_dates']));
  const missed = dateList(loan, ['sched', 'schedule']).filter(d => d < today && !paid.has(d)).sort();
  if (missed.length) return missed[0];
  const due = toIso(loan && loan.due);
  if (due && due < today && !paid.has(due)) return due;
  return '';
}

export function overdueMarker(loan, todayIso) {
  const status = String(loan && loan.status || '').toLowerCase();
  if (status !== 'overdue' && status !== 'duetoday') return '';
  const missed = status === 'overdue' ? firstMissedDue(loan, todayIso) : toIso(todayIso);
  const at = String((loan && (loan.statusAt || loan.status_at)) || '');
  return status + '|' + missed + '|' + at;
}

function hasSchedule(loan) {
  return dateList(loan, ['sched', 'schedule']).length > 0;
}

// Schedule date when one is saved. An empty schedule uses the failed-debit date,
// then loans.status_at. A dash placeholder is never a date.
export function overdueSince(loan, todayIso) {
  if (hasSchedule(loan)) {
    const missed = firstMissedDue(loan, todayIso);
    if (missed) return missed;
  }
  const debit = toIso(loan && (loan.failedDebit || loan.failed_debit_on));
  if (debit) return debit;
  return toIso(loan && (loan.statusAt || loan.status_at));
}

export function attentionNote(loan, todayIso) {
  if (String(loan && loan.status || '').toLowerCase() === 'duetoday') return 'Due today';
  const since = overdueSince(loan, todayIso);
  const label = since ? labelOfIso(since) : '';
  if (!label) return 'Overdue';
  return 'Overdue since ' + label;
}

export function missedCount(loan, todayIso) {
  const today = toIso(todayIso);
  if (!today) return 0;
  const paid = new Set(dateList(loan, ['paidDates', 'paid_dates']));
  return dateList(loan, ['sched', 'schedule']).filter(d => d < today && !paid.has(d)).length;
}

// Instalment, or instalment times missed dates. Never the principal.
export function attentionAmount(loan, todayIso) {
  const raw = loan && (loan.retAmt != null ? loan.retAmt : loan.instalment_amount);
  const inst = typeof raw === 'number' ? raw : parseFloat(String(raw == null ? '' : raw).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(inst) || inst <= 0) return 0;
  const n = Math.max(1, missedCount(loan, todayIso));
  return Math.round(inst * n * 100) / 100;
}

// The popup follows the status last read from public.loans. Paid and settled leave.
// A browser-only status does not.
export function popupKeeps(serverStatus) {
  const saved = String(serverStatus || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (saved === 'paid' || saved === 'settled' || saved === 'settled_early') return false;
  return saved === 'overdue' || saved === 'duetoday';
}

// The console shows settled_early as paid. That label must not be offered as a
// transition: one click would ask the server to downgrade the loan.
export function statusChoices(dbStatus) {
  const raw = String(dbStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'written_off' || raw === 'writtenoff') return [];
  const all = ['issued', 'duetoday', 'overdue', 'paid'];
  if (raw === 'settled_early' || raw === 'settled') return all.filter(s => s !== 'paid');
  return all;
}

export function statusRefusal(dbStatus, next) {
  const raw = String(dbStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const want = String(next || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (raw === 'written_off' || raw === 'writtenoff') return 'A written-off loan cannot change status.';
  if ((raw === 'settled_early' || raw === 'settled') && want === 'paid') return 'A settled loan cannot be marked paid.';
  return '';
}

// Advance exactly one instalment. The loan is paid only when that step is the last one.
export function nextInstalmentStep(loan, total) {
  const paid = Number(loan && loan.paidInst) || 0;
  const of = Number(total) || 0;
  const instalmentsPaid = paid + 1;
  const done = of > 0 && instalmentsPaid >= of;
  const db = String((loan && loan.dbStatus) || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  let status = 'issued';
  if (done) status = 'paid';
  else if (db === 'overdue') status = 'overdue';
  else if (db === 'duetoday' || db === 'due_today') status = 'duetoday';
  return { instalmentsPaid, status, done };
}

export function attentionHeading(count) {
  const n = Number(count) || 0;
  if (n === 1) return '1 account needs attention';
  return n + ' accounts need attention';
}

export function ackHolds(stored, loan, todayIso) {
  if (typeof stored !== 'string' || !stored) return false;
  const current = overdueMarker(loan, todayIso);
  return !!current && stored === current;
}

const api = { toIso, labelOfIso, firstMissedDue, overdueSince, overdueMarker, attentionNote, attentionAmount, attentionHeading, ackHolds, popupKeeps, missedCount, statusChoices, statusRefusal, nextInstalmentStep };
try { if (typeof window !== 'undefined') window.LedgerAttention = api; } catch (e) {}
