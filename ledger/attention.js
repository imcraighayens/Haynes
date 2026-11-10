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

export function attentionNote(loan, todayIso) {
  if (String(loan && loan.status || '').toLowerCase() === 'duetoday') return 'Due today';
  const missed = firstMissedDue(loan, todayIso);
  if (!missed) return 'Overdue — no due date on file';
  return 'Overdue since ' + labelOfIso(missed);
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

const api = { toIso, labelOfIso, firstMissedDue, overdueMarker, attentionNote, attentionHeading, ackHolds };
try { if (typeof window !== 'undefined') window.LedgerAttention = api; } catch (e) {}
