// ledjaa-db.js — LedjaaDB adapter for the hosted LEDGER console.
//
// Same public surface as ledger/original/ldbStandalone.local.js (the console imports
// `m.db`, calls table/setActor/toConsoleState/find/insert/update/rows/softDelete), but
// the rows come from the shared Supabase database through /api/ledger instead of a
// demo seed. Every local mutation is also queued as a sync op and POSTed to
// /api/ledger/sync (debounced, retried with backoff, queue persisted in localStorage).
//
// Loaded with a dynamic import() by the console's initDb(); the top-level `await`
// at the bottom guarantees the cloud rows are in memory before that import resolves.
// No demo data ever: cloud → localStorage cache → empty tables.

export const SEED_CLIENTS = [];
export const SEED_LOANS = [];

export const STORE_KEY = 'ledjaa.db.v3';
export const QUEUE_KEY = 'ledjaa.db.queue';
export const CFG_KEY = 'ledjaa.supabase';

// ---- SCHEMA / ROLES / PERMISSIONS: copied verbatim from ldbStandalone.local.js so
// ---- meta() and can() behave exactly as before.
const T = (name, label, group, columns, opts = {}) => ({ name, label, group, pk: 'id', columns, ...opts });
const c = (name, type, opts = {}) => ({ name, type, ...opts });

export const SCHEMA = {
  version: '1.7.0',
  tables: [
    T('branches', 'Branches', 'Org', [
      c('id', 'text', { pk: true }), c('code', 'text', { unique: true }), c('name', 'text'),
      c('city', 'text'), c('province', 'enum', { options: ['Gauteng', 'North West', 'Free State', 'Limpopo', 'Mpumalanga', 'Western Cape', 'Eastern Cape', 'KwaZulu-Natal', 'Northern Cape'] }),
      c('ncr_reg_no', 'text', { note: 'NCR credit provider registration' }), c('active', 'boolean', { default: true })
    ]),
    T('users', 'Users & roles', 'Org', [
      c('id', 'text', { pk: true }), c('name', 'text'), c('email', 'text', { unique: true }),
      c('role', 'enum', { options: ['admin', 'manager', 'agent', 'collections', 'auditor', 'client'] }),
      c('branch_id', 'text', { ref: 'branches.id', nullable: true }),
      c('client_id', 'text', { ref: 'clients.id', nullable: true, note: 'set for portal logins only' }),
      c('approval_limit', 'money', { default: 0, note: 'maximum loan this user may sign off; 0 = no approval authority' }),
      c('created_at', 'timestamp', { note: 'date the account was opened' }),
      c('active', 'boolean', { default: true }), c('last_login_at', 'timestamp', { nullable: true }),
      c('relogin_required_at', 'timestamp', { nullable: true, note: 'set to force a fresh sign-in on next load' })
    ]),
    T('clients', 'Clients', 'Lending', [
      c('id', 'text', { pk: true }), c('ref', 'text', { unique: true }), c('name', 'text'),
      c('id_number', 'text', { note: 'SA ID — POPIA special personal information' }), c('dob', 'date', { nullable: true }),
      c('email', 'text', { nullable: true }), c('phone', 'text', { nullable: true }),
      c('address', 'text', { nullable: true }), c('city', 'text', { nullable: true }), c('province', 'text', { nullable: true }),
      c('employment', 'text', { nullable: true }), c('employer', 'text', { nullable: true }), c('job_title', 'text', { nullable: true }),
      c('tenure', 'text', { nullable: true }), c('net_salary', 'money', { default: 0 }),
      c('bank', 'text', { nullable: true }), c('branch_code', 'text', { nullable: true }),
      c('account_no', 'text', { nullable: true }), c('account_type', 'text', { nullable: true }),
      c('officer_id', 'text', { ref: 'users.id', nullable: true }), c('branch_id', 'text', { ref: 'branches.id', nullable: true }),
      c('score', 'int', { default: 0 }), c('created_at', 'timestamp'),
      c('retain_until', 'date', { note: 'FICA/NCA: 5 years after last transaction' }),
      c('deleted_at', 'timestamp', { nullable: true, note: 'soft delete only — records are never hard-deleted' })
    ], { retention: '5 years after final settlement (NCA s170 / FICA s23)' }),
    T('consents', 'Consents', 'Compliance', [
      c('id', 'text', { pk: true }), c('client_id', 'text', { ref: 'clients.id' }),
      c('purpose', 'enum', { options: ['credit_check', 'marketing', 'data_processing', 'debit_order', 'employer_verification'] }),
      c('granted', 'boolean'), c('channel', 'enum', { options: ['written', 'ussd', 'portal', 'verbal_recorded'] }),
      c('granted_at', 'timestamp'), c('withdrawn_at', 'timestamp', { nullable: true }),
      c('evidence_document_id', 'text', { ref: 'documents.id', nullable: true })
    ], { retention: 'Life of relationship + 5 years (POPIA s14)' }),
    T('documents', 'Documents & KYC', 'Compliance', [
      c('id', 'text', { pk: true }), c('client_id', 'text', { ref: 'clients.id' }),
      c('kind', 'enum', { options: ['id_document', 'proof_of_address', 'payslip', 'bank_statement', 'signed_agreement', 'other'] }),
      c('filename', 'text'), c('mime', 'text'), c('bytes', 'int'),
      c('verified', 'boolean', { default: false }), c('verified_by', 'text', { ref: 'users.id', nullable: true }),
      c('uploaded_at', 'timestamp'), c('retain_until', 'date'), c('deleted_at', 'timestamp', { nullable: true })
    ]),
    T('applications', 'Loan applications', 'Lending', [
      c('id', 'text', { pk: true }), c('ref', 'text', { unique: true }), c('client_id', 'text', { ref: 'clients.id' }),
      c('amount_requested', 'money'), c('term_months', 'int'), c('purpose', 'text'),
      c('status', 'enum', { options: ['draft', 'submitted', 'affordability_review', 'approved', 'declined', 'withdrawn'] }),
      c('affordability_net', 'money', { nullable: true }), c('affordability_disposable', 'money', { nullable: true }),
      c('dti_ratio', 'float', { nullable: true }), c('decline_reason', 'text', { nullable: true }),
      c('captured_by', 'text', { ref: 'users.id' }), c('decided_by', 'text', { ref: 'users.id', nullable: true }),
      c('created_at', 'timestamp'), c('decided_at', 'timestamp', { nullable: true }),
      c('loan_id', 'text', { ref: 'loans.id', nullable: true, note: 'set once disbursed' })
    ]),
    T('loans', 'Loans', 'Lending', [
      c('id', 'text', { pk: true }), c('ref', 'text', { unique: true }), c('client_id', 'text', { ref: 'clients.id' }),
      c('application_id', 'text', { ref: 'applications.id', nullable: true }),
      c('principal', 'money'), c('return_rate_pct', 'float', { default: 35, note: 'simple, not compound' }),
      c('term_months', 'int', { default: 1 }), c('instalment', 'money', { note: 'fixed instalment, fixed term' }),
      c('mandate_id', 'text', { nullable: true, note: 'debit-order mandate this loan collects on' }),
      c('schedule', 'json', { note: 'every instalment action date, earliest first' }),
      c('instalments_paid', 'int', { default: 0, note: 'schedule index of the next instalment due' }),
      c('initiation_fee', 'money', { default: 0 }), c('service_fee', 'money', { default: 0 }),
      c('purpose', 'text'), c('status', 'enum', { options: ['issued', 'duetoday', 'overdue', 'paid', 'settled_early', 'restructured', 'written_off'] }),
      c('disbursed_on', 'date', { nullable: true }), c('due_date', 'date'),
      c('parent_loan_id', 'text', { ref: 'loans.id', nullable: true, note: 'set on top-up or restructure — chains the history' }),
      c('relation', 'enum', { options: ['original', 'top_up', 'restructure'], default: 'original' }),
      c('written_off_at', 'timestamp', { nullable: true }), c('write_off_reason', 'text', { nullable: true }),
      c('written_off_by', 'text', { ref: 'users.id', nullable: true }),
      c('officer_id', 'text', { ref: 'users.id', nullable: true }), c('branch_id', 'text', { ref: 'branches.id', nullable: true }),
      c('created_at', 'timestamp'), c('deleted_at', 'timestamp', { nullable: true })
    ], { note: 'One client may hold several concurrent loans. Restructures and top-ups create a new row linked by parent_loan_id — the original is never overwritten.' }),
    T('mandates', 'Debit order mandates', 'Collections', [
      c('id', 'text', { pk: true }), c('client_id', 'text', { ref: 'clients.id' }),
      c('loan_id', 'text', { ref: 'loans.id', nullable: true }),
      c('bank', 'text'), c('branch_code', 'text'), c('account_no', 'text'),
      c('account_type', 'enum', { options: ['Savings Account', 'Chequing Account', 'Transmission'] }),
      c('collection_day', 'int', { note: '1–31, or 0 for salary date' }), c('amount', 'money'),
      c('scheme', 'enum', { options: ['DebiCheck', 'EFT', 'NAEDO'] }),
      c('status', 'enum', { options: ['pending', 'registered', 'suspended', 'cancelled', 'rejected'] }),
      c('mandate_ref', 'text', { unique: true, nullable: true }), c('authenticated_at', 'timestamp', { nullable: true }),
      c('consent_id', 'text', { ref: 'consents.id', nullable: true })
    ]),
    T('payments', 'Payments & receipts', 'Collections', [
      c('id', 'text', { pk: true }), c('receipt_no', 'text', { unique: true }),
      c('loan_id', 'text', { ref: 'loans.id' }), c('client_id', 'text', { ref: 'clients.id' }),
      c('amount', 'money'), c('paid_on', 'date'),
      c('method', 'enum', { options: ['debit_order', 'eft', 'cash', 'card', 'payroll_deduction'] }),
      c('allocation', 'enum', { options: ['fees', 'interest', 'principal', 'mixed'], note: 'NCA s126 order: fees, then interest, then principal' }),
      c('partial', 'boolean', { default: false }),
      c('status', 'enum', { options: ['cleared', 'pending', 'reversed', 'unpaid_insufficient_funds', 'disputed'] }),
      c('reversed_at', 'timestamp', { nullable: true }), c('reversal_reason', 'text', { nullable: true }),
      c('reverses_payment_id', 'text', { ref: 'payments.id', nullable: true }),
      c('captured_by', 'text', { ref: 'users.id' }), c('created_at', 'timestamp')
    ], { note: 'Reversals are new rows pointing at the original, not edits. A loan balance is the sum of cleared payments, never a stored field.' }),
    T('settlement_letters', 'Settlement letters issued', 'Lending', [
      c('id', 'text', { pk: true }), c('letter_no', 'text', { unique: true }),
      c('loan_id', 'text', { ref: 'loans.id' }), c('client_id', 'text', { ref: 'clients.id' }),
      c('kind', 'enum', { options: ['settlement_quotation', 'paid_up_letter'] }),
      c('principal_outstanding', 'money'), c('tpf', 'money'), c('early_termination_charge', 'money'), c('total', 'money'),
      c('issued_on', 'date'), c('expires_on', 'date', { note: '5 business days — NCA s125' }),
      c('verify_code', 'text', { unique: true }), c('issued_by', 'text', { ref: 'users.id' })
    ]),
    T('fees_config', 'Fees / TPF config', 'Config', [
      c('id', 'text', { pk: true }), c('key', 'text', { unique: true }), c('label', 'text'),
      c('value', 'money'), c('unit', 'enum', { options: ['ZAR', 'percent'] }),
      c('effective_from', 'date'), c('effective_to', 'date', { nullable: true, note: 'null = current' }),
      c('authority', 'text', { note: 'e.g. NCA Reg 42 cap' })
    ], { note: 'Rates are versioned by date, never overwritten — a loan is always priced by the row effective on its disbursement date.' }),
    T('notifications', 'Notifications', 'Ops', [
      c('id', 'text', { pk: true }), c('client_id', 'text', { ref: 'clients.id', nullable: true }),
      c('loan_id', 'text', { ref: 'loans.id', nullable: true }),
      c('channel', 'enum', { options: ['sms', 'email', 'whatsapp', 'in_app'] }),
      c('template', 'text'), c('body', 'text'),
      c('status', 'enum', { options: ['queued', 'sent', 'delivered', 'failed'] }),
      c('provider_ref', 'text', { nullable: true }), c('sent_at', 'timestamp', { nullable: true }),
      c('sent_by', 'text', { ref: 'users.id', nullable: true })
    ]),
    T('audit_log', 'Audit log', 'Compliance', [
      c('id', 'text', { pk: true }), c('at', 'timestamp'), c('actor_id', 'text', { ref: 'users.id' }),
      c('actor_role', 'text'), c('action', 'enum', { options: ['insert', 'update', 'soft_delete', 'restore', 'login', 'export', 'print'] }),
      c('table_name', 'text'), c('row_id', 'text'), c('summary', 'text'),
      c('diff', 'json', { nullable: true, note: 'changed fields only' })
    ], { append_only: true, note: 'Append-only. No update or delete path exists in the data layer.' }),
    T('row_versions', 'Row versions', 'Compliance', [
      c('id', 'text', { pk: true }), c('table_name', 'text'), c('row_id', 'text'),
      c('version', 'int'), c('at', 'timestamp'), c('actor_id', 'text', { ref: 'users.id' }),
      c('snapshot', 'json', { note: 'full state of the row before the change' })
    ], { append_only: true, note: 'Every prior state of every row. Point-in-time reconstruction is a filter on this table.' })
  ]
};

export const ROLES = [
  { id: 'admin', label: 'Administrator', blurb: 'Unrestricted. Configuration, users, write-offs, retention.' },
  { id: 'manager', label: 'Manager', blurb: 'Approves loans and write-offs. Reads everything.' },
  { id: 'agent', label: 'Loan officer', blurb: 'Captures clients and applications. No approvals.' },
  { id: 'collections', label: 'Collections', blurb: 'Payments, mandates, arrears. No new lending.' },
  { id: 'auditor', label: 'Auditor', blurb: 'Read-only across the whole database, including versions.' },
  { id: 'client', label: 'Client (portal)', blurb: 'Own records only. Statements and settlement letters.' }
];

const ALL = SCHEMA.tables.map(t => t.name);
const R = 'read', C = 'create', U = 'update', D = 'delete', A = 'approve';
const grid = {};
ALL.forEach(t => { grid[t] = { admin: [R, C, U, D, A] }; });
const set = (role, table, ops) => { if (grid[table]) grid[table][role] = ops; };
ALL.forEach(t => { set('manager', t, [R]); set('auditor', t, [R]); set('agent', t, []); set('collections', t, []); set('client', t, []); });
[['clients', [R, C, U]], ['applications', [R, C, U]], ['documents', [R, C, U]], ['consents', [R, C]], ['loans', [R]], ['payments', [R]], ['notifications', [R, C]], ['mandates', [R, C]], ['settlement_letters', [R]], ['audit_log', [R]], ['users', [R]], ['branches', [R]], ['fees_config', [R]]]
  .forEach(([t, ops]) => set('agent', t, ops));
[['payments', [R, C, U]], ['mandates', [R, C, U]], ['loans', [R]], ['clients', [R]], ['notifications', [R, C]], ['settlement_letters', [R, C]], ['audit_log', [R]], ['users', [R]], ['branches', [R]], ['fees_config', [R]], ['documents', [R]], ['applications', [R]]]
  .forEach(([t, ops]) => set('collections', t, ops));
[['loans', [R, U, A]], ['applications', [R, U, A]], ['payments', [R, U]], ['settlement_letters', [R, C]], ['notifications', [R, C]]]
  .forEach(([t, ops]) => set('manager', t, ops));
[['clients', [R, U]], ['loans', [R]], ['payments', [R]], ['settlement_letters', [R, C]], ['documents', [R, C]], ['consents', [R, C, U]], ['notifications', [R]], ['mandates', [R]]]
  .forEach(([t, ops]) => set('client', t, ops));
grid.audit_log.manager = [R]; grid.audit_log.client = [];
grid.row_versions.manager = [R]; grid.row_versions.agent = []; grid.row_versions.collections = []; grid.row_versions.client = [];
export const PERMISSIONS = grid;

// ---------------------------------------------------------------------------
// Environment helpers (the module also runs under node --test with stubs)
// ---------------------------------------------------------------------------
const W = (typeof window !== 'undefined') ? window : globalThis;
function storage() {
  try { if (typeof localStorage !== 'undefined') return localStorage; } catch (e) { }
  try { return W.localStorage || null; } catch (e) { return null; }
}
function lsGet(key) { try { const s = storage(); return s ? s.getItem(key) : null; } catch (e) { return null; } }
function lsSet(key, value) { try { const s = storage(); if (s) s.setItem(key, value); return true; } catch (e) { return false; } }
function lsDel(key) { try { const s = storage(); if (s) s.removeItem(key); } catch (e) { } }
function readCfg() {
  try { const cfg = JSON.parse(lsGet(CFG_KEY) || 'null'); return cfg && typeof cfg === 'object' ? cfg : {}; } catch (e) { return {}; }
}
function apiBase(cfg) { return String(cfg.url || '').replace(/\/+$/, ''); }
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function same(a, b) { return a === b || (a != null && b != null && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)); }
function timer(fn, ms) { const t = setTimeout(fn, ms); if (t && typeof t.unref === 'function') t.unref(); return t; }
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Vocabulary: dates and statuses, both directions
// ---------------------------------------------------------------------------
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ISO '2026-06-25' (or a timestamp) → console label '25 Jun 2026' (unpadded day, like the
// console's own brLabel/todayLabel). Anything unparseable → '—'.
export function labelOf(d) {
  if (!d) return '—';
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return (+m[3]) + ' ' + MN[+m[2] - 1] + ' ' + m[1];
  return isoOf(s) ? labelOf(isoOf(s)) : s;
}

// Console label / ISO / Date / epoch → ISO date 'YYYY-MM-DD' or null.
export function isoOf(d) {
  if (d == null || d === '' || d === '—') return null;
  if (d instanceof Date) return isNaN(d) ? null : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (typeof d === 'number') return isoOf(new Date(d));
  const s = String(d).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  const lbl = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
  if (lbl) {
    const mi = MN.findIndex(x => x.toLowerCase() === lbl[2].toLowerCase());
    if (mi < 0) return null;
    return lbl[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(lbl[1]).padStart(2, '0');
  }
  return null;
}
// Timestamp columns: keep a full ISO timestamp when we have one, else midnight of the date.
function tsOf(d) {
  if (d == null || d === '' || d === '—') return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(d)) return d;
  const iso = isoOf(d); return iso ? iso + 'T00:00:00.000Z' : null;
}
function num(v, dflt = 0) { if (v == null || v === '') return dflt; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, '')); return isNaN(n) ? dflt : n; }
function intOf(v, dflt = 0) { return Math.round(num(v, dflt)); }

export const DB_LOAN_STATUSES = ['issued', 'overdue', 'paid', 'settled_early', 'written_off'];
const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/[\s-]+/g, '_');

// Console vocabulary → DB enum. `prev` is the row's current DB status: the console has no
// "settled early" state (it shows those as paid), so a 'paid' coming back must not
// downgrade a settled_early row.
export function statusToDb(s, prev) {
  const k = norm(s);
  if (k === 'written_off' || k === 'writtenoff') return 'written_off';
  if (k === 'settled_early' || k === 'settled' || k === 'settledearly') return 'settled_early';
  if (k === 'paid') return prev === 'settled_early' ? 'settled_early' : 'paid';
  if (k === 'overdue') return 'overdue';
  if (DB_LOAN_STATUSES.includes(k)) return k;
  return 'issued'; // issued, duetoday, restructured, active, '' …
}
// DB enum → console vocabulary (statusMeta/instNorm/bucketOf compare these exact strings).
export function statusToConsole(s) {
  const k = norm(s);
  if (k === 'written_off' || k === 'writtenoff') return 'written off';
  if (k === 'settled_early' || k === 'settled') return 'paid';
  if (k === 'due_today' || k === 'duetoday') return 'duetoday';
  if (k === 'issued' || k === 'overdue' || k === 'paid') return k;
  return k ? k.replace(/_/g, ' ') : 'issued';
}
const ROLE_ENUM = ['admin', 'manager', 'agent', 'collections', 'auditor'];
function roleToDb(r) {
  const k = String(r || '').trim().toLowerCase();
  if (k.startsWith('admin')) return 'admin';
  if (k.startsWith('manager')) return 'manager';
  if (k.startsWith('collect')) return 'collections';
  if (k.startsWith('audit')) return 'auditor';
  return ROLE_ENUM.includes(k) ? k : 'agent';
}

// ---------------------------------------------------------------------------
// Live column whitelists: what /api/ledger/sync accepts for the tables this adapter owns.
// Anything else (ldb-only columns like due_date, branch_id, blocked_at …) stays local.
// ---------------------------------------------------------------------------
export const LIVE_TABLE = { users: 'employees', clients: 'clients', loans: 'loans', applications: 'applications' };
export const LIVE_COLUMNS = {
  employees: ['id', 'name', 'email', 'role', 'active', 'approval_limit', 'created_at'],
  clients: ['id', 'ref', 'name', 'id_number', 'dob', 'email', 'phone', 'address', 'city', 'province', 'employment', 'employer',
    'job_title', 'tenure', 'net_salary', 'gross_salary', 'other_income', 'expenses', 'bank', 'branch_code', 'account_no',
    'account_type', 'officer_id', 'score', 'blocked', 'contract', 'created_at', 'created_by', 'retain_until', 'deleted_at'],
  loans: ['id', 'ref', 'client_id', 'application_id', 'principal', 'principal_derived', 'return_rate_pct', 'instalment_amount',
    'collection_fee', 'schedule', 'instalments_paid', 'prior_instalments', 'status', 'status_at', 'mandate_id', 'contract_ref',
    'paid_dates', 'purpose', 'issued_on', 'issued_by', 'officer_id', 'created_at', 'written_off_at', 'write_off_reason', 'deleted_at'],
  applications: ['id', 'ref', 'client_id', 'name', 'phone', 'email', 'id_number', 'employer', 'job_title', 'net_income', 'bank',
    'amount', 'term_months', 'purpose', 'source', 'status', 'decline_reason', 'decided_by', 'decided_at', 'loan_id', 'created_at', 'meta', 'decision']
};
// ldb v1.7 column name → live column name (per table)
const RENAME = { loans: { instalment: 'instalment_amount', employee_id: 'officer_id' } };

// Translate a console/ldb patch into live column names + DB value types. Unknown columns are
// dropped. `prev` is the current row (for status normalisation and derived timestamps).
export function toLive(name, patch, prev) {
  const live = LIVE_TABLE[name]; if (!live) return {};
  const ren = RENAME[name] || {}, cols = LIVE_COLUMNS[live], out = {};
  Object.keys(patch || {}).forEach(k => {
    const key = ren[k] || k;
    if (!cols.includes(key) || patch[k] === undefined) return;
    out[key] = patch[k];
  });
  if (name === 'loans') {
    if ('status' in out) {
      out.status = statusToDb(out.status, prev && prev.status);
      if (prev && prev.status !== out.status) {
        out.status_at = nowIso();
        if (out.status === 'written_off' && !prev.written_off_at) out.written_off_at = nowIso();
      }
    }
    if ('schedule' in out) out.schedule = Array.isArray(out.schedule) ? out.schedule.map(isoOf).filter(Boolean) : [];
    if ('paid_dates' in out) out.paid_dates = Array.isArray(out.paid_dates) ? out.paid_dates.map(isoOf).filter(Boolean) : [];
    if ('issued_on' in out) out.issued_on = isoOf(out.issued_on);
    if ('written_off_at' in out) out.written_off_at = tsOf(out.written_off_at);
    ['principal', 'return_rate_pct', 'instalment_amount', 'collection_fee'].forEach(k => { if (k in out && out[k] != null) out[k] = num(out[k]); });
    ['instalments_paid', 'prior_instalments'].forEach(k => { if (k in out) out[k] = intOf(out[k]); });
    // dbPush sends employee_id/issued_by/mandate_id as `console value || row value || null`;
    // a null must never wipe an assignment the console simply did not carry.
    ['officer_id', 'issued_by', 'mandate_id', 'issued_on'].forEach(k => { if (k in out && out[k] == null && prev && prev[k] != null) delete out[k]; });
  }
  if (name === 'clients') {
    if ('dob' in out) out.dob = isoOf(out.dob);
    if ('retain_until' in out) out.retain_until = isoOf(out.retain_until);
    if ('net_salary' in out) out.net_salary = num(out.net_salary);
    if ('gross_salary' in out && out.gross_salary != null) out.gross_salary = num(out.gross_salary);
    if ('other_income' in out && out.other_income != null) out.other_income = num(out.other_income);
    if ('score' in out) out.score = intOf(out.score);
    if ('blocked' in out) out.blocked = !!out.blocked;
  }
  if (name === 'users') {
    if ('role' in out) out.role = roleToDb(out.role);
    if ('active' in out) out.active = out.active !== false && String(out.active).toUpperCase() !== 'DISABLED';
    if ('approval_limit' in out) out.approval_limit = num(out.approval_limit);
  }
  if (name === 'applications') {
    if ('amount' in out) out.amount = num(out.amount);
    if ('term_months' in out) out.term_months = Math.max(1, intOf(out.term_months, 1));
  }
  ['created_at', 'deleted_at', 'decided_at', 'status_at'].forEach(k => { if (k in out) out[k] = tsOf(out[k]); });
  return out;
}
// A full row reduced to its live columns (what an upsert carries).
export function liveRow(name, row) {
  const live = LIVE_TABLE[name]; if (!live || !row) return null;
  const out = {}; LIVE_COLUMNS[live].forEach(k => { if (row[k] !== undefined) out[k] = row[k]; });
  return out;
}

// ---------------------------------------------------------------------------
// Row → console state (the vocabulary the frozen console reads)
// ---------------------------------------------------------------------------
const dash = v => (v == null || v === '') ? '—' : v;
const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', agent: 'Loan Officer', collections: 'Collections', auditor: 'Auditor' };

export function clientToConsole(row, officerName) {
  const ex = row.expenses && typeof row.expenses === 'object' ? row.expenses : {};
  const out = {
    id: row.id, ref: row.ref, name: row.name, idFull: dash(row.id_number), dob: dash(row.dob),
    added: labelOf(String(row.created_at || '').slice(0, 10)),
    email: dash(row.email), phone: dash(row.phone), address: dash(row.address), city: dash(row.city), province: dash(row.province),
    employment: dash(row.employment), employer: dash(row.employer), jobTitle: dash(row.job_title), tenure: dash(row.tenure),
    netSalary: num(row.net_salary), bank: dash(row.bank), branchCode: dash(row.branch_code), account: dash(row.account_no),
    accountType: dash(row.account_type), employee: officerName || 'Unassigned', score: intOf(row.score),
    blocked: !!row.blocked, blockedAt: row.blocked_at || null
  };
  if (row.gross_salary != null) out.grossSalary = num(row.gross_salary);
  if (row.other_income != null) out.otherIncome = num(row.other_income);
  if (ex.rent != null) out.expRent = num(ex.rent);
  if (ex.transport != null) out.expTransport = num(ex.transport);
  if (ex.groceries != null) out.expFood = num(ex.groceries);
  if (ex.otherDebt != null) out.expDebt = num(ex.otherDebt);
  if (ex.other != null) out.expOther = num(ex.other);
  // The console keeps its own contract record; offer the stored one only when it exists.
  if (row.contract && typeof row.contract === 'object' && row.contract.no) {
    out.contract = { no: row.contract.no, signedOn: row.contract.signedOn ? labelOf(row.contract.signedOn) : out.added, sig: row.contract.signature || row.contract.sig || null };
  }
  return out;
}

// Mirrors the console's instNorm() so instSync() finds nothing to change on first render.
export function loanToConsole(row) {
  const schedIso = Array.isArray(row.schedule) ? row.schedule.filter(Boolean) : [];
  const sched = schedIso.map(labelOf);
  const n = sched.length, done = intOf(row.prior_instalments);
  const status = statusToConsole(row.status);
  let paid = Math.min(intOf(row.instalments_paid), n);
  // A paid/settled loan has every instalment paid; otherwise instNorm would re-open it.
  if (status === 'paid') paid = n;
  const idx = Math.min(paid, Math.max(n - 1, 0));
  const out = {
    id: row.id, ref: row.ref, clientId: row.client_id,
    amount: num(row.principal), ret: row.return_rate_pct == null ? 35 : num(row.return_rate_pct),
    retAmt: row.instalment_amount == null ? undefined : num(row.instalment_amount),
    paidInst: paid, instDone: done, status,
    due: n ? sched[idx] : '—', purpose: row.purpose == null ? null : row.purpose,
    mandate: row.mandate_id || null,
    instNo: done + idx + 1, instTotal: done + n, instRemaining: Math.max(n - paid, 0),
    nextDue: (paid < n && sched[idx + 1]) ? sched[idx + 1] : null,
    sched,
    issued: row.issued_on ? labelOf(row.issued_on) : undefined,
    issuedBy: row.issued_by || undefined,
    employeeId: row.officer_id || undefined,
    paidDates: Array.isArray(row.paid_dates) ? row.paid_dates.filter(Boolean).map(labelOf) : []
  };
  if (done + n > 0) out.term = (done + n) + 'm';
  if (row.collection_fee != null) out.collectionFee = num(row.collection_fee);
  return out;
}

export function userToConsole(u, book) {
  return {
    id: u.id, name: u.name, email: u.email, role: ROLE_LABEL[u.role] || u.role,
    book: Math.round(book || 0), added: labelOf(String(u.created_at || '').slice(0, 10)),
    status: u.active === false ? 'DISABLED' : 'ACTIVE'
  };
}

// ---------------------------------------------------------------------------
// Cloud payload → in-memory tables
// ---------------------------------------------------------------------------
function blankTables() { const t = {}; SCHEMA.tables.forEach(x => { t[x.name] = []; }); return t; }
const arr = v => Array.isArray(v) ? v : [];
function fromCloud(payload) {
  const data = blankTables();
  data.users = arr(payload.employees).map(u => ({
    branch_id: null, client_id: null, last_login_at: null, relogin_required_at: null,
    ...u, role: roleToDb(u.role), active: u.active !== false, approval_limit: num(u.approval_limit)
  }));
  data.clients = arr(payload.clients);
  data.loans = arr(payload.loans).map(l => ({ ...l, schedule: arr(l.schedule), paid_dates: arr(l.paid_dates) }));
  data.applications = arr(payload.applications);
  // pass-through of the rest (read-only here; ledger-sync.js owns their mirroring)
  data.audit_log_remote = arr(payload.audit_log);
  data.petty_cash = arr(payload.petty_cash);
  data.bank_tx = arr(payload.bank_tx);
  data.expenses = arr(payload.expenses);
  data.settings = payload.settings ? [payload.settings] : [];
  data.ledger_book = payload.ledger_book ? [payload.ledger_book] : [];
  return data;
}
function looksLikeState(p) { return !!p && typeof p === 'object' && (Array.isArray(p.clients) || Array.isArray(p.loans) || Array.isArray(p.employees)); }

// GET state: prefer the boot shim's pre-fetch, then its api() helper, then a direct fetch.
async function fetchCloudState() {
  const L = W.__ledger;
  if (L && L.state && typeof L.state.then === 'function') {
    const s = await L.state.catch(e => { throw e; });
    if (looksLikeState(s)) return s;
    if (L.error || L.lastError) throw new Error(String(L.error || L.lastError));
    if (s == null && !(typeof L.api === 'function')) throw new Error('Ledger pre-fetch returned nothing');
  }
  if (L && typeof L.api === 'function') {
    const s = await unwrap(L.api('GET', '/state'));
    if (looksLikeState(s)) return s;
    throw new Error('GET /state returned an unexpected payload');
  }
  const cfg = readCfg();
  if (!apiBase(cfg) || !cfg.key) throw new Error('No ledger API url/key configured');
  const res = await fetch(apiBase(cfg) + '/state', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + cfg.key, apikey: cfg.key } });
  if (!res.ok) throw new Error('GET /state HTTP ' + res.status);
  const s = await res.json();
  if (!looksLikeState(s)) throw new Error('GET /state returned an unexpected payload');
  return s;
}
// __ledger.api may hand back parsed JSON or a Response; accept either.
async function unwrap(p) {
  const r = await p;
  if (r && typeof r === 'object' && typeof r.json === 'function' && 'ok' in r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  return r;
}

const CACHE_LEAN = ['audit_log_remote', 'bank_tx', 'petty_cash', 'row_versions', 'audit_log'];

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------
export class LedjaaDB {
  constructor(opts = {}) {
    this.key = opts.key || STORE_KEY;
    this.listeners = new Set();
    this.actor = null;
    this.seq = 0;
    this.data = blankTables();
    this.queue = []; this._inflight = []; this._flushing = null; this._t = null; this._tAt = 0; this._holdUntil = 0;
    this.sync = { status: 'loading', source: 'none', pending: 0, attempts: 0, lastError: null, lastSyncAt: null, loadedAt: null, failed: 0 };
    this.ready = this._boot();
    if (typeof W.addEventListener === 'function' && typeof document !== 'undefined') {
      // Push whatever is pending the moment the tab goes to the background.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush(); });
      W.addEventListener('pagehide', () => this.flush());
      W.addEventListener('online', () => this.flush());
    }
  }

  // ---- boot / cache -------------------------------------------------------
  async _boot() {
    let payload = null;
    try { payload = await fetchCloudState(); }
    catch (e) { this.sync.lastError = String((e && e.message) || e); }
    if (payload) {
      this.data = fromCloud(payload);
      this.sync.source = 'cloud'; this.sync.status = 'ready'; this.sync.loadedAt = nowIso();
      this.save();
    } else {
      const cached = this.load();
      this.data = cached || blankTables();
      this.sync.source = cached ? 'cache' : 'empty'; this.sync.status = 'offline';
      try { console.info('[ledjaa-db] cloud state unavailable (' + this.sync.lastError + ') — using ' + this.sync.source + ' tables'); } catch (e) { }
    }
    this._loadQueue();
    if (this.queue.length) this._scheduleFlush(400);
    return this;
  }
  load() {
    try {
      const raw = lsGet(this.key);
      if (raw) { const p = JSON.parse(raw); if (p && p.__v === SCHEMA.version && p.data) return { ...blankTables(), ...p.data }; }
    } catch (e) { }
    return null; // never a demo seed
  }
  save() {
    const snap = { ...this.data, audit_log: this.table('audit_log').slice(0, 300), row_versions: this.table('row_versions').slice(0, 300) };
    const wrap = d => JSON.stringify({ __v: SCHEMA.version, savedAt: nowIso(), source: this.sync.source, data: d });
    if (!lsSet(this.key, wrap(snap))) { // quota: drop the bulky pass-through tables and retry
      const lean = { ...snap }; CACHE_LEAN.forEach(k => { lean[k] = []; });
      lsSet(this.key, wrap(lean));
    }
    this.listeners.forEach(fn => { try { fn(this); } catch (e) { } });
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  reset() {
    // Drop the local cache and reload from the cloud; pending ops are kept.
    lsDel(this.key); this.data = blankTables();
    this.sync.status = 'loading'; this.ready = this._boot(); return this.ready;
  }
  empty() {
    // Staff accounts are real rows, not demo data, so they survive an empty().
    const blank = blankTables(); blank.users = this.table('users');
    this.data = blank; this.save();
  }

  // ---- reads (unchanged signatures) --------------------------------------
  setActor(userId) {
    this.actor = this.find('users', userId);
    if (this.actor) { this.actor.last_login_at = nowIso(); this.logRaw('login', 'users', this.actor.id, this.actor.name + ' signed in as ' + this.actor.role); this.save(); }
    return this.actor;
  }
  table(name) { return this.data[name] || []; }
  meta(name) { return SCHEMA.tables.find(t => t.name === name); }
  rows(name, { includeDeleted = false } = {}) { return this.table(name).filter(r => includeDeleted || !r.deleted_at); }
  find(name, id) { return this.table(name).find(r => r.id === id) || null; }
  where(name, pred) { return this.rows(name).filter(pred); }
  can(action, name, role = this.actor && this.actor.role) {
    // With no staff row yet there is nobody to sign in as; the data layer acts as admin
    // until the first employee row exists, otherwise an empty book could never be written.
    if (!role && !this.table('users').length) role = 'admin';
    const t = PERMISSIONS[name]; if (!t || !role) return false;
    if (this.meta(name) && this.meta(name).append_only && (action === 'update' || action === 'delete')) return false;
    return (t[role] || []).includes(action);
  }
  id(prefix) { return prefix + '-' + Date.now().toString(36) + (++this.seq).toString(36); }
  logRaw(action, name, rowId, summary, diff) {
    if (!this.data.audit_log) this.data.audit_log = [];
    this.data.audit_log.unshift({
      id: this.id('al'), at: nowIso(),
      actor_id: this.actor ? this.actor.id : 'system', actor_role: this.actor ? this.actor.role : 'system',
      action, table_name: name, row_id: rowId, summary, diff: diff || null
    });
  }
  version(name, row) {
    if (!this.data.row_versions) this.data.row_versions = [];
    const prior = this.data.row_versions.filter(v => v.table_name === name && v.row_id === row.id).length;
    this.data.row_versions.unshift({
      id: this.id('rv'), table_name: name, row_id: row.id, version: prior + 1,
      at: nowIso(), actor_id: this.actor ? this.actor.id : 'system', snapshot: clone(row)
    });
  }

  // ---- writes: apply locally, then queue for /api/ledger/sync -------------
  insert(name, values) {
    if (!this.can('create', name)) throw new Error('Not permitted: ' + (this.actor && this.actor.role) + ' cannot create in ' + name);
    const id = values.id || this.id(name.slice(0, 2));
    const row = LIVE_TABLE[name] ? { id, ...toLive(name, values, null) } : { id, ...values };
    if (name === 'loans') { row.schedule = row.schedule || []; row.instalments_paid = row.instalments_paid || 0; }
    this.data[name] = [row, ...this.table(name)];
    this.logRaw('insert', name, row.id, (row.ref || row.name || row.receipt_no || row.id) + ' created');
    this.save();
    this._queueUpsert(name, row);
    return row;
  }
  update(name, id, patch) {
    if (!this.can('update', name)) throw new Error('Not permitted: ' + (this.actor && this.actor.role) + ' cannot update ' + name);
    const row = this.find(name, id); if (!row) throw new Error('No such row ' + name + '.' + id);
    const live = LIVE_TABLE[name] ? toLive(name, patch, row) : { ...patch };
    const diff = {};
    Object.keys(live).forEach(k => { if (k === 'status_at' || k === 'written_off_at') return; if (!same(row[k], live[k])) diff[k] = [row[k], live[k]]; });
    if (!Object.keys(diff).length) return row;
    this.version(name, row);
    Object.assign(row, live);
    this.logRaw('update', name, id, Object.keys(diff).join(', ') + ' changed on ' + (row.ref || row.name || id), diff);
    this.save();
    this._queueUpsert(name, row);
    return row;
  }
  softDelete(name, id, reason) {
    if (!this.can('delete', name)) throw new Error('Not permitted: ' + (this.actor && this.actor.role) + ' cannot delete from ' + name);
    const row = this.find(name, id); if (!row) return null;
    this.version(name, row);
    row.deleted_at = nowIso(); if (reason) row.delete_reason = reason;
    this.logRaw('soft_delete', name, id, (row.ref || row.name || id) + ' archived' + (reason ? ' — ' + reason : ''));
    this.save();
    if (LIVE_TABLE[name]) this._enqueue({ table: LIVE_TABLE[name], op: 'soft_delete', id, reason: reason || undefined });
    return row;
  }
  restore(name, id) {
    const row = this.find(name, id); if (!row) return null;
    this.version(name, row); row.deleted_at = null;
    this.logRaw('restore', name, id, (row.ref || row.name || id) + ' restored');
    this.save();
    this._queueUpsert(name, row);
    return row;
  }
  _queueUpsert(name, row) {
    const live = liveRow(name, row); if (!live) return;
    this._enqueue({ table: LIVE_TABLE[name], op: 'upsert', rows: [live] });
  }

  // ---- queue ----------------------------------------------------------------
  _enqueue(op) {
    if (op.op === 'upsert') {
      // Coalesce with the latest pending op for this row, but only when nothing else for
      // the row was queued after it (keeps upsert → soft_delete → upsert in order).
      const id = op.rows[0].id;
      let last = -1; this.queue.forEach((q, i) => { if (q.table === op.table && (q.id === id || (q.rows && q.rows[0] && q.rows[0].id === id))) last = i; });
      if (last >= 0 && this.queue[last].op === 'upsert') { this.queue[last] = op; }
      else this.queue.push(op);
    } else this.queue.push(op);
    this._saveQueue();
    this._scheduleFlush(400);
  }
  _saveQueue() {
    this.sync.pending = this.queue.length + this._inflight.length;
    lsSet(QUEUE_KEY, JSON.stringify({ v: 1, savedAt: nowIso(), ops: [...this._inflight, ...this.queue] }));
  }
  _loadQueue() {
    try { const p = JSON.parse(lsGet(QUEUE_KEY) || 'null'); if (p && Array.isArray(p.ops)) this.queue = p.ops.concat(this.queue); } catch (e) { }
    this.sync.pending = this.queue.length;
  }
  _scheduleFlush(ms) {
    const now = Date.now(), at = now + Math.max(ms, this._holdUntil - now);
    if (this._t && this._tAt <= at) return;
    if (this._t) clearTimeout(this._t);
    this._tAt = at;
    this._t = timer(() => { this._t = null; this.flush(); }, at - now);
  }
  async _post(body) {
    const L = W.__ledger;
    // Same rule as the mirror in ledger-sync.js: without a key the queue is kept, never POSTed
    // (an unauthenticated /sync would only earn a 401 and a retry every minute).
    if (L && typeof L.cfg === 'function' && !(L.cfg() || {}).key) throw new Error('No ledger API url/key configured');
    if (L && typeof L.api === 'function') return unwrap(L.api('POST', '/sync', body));
    const cfg = readCfg();
    if (!apiBase(cfg) || !cfg.key) throw new Error('No ledger API url/key configured');
    const json = JSON.stringify(body);
    const res = await fetch(apiBase(cfg) + '/sync', {
      method: 'POST', body: json, keepalive: json.length < 60000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + cfg.key, apikey: cfg.key }
    });
    if (!res.ok) throw new Error('POST /sync HTTP ' + res.status);
    return res.json();
  }
  // Send everything pending now. Resolves when this attempt is over (success or scheduled retry).
  flush() {
    if (this._flushing) return this._flushing;
    if (this._t) { clearTimeout(this._t); this._t = null; }
    if (!this.queue.length) return Promise.resolve();
    this._flushing = (async () => {
      const batch = this.queue.splice(0, 100);
      this._inflight = batch; this.sync.status = 'syncing'; this._saveQueue();
      try {
        const res = await this._post({ ops: batch });
        if (!res || res.ok === false && !Array.isArray(res.results)) throw new Error((res && (res.error || res.message)) || 'sync rejected');
        const results = Array.isArray(res.results) ? res.results : [];
        results.forEach(r => { if (r && r.error) { this.sync.failed++; this.sync.lastError = r.table + ' ' + r.op + ': ' + r.error; try { console.warn('[ledjaa-db] sync op failed', r); } catch (e) { } } });
        this._inflight = []; this.sync.attempts = 0; this._holdUntil = 0; this.sync.lastSyncAt = nowIso();
        this.sync.status = this.queue.length ? 'syncing' : 'ready';
      } catch (e) {
        this.queue.unshift(...batch); this._inflight = [];
        this.sync.attempts++; this.sync.lastError = String((e && e.message) || e); this.sync.status = 'error';
        const wait = Math.min(60000, 1000 * Math.pow(2, this.sync.attempts - 1));
        this._holdUntil = Date.now() + wait;
        try { console.info('[ledjaa-db] sync failed (' + this.sync.lastError + '), retry in ' + Math.round(wait / 1000) + 's'); } catch (e2) { }
      }
      this._saveQueue();
    })().finally(() => { this._flushing = null; if (this.queue.length) this._scheduleFlush(400); });
    return this._flushing;
  }

  // ---- derived / reporting (same signatures as the original) --------------
  history(name, id) { return this.table('row_versions').filter(v => v.table_name === name && v.row_id === id).sort((a, b) => b.version - a.version); }
  feeAt(key, onDate) {
    return this.table('fees_config').find(f => f.key === key && f.effective_from <= onDate && (!f.effective_to || f.effective_to >= onDate)) || null;
  }
  balance(loanId) {
    const l = this.find('loans', loanId); if (!l) return 0;
    const paid = this.where('payments', p => p.loan_id === loanId && p.status === 'cleared').reduce((s, p) => s + p.amount, 0);
    return Math.round((num(l.instalment_amount) - paid) * 100) / 100;
  }
  counts() { const o = {}; SCHEMA.tables.forEach(t => { o[t.name] = this.table(t.name).length; }); return o; }
  // Payments are not synced here, so collection figures stay at zero/null.
  staffMetrics(userId) {
    const mine = this.rows('loans').filter(l => l.officer_id === userId);
    const active = mine.filter(l => ['issued', 'duetoday', 'overdue', 'restructured'].includes(l.status));
    const overdue = mine.filter(l => l.status === 'overdue');
    const cleared = this.where('payments', p => p.status === 'cleared' && mine.some(l => l.id === p.loan_id));
    const failed = this.where('payments', p => ['unpaid_insufficient_funds', 'reversed'].includes(p.status) && mine.some(l => l.id === p.loan_id));
    const attempts = cleared.length + failed.length;
    const apps = this.rows('applications').filter(a => a.captured_by === userId);
    const decided = this.rows('applications').filter(a => a.decided_by === userId && a.decided_at);
    const turnaround = decided.length
      ? decided.reduce((s, a) => s + (new Date(a.decided_at) - new Date(a.created_at)), 0) / decided.length / 3600000
      : null;
    const writeOffs = mine.filter(l => l.status === 'written_off');
    return {
      loans_count: mine.length,
      loans_value: mine.reduce((s, l) => s + num(l.principal), 0),
      book_value: active.reduce((s, l) => s + this.balance(l.id), 0),
      active_count: active.length,
      arrears_rate: active.length ? overdue.length / active.length : 0,
      arrears_count: overdue.length,
      collection_rate: attempts ? cleared.length / attempts : null,
      applications: apps.length,
      approvals: decided.length,
      turnaround_hours: turnaround,
      clients: this.rows('clients').filter(x => x.officer_id === userId).length,
      letters: this.rows('settlement_letters').filter(s => s.issued_by === userId).length,
      write_offs_count: writeOffs.length,
      write_offs_value: writeOffs.reduce((s, l) => s + num(l.principal), 0),
      last_login_at: (this.find('users', userId) || {}).last_login_at || null
    };
  }
  reassignBook(fromUserId, toUserId) {
    if (!this.can('update', 'loans')) throw new Error('Not permitted: ' + (this.actor && this.actor.role) + ' cannot reassign loans');
    const loans = this.rows('loans').filter(l => l.officer_id === fromUserId);
    const clients = this.rows('clients').filter(x => x.officer_id === fromUserId);
    loans.forEach(l => { this.version('loans', l); l.officer_id = toUserId; this._queueUpsert('loans', l); });
    clients.forEach(x => { this.version('clients', x); x.officer_id = toUserId; this._queueUpsert('clients', x); });
    const to = this.find('users', toUserId) || {}, from = this.find('users', fromUserId) || {};
    this.logRaw('update', 'loans', '—', loans.length + ' loans and ' + clients.length + ' clients reassigned from ' + from.name + ' to ' + to.name);
    this.save();
    return { loans: loans.length, clients: clients.length };
  }
  forceRelogin(userId) {
    const u = this.find('users', userId); if (!u) return null;
    // local-only flag (no live column); same return shape as before
    this.version('users', u); u.relogin_required_at = nowIso();
    this.logRaw('update', 'users', userId, 'relogin_required_at changed on ' + (u.name || userId));
    this.save(); return u;
  }
  actorTrail(userId, limit = 40) { return this.table('audit_log').filter(a => a.actor_id === userId).slice(0, limit); }

  // Bridge for the console: every non-deleted row, in the console's own vocabulary.
  toConsoleState() {
    const users = {}; this.table('users').forEach(u => { users[u.id] = u; });
    return {
      clients: this.rows('clients').map(row => clientToConsole(row, (users[row.officer_id] || {}).name)),
      loans: this.rows('loans').map(loanToConsole),
      employees: this.rows('users').filter(u => u.role !== 'client').map(u => userToConsole(u, this.staffMetrics(u.id).book_value))
    };
  }
}

export const db = new LedjaaDB();
try { W.__ledgerDb = db; } catch (e) { }
await db.ready;
export default db;
