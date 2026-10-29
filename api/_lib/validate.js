// Column whitelists, enum maps and coercion. Everything written to the database passes through
// `pick(table, row)`: unknown keys are dropped, the NCR/fee settings columns are stripped, and
// values are coerced to the DB's types (ISO dates, numbers, booleans) so PostgREST never sees a
// console label like "25 Jun 2026" or a number as a string.
import { HttpError } from './http.js';

export const COLUMNS = {
  employees: ['id', 'name', 'email', 'role', 'active', 'approval_limit', 'created_at'],
  clients: ['id', 'ref', 'name', 'id_number', 'dob', 'email', 'phone', 'address', 'city', 'province', 'employment', 'employer',
    'job_title', 'tenure', 'net_salary', 'gross_salary', 'other_income', 'expenses', 'bank', 'branch_code', 'account_no',
    'account_type', 'officer_id', 'score', 'blocked', 'contract', 'created_at', 'created_by', 'retain_until', 'deleted_at'],
  loans: ['id', 'ref', 'client_id', 'application_id', 'principal', 'principal_derived', 'return_rate_pct', 'instalment_amount',
    'collection_fee', 'schedule', 'instalments_paid', 'prior_instalments', 'status', 'status_at', 'mandate_id', 'contract_ref',
    'paid_dates', 'purpose', 'issued_on', 'issued_by', 'officer_id', 'created_at', 'written_off_at', 'write_off_reason', 'deleted_at'],
  applications: ['id', 'ref', 'client_id', 'name', 'phone', 'email', 'id_number', 'employer', 'job_title', 'net_income', 'bank',
    'amount', 'term_months', 'purpose', 'source', 'status', 'decline_reason', 'decided_by', 'decided_at', 'loan_id', 'created_at',
    'meta', 'decision'],
  audit_log: ['id', 'at', 'type', 'ref', 'customer', 'amount', 'by', 'comment'],
  petty_cash: ['id', 'date', 'amount', 'category', 'purpose', 'borrower', 'notes', 'status', 'by', 'created_at'],
  expenses: ['id', 'name', 'amount', 'deleted_at'],
  bank_tx: ['id', 'at', 'type', 'amount', 'ref', 'label', 'by'],
  settings: ['id', 'org_name', 'org_legal_name', 'tagline', 'address', 'contact_email', 'contact_phone', 'website',
    'default_return_rate_pct', 'bank_opening_balance', 'bank_opening_at', 'mask_pii', 'contract_intro', 'contract_clauses'],
  ledger_book: ['id', 'payload', 'updated_at', 'updated_by'],
  q1_signups: ['id', 'status', 'name', 'id_number', 'phone', 'email', 'employment', 'employer', 'income', 'payday', 'reviewer',
    'decided_at', 'decided_by', 'note', 'meta', 'created_at'],
  q1_requests: ['id', 'type', 'detail', 'name', 'to', 'status', 'meta', 'created_at'],
  q1_repayments: ['key', 'ok', 'by', 'at']
};

// Never written by the bridge, whatever the client sends (regulatory/fee fields are managed
// outside this integration).
export const SETTINGS_FORBIDDEN = ['ncr_reg_no', 'company_reg_no', 'default_collection_fee', 'protection_fee'];

export const LOAN_STATUS = ['issued', 'overdue', 'paid', 'settled_early', 'written_off'];
export const APPLICATION_STATUS = ['new', 'reviewing', 'approved', 'declined'];
export const PETTY_STATUS = ['PENDING', 'APPROVED', 'REPAID', 'DECLINED'];
export const PETTY_CATEGORY = ['travel', 'office', 'airtime', 'meals', 'advance', 'other'];
export const ROLES = ['admin', 'manager', 'agent', 'collections', 'auditor'];
export const BANK_TX_TYPE = ['in', 'out'];
export const SIGNUP_STATUS = ['Pending review', 'Approved', 'Declined'];

// Loose console/ldb vocabulary → DB enum. Unknown values are dropped by `pick` (key removed) so
// the row keeps its current status instead of failing the whole op on a check constraint.
const LOAN_STATUS_ALIASES = {
  issued: 'issued', active: 'issued', current: 'issued', open: 'issued', running: 'issued', live: 'issued',
  overdue: 'overdue', late: 'overdue', arrears: 'overdue', 'in arrears': 'overdue', defaulted: 'overdue',
  paid: 'paid', closed: 'paid', completed: 'paid', complete: 'paid', 'paid up': 'paid', 'paid in full': 'paid', pif: 'paid',
  settled_early: 'settled_early', settled: 'settled_early', 'settled early': 'settled_early', 'early settlement': 'settled_early',
  written_off: 'written_off', 'written off': 'written_off', writeoff: 'written_off', 'write off': 'written_off', 'write-off': 'written_off', bad_debt: 'written_off'
};
export function loanStatusToDb(v) {
  if (v == null) return undefined;
  const k = String(v).trim().toLowerCase().replace(/[\s-]+/g, ' ');
  return LOAN_STATUS_ALIASES[k] || LOAN_STATUS_ALIASES[k.replace(/ /g, '_')] || undefined;
}
export function applicationStatusToDb(v) {
  if (v == null) return undefined;
  const k = String(v).trim().toLowerCase();
  if (APPLICATION_STATUS.includes(k)) return k;
  if (/^needs|^pending|^new/.test(k)) return 'new';
  if (/review|info|docs/.test(k)) return 'reviewing';
  if (/approv|accept/.test(k)) return 'approved';
  if (/declin|reject|cancel/.test(k)) return 'declined';
  return undefined;
}
// DB status → what the Quik1 app displays.
export function quik1StatusLabel(status) {
  switch (String(status || '').toLowerCase()) {
    case 'approved': return 'Approved';
    case 'declined': return 'Declined';
    default: return 'Needs decision';
  }
}

// ---- coercion -----------------------------------------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

export function num(v, dflt = 0) {
  if (v == null || v === '') return dflt;
  if (typeof v === 'number') return Number.isFinite(v) ? v : dflt;
  const n = Number(String(v).replace(/[R\s,]/g, ''));
  return Number.isFinite(n) ? n : dflt;
}
export function int(v, dflt = 0) {
  const n = num(v, NaN);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}
export function bool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}
export function str(v, dflt = '') {
  if (v == null) return dflt;
  const s = String(v);
  return s.length > 4000 ? s.slice(0, 4000) : s;
}

// Parses ISO, epoch ms, or console labels such as "25 Jun 2026" / "25 Jun 2026, 14:03".
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') { const d = new Date(v < 1e11 ? v * 1000 : v); return Number.isNaN(d.getTime()) ? null : d; }
  const s = String(v).trim();
  if (/^\d{10,13}$/.test(s)) return parseDate(Number(s));
  const m = /^(\d{1,2})\s+([A-Za-z]{3,4})\.?\s+(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()] != null) {
    const d = new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function toIsoDate(v) { const d = parseDate(v); return d ? d.toISOString().slice(0, 10) : null; }
export function toIsoTs(v) { const d = parseDate(v); return d ? d.toISOString() : null; }
export function toMs(v) { const d = parseDate(v); return d ? d.getTime() : null; }

const NUMERIC = new Set(['net_salary', 'gross_salary', 'other_income', 'principal', 'principal_derived', 'return_rate_pct',
  'instalment_amount', 'collection_fee', 'amount', 'net_income', 'approval_limit', 'bank_opening_balance', 'default_return_rate_pct', 'income']);
const INTEGER = new Set(['instalments_paid', 'prior_instalments', 'score', 'term_months']);
const BOOLEAN = new Set(['blocked', 'active', 'mask_pii', 'ok']);
const DATE_ONLY = new Set(['dob', 'retain_until', 'issued_on', 'date']);
const TIMESTAMP = new Set(['created_at', 'deleted_at', 'status_at', 'written_off_at', 'decided_at', 'at', 'bank_opening_at', 'updated_at']);
const JSONB = new Set(['expenses', 'contract', 'schedule', 'paid_dates', 'meta', 'decision', 'payload', 'contract_clauses']);
const ENUM = {
  'loans.status': loanStatusToDb,
  'applications.status': applicationStatusToDb,
  'employees.role': v => { const k = String(v || '').toLowerCase(); return ROLES.includes(k) ? k : undefined; },
  'petty_cash.status': v => { const k = String(v || '').toUpperCase(); return PETTY_STATUS.includes(k) ? k : undefined; },
  'petty_cash.category': v => { const k = String(v || '').toLowerCase(); return PETTY_CATEGORY.includes(k) ? k : 'other'; },
  'bank_tx.type': v => { const k = String(v || '').toLowerCase(); return BANK_TX_TYPE.includes(k) ? k : undefined; },
  'q1_signups.status': v => SIGNUP_STATUS.includes(v) ? v : undefined
};

function coerceJson(v, col) {
  if (v == null) return null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (col === 'schedule' || col === 'paid_dates') return Array.isArray(v) ? v.map(toIsoDate).filter(Boolean) : [];
  return typeof v === 'object' ? v : null;
}

export function coerce(table, col, v) {
  const enumFn = ENUM[`${table}.${col}`];
  if (enumFn) return enumFn(v);
  if (col === 'id' || col === 'key') return v == null ? undefined : str(v).slice(0, 120);
  if (NUMERIC.has(col)) return v == null ? null : num(v, null);
  if (INTEGER.has(col)) return v == null ? null : int(v, null);
  if (BOOLEAN.has(col)) return bool(v);
  if (DATE_ONLY.has(col)) return toIsoDate(v);
  if (TIMESTAMP.has(col)) return toIsoTs(v);
  if (JSONB.has(col)) return coerceJson(v, col);
  return v == null ? null : str(v);
}

// Whitelisted, coerced copy of a row. Keys with `undefined` values (unknown enum values,
// unparsable ids) are omitted, so an upsert leaves the stored value untouched.
export function pick(table, row) {
  const cols = COLUMNS[table];
  if (!cols) throw new HttpError(400, `Unknown table ${table}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HttpError(400, 'Row must be an object');
  const out = {};
  for (const col of cols) {
    if (!(col in row)) continue;
    if (table === 'settings' && SETTINGS_FORBIDDEN.includes(col)) continue; // belt and braces; not in COLUMNS either
    const v = coerce(table, col, row[col]);
    if (v !== undefined) out[col] = v;
  }
  return out;
}

export function requireId(row, label = 'id') {
  const id = row && row[label];
  if (typeof id !== 'string' || !id.trim()) throw new HttpError(400, `Row needs a string ${label}`);
  return id.trim();
}

// ---- public-route helpers -----------------------------------------------------------------------
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
export function isSafeId(v) { return typeof v === 'string' && SAFE_ID.test(v); }
export function wellFormedClientId(v, prefix) {
  return typeof v === 'string' && new RegExp(`^${prefix}_[0-9a-f]{12}$`).test(v) ? v : null;
}
export function cleanText(v, max = 200) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
export function cleanPhone(v) {
  const s = cleanText(v, 32);
  const digits = s.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? s : '';
}
export function cleanEmail(v) {
  const s = cleanText(v, 160);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 50_000;
export function parseAmount(v) {
  const n = num(v, NaN);
  if (!Number.isFinite(n) || n < AMOUNT_MIN || n > AMOUNT_MAX) throw new HttpError(400, `amount must be a number between ${AMOUNT_MIN} and ${AMOUNT_MAX}`);
  return Math.round(n * 100) / 100;
}
// "3 mo" | "3" | 3 → 3; anything unparsable → 1 (the app's own default).
export function parseTerm(v) {
  const n = parseInt(String(v == null ? '' : v).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 60);
}
