// One reading of loans.schedule for Ledger and Quik1.
//
// The stored schedule is the dates still on the row. A date that also appears in
// paid_dates has already been collected. A paid date that is not in the schedule
// is an instalment the row no longer lists (the remaining-dates shape). 
// instalments_paid counts collected instalments. It is not an index into the
// dates that are still open: skipping that many dates hides a debit that is due.
// An empty schedule stays empty. No date is invented.
//
// Server code imports the exports. Loaded in the browser as a module, the same
// functions are published on globalThis.loanSchedule for the Ledger console.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toIsoDate(value) {
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
  if (!loan) return [];
  let raw = null;
  for (const key of keys) {
    if (Array.isArray(loan[key])) { raw = loan[key]; break; }
  }
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const value of raw) {
    const iso = toIsoDate(value);
    if (!iso || seen.has(iso)) continue;
    seen.add(iso);
    out.push(iso);
  }
  return out;
}

function whole(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function paidCountOf(loan) {
  if (!loan) return 0;
  if (loan.instalments_paid != null && loan.instalments_paid !== '') return whole(loan.instalments_paid);
  return whole(loan.paidInst);
}

function priorOf(loan) {
  if (!loan) return 0;
  if (loan.prior_instalments != null && loan.prior_instalments !== '') return whole(loan.prior_instalments);
  return whole(loan.instDone);
}

function statusKey(status) {
  return String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function isClosedStatus(status) {
  const k = statusKey(status);
  return k === 'paid' || k === 'settled' || k === 'settled_early';
}

// Schedule dates that are not already listed in paid_dates, earliest first.
// The paid count is not applied, and loan status does not drop a date.
export function openDates(loan) {
  const schedule = dateList(loan, ['schedule', 'sched']);
  const paid = new Set(dateList(loan, ['paid_dates', 'paidDates']));
  return schedule.filter(d => !paid.has(d)).slice().sort();
}

// Ledger projection: counts, the next open date, and which stored dates are collected.
export function readSchedule(loan) {
  const schedule = dateList(loan, ['schedule', 'sched']);
  const paidDates = dateList(loan, ['paid_dates', 'paidDates']);
  const paidSet = new Set(paidDates);
  const scheduleSet = new Set(schedule);
  const prior = priorOf(loan);
  const paidCount = paidCountOf(loan);
  const closed = isClosedStatus(loan && loan.status);
  const collected = schedule.filter(d => paidSet.has(d));
  const outside = paidDates.filter(d => !scheduleSet.has(d));
  const paidAhead = Math.max(outside.length, Math.max(0, paidCount - collected.length));
  const openStored = schedule.filter(d => !paidSet.has(d));
  const openSorted = openStored.slice().sort();

  if (closed) {
    const n = schedule.length;
    return {
      schedule,
      paidDates,
      prior,
      paidCount,
      closed: true,
      collected: schedule.slice(),
      open: [],
      due: n ? schedule[n - 1] : '',
      nextDue: '',
      paidInst: n,
      paidAhead: 0,
      instTotal: prior + n,
      remaining: 0,
      instNo: prior + Math.max(n, 1),
      promotePaid: false
    };
  }

  const due = openSorted[0] || '';
  const nextDue = openSorted[1] || '';
  const before = due ? schedule.filter(d => d < due).length : 0;
  const remaining = openStored.length;
  const paidInst = collected.length + paidAhead;
  const instTotal = prior + schedule.length + paidAhead;
  const instNo = remaining ? prior + paidAhead + before + 1 : prior + Math.max(schedule.length, 1);
  const key = statusKey(loan && loan.status);
  return {
    schedule,
    paidDates,
    prior,
    paidCount,
    closed: false,
    collected,
    open: openSorted,
    due: remaining ? due : (schedule.length ? schedule[schedule.length - 1] : ''),
    nextDue: remaining ? nextDue : '',
    paidInst,
    paidAhead,
    instTotal,
    remaining,
    instNo,
    // Every stored date is collected, so the console's instNorm would close the loan.
    promotePaid: remaining === 0 && schedule.length > 0 && key !== 'written_off' && key !== 'writtenoff'
  };
}

export function isCollected(loan, value) {
  const iso = toIsoDate(value);
  if (!iso) return false;
  const view = readSchedule(loan);
  return view.collected.includes(iso);
}

const api = { toIsoDate, labelOfIso, isClosedStatus, openDates, readSchedule, isCollected };
globalThis.loanSchedule = api;
