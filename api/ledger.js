// Staff endpoints for the LEDGER console (Bearer LEDGER_KEY):
//   GET  /api/ledger/state                      full snapshot for boot
//   POST /api/ledger/sync                       ordered ops {upsert|insert|update|soft_delete}
//   GET|POST /api/ledger/rest/v1/ledger_book    PostgREST emulation for the console's "Supabase book"
import { wrap, json, readBody, pathParts, searchParams, requireEnv, HttpError, STAFF_BODY_CAP } from './_lib/http.js';
import { requireStaff } from './_lib/auth.js';
import { select, selectOne, upsert, insert, update, eq } from './_lib/supabase.js';
import { COLUMNS, pick, requireId } from './_lib/validate.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LEDGER_KEY'];
const AUDIT_LIMIT = 1000;
const BANK_TX_LIMIT = 500;
// applications is fed by the public Quik1 route, so its size is not under staff control: the
// console only works the newest ones, and an unbounded list would let junk submissions bloat
// (and eventually break) the boot snapshot.
const APPLICATIONS_LIMIT = 500;
const MAX_OPS = 500;
const MAX_ROWS_PER_OP = 1000;

// Which ops each table accepts. audit_log is append-only (DB trigger too); bank_tx likewise by
// policy; settings is a single upsert-able row; soft_delete only where a deleted_at column exists.
const SYNC_RULES = {
  employees: { ops: ['upsert', 'insert', 'update'] },
  clients: { ops: ['upsert', 'insert', 'update', 'soft_delete'] },
  loans: { ops: ['upsert', 'insert', 'update', 'soft_delete'] },
  applications: { ops: ['upsert', 'insert', 'update'] },
  audit_log: { ops: ['upsert', 'insert'], ignoreDuplicates: true },
  bank_tx: { ops: ['upsert', 'insert'], ignoreDuplicates: true },
  petty_cash: { ops: ['upsert', 'insert', 'update'] },
  expenses: { ops: ['upsert', 'insert', 'update', 'soft_delete'] },
  settings: { ops: ['upsert', 'insert', 'update'], singleton: 'org' }
};

async function tolerant(p) { try { return await p; } catch { return null; } }

async function getState(req, res) {
  const [clients, loans, employees, applications, audit_log, petty_cash, bank_tx, expenses, settings, book] = await Promise.all([
    select('clients', { select: '*', order: 'created_at.asc,id.asc' }),
    select('loans', { select: '*', order: 'created_at.asc,id.asc' }),
    select('employees', { select: '*', order: 'created_at.asc,id.asc' }),
    select('applications', { select: '*', order: 'created_at.desc', limit: APPLICATIONS_LIMIT }),
    select('audit_log', { select: '*', order: 'at.desc', limit: AUDIT_LIMIT }),
    select('petty_cash', { select: '*', order: 'date.desc' }),
    select('bank_tx', { select: '*', order: 'at.desc', limit: BANK_TX_LIMIT }),
    select('expenses', { select: '*', order: 'name.asc' }),
    selectOne('settings', { select: '*', id: eq('org') }),
    // The book table only exists after the bridge migration; its absence must not break boot.
    tolerant(selectOne('ledger_book', { select: 'updated_at', id: eq('main') }))
  ]);
  // The console computes the bank balance as the confirmed opening balance plus every movement
  // after it, so the snapshot must carry all of those even when more than BANK_TX_LIMIT have
  // happened since; the newest window on its own would understate or overstate the balance.
  let bankTx = bank_tx;
  const openingAt = settings && settings.bank_opening_at && !Number.isNaN(Date.parse(settings.bank_opening_at)) ? new Date(settings.bank_opening_at).toISOString() : null;
  if (openingAt && bank_tx.length >= BANK_TX_LIMIT) {
    const since = await select('bank_tx', { select: '*', order: 'at.desc', at: 'gte.' + openingAt });
    const seen = new Set(bank_tx.map(r => r.id));
    bankTx = bank_tx.concat(since.filter(r => !seen.has(r.id)));
  }
  json(res, 200, {
    clients, loans, employees, applications, audit_log, petty_cash, bank_tx: bankTx, expenses,
    settings: settings || null,
    ledger_book: book ? { updated_at: book.updated_at } : null,
    server_time: new Date().toISOString()
  }, req);
}

function rowsOf(op) {
  const rows = Array.isArray(op.rows) ? op.rows : (op.row ? [op.row] : []);
  if (!rows.length) throw new HttpError(400, 'rows required');
  if (rows.length > MAX_ROWS_PER_OP) throw new HttpError(400, 'too many rows');
  return rows;
}

async function applyOp(op) {
  if (!op || typeof op !== 'object') throw new HttpError(400, 'op must be an object');
  const table = String(op.table || '');
  const kind = String(op.op || '');
  const rule = SYNC_RULES[table];
  if (!rule) throw new HttpError(400, `table ${table || '(none)'} is not syncable`);
  if (!rule.ops.includes(kind)) {
    if (table === 'audit_log') throw new HttpError(400, 'audit_log is append-only');
    throw new HttpError(400, `${kind || '(none)'} not allowed on ${table}`);
  }
  if (kind === 'upsert' || kind === 'insert') {
    const rows = rowsOf(op).map(r => {
      const row = pick(table, r);
      if (rule.singleton) row.id = rule.singleton;
      requireId(row);
      return row;
    });
    if (kind === 'insert' && !rule.ignoreDuplicates && !rule.singleton) {
      const out = await insert(table, rows);
      return out.length;
    }
    const out = await upsert(table, rows, 'id', { ignoreDuplicates: !!rule.ignoreDuplicates });
    return out.length;
  }
  if (kind === 'update') {
    const id = rule.singleton || requireId(op);
    const patch = pick(table, op.patch || {});
    delete patch.id;
    if (!Object.keys(patch).length) return 0;
    if (rule.singleton) {
      const out = await upsert(table, [{ id, ...patch }], 'id');
      return out.length;
    }
    const out = await update(table, { id }, patch);
    return out.length;
  }
  if (kind === 'soft_delete') {
    const id = requireId(op);
    if (!COLUMNS[table].includes('deleted_at')) throw new HttpError(400, `${table} has no deleted_at`);
    // Only the tombstone — reasons live in the console's own audit trail.
    const out = await update(table, { id }, { deleted_at: new Date().toISOString() });
    return out.length;
  }
  throw new HttpError(400, 'unknown op');
}

async function postSync(req, res) {
  const body = await readBody(req, STAFF_BODY_CAP);
  const ops = Array.isArray(body.ops) ? body.ops : null;
  if (!ops) throw new HttpError(400, 'body must be {ops:[...]}');
  if (ops.length > MAX_OPS) throw new HttpError(400, `at most ${MAX_OPS} ops per sync`);
  const results = [];
  for (const op of ops) {
    const base = { table: op && op.table != null ? String(op.table) : null, op: op && op.op != null ? String(op.op) : null };
    try {
      const count = await applyOp(op);
      results.push({ ...base, count });
    } catch (e) {
      // Partial failures are reported per op. `retryable` tells the clients whether to keep the
      // op (upstream down / 5xx / throttled) or drop it (validation, conflict, bad table).
      const msg = e instanceof HttpError ? e.message : 'Internal error';
      const retryable = !(e instanceof HttpError) || e.message === 'Database unreachable'
        || (e.upstream != null && (e.upstream >= 500 || e.upstream === 429));
      results.push({ ...base, count: 0, error: msg, retryable });
    }
  }
  json(res, 200, { ok: results.every(r => !r.error), results, server_time: new Date().toISOString() }, req);
}

// ---- PostgREST emulation for the console's "Supabase book" ------------------------------------
// Only the shapes the console issues are honoured (see docs/BRIDGE-SPEC.md). Anything else is 400.
function parseFilters(sp) {
  const filters = {};
  for (const [k, v] of sp.entries()) {
    // `path` is Vercel's catch-all routing key (it can appear on req.url as well as req.query).
    if (k === 'path' || k === 'select' || k === 'limit' || k === 'order' || k === 'on_conflict') continue;
    if (!COLUMNS.ledger_book.includes(k)) throw new HttpError(400, `unsupported filter ${k}`);
    if (!/^eq\./.test(v)) throw new HttpError(400, 'only eq. filters are supported');
    filters[k] = v.slice(3);
  }
  return filters;
}
function parseSelect(sp) {
  const raw = (sp.get('select') || '*').trim();
  if (raw === '*' || raw === '') return COLUMNS.ledger_book.slice();
  const cols = raw.split(',').map(s => s.trim()).filter(Boolean);
  const bad = cols.find(c => !COLUMNS.ledger_book.includes(c));
  if (bad) throw new HttpError(400, `unknown column ${bad}`);
  return cols;
}

// The book is a write-only backup. The record tables (clients, loans, employees, applications)
// live in their own tables and are synced from every device regardless of the book's `connected`
// flag, so a stored book is always behind them; handing it back would let the console's sbPull
// replace the live book with a stale one (and dbPush would then archive everything created since).
// Without `clients`/`loans` the console's own guard ("Stored book is missing records") trips and
// nothing is restored, while sbPush keeps working.
const BACKUP_ONLY_STRIP = ['clients', 'loans', 'employees', 'applications'];
function backupOnly(payload) {
  const out = { ...payload };
  for (const k of BACKUP_ONLY_STRIP) delete out[k];
  return out;
}

async function bookGet(req, res) {
  const sp = searchParams(req);
  const cols = parseSelect(sp);
  const filters = parseFilters(sp);
  const limit = sp.has('limit') ? Math.max(1, Math.min(100, parseInt(sp.get('limit'), 10) || 1)) : undefined;
  const query = { select: cols.join(','), order: 'updated_at.desc' };
  for (const [k, v] of Object.entries(filters)) query[k] = eq(v);
  if (limit) query.limit = limit;
  const rows = await select('ledger_book', query);
  // PostgREST would already project; re-project defensively so `select=id` never leaks payloads.
  const out = rows.map(r => {
    const o = Object.fromEntries(cols.map(c => [c, r[c] === undefined ? null : r[c]]));
    if (o.payload && typeof o.payload === 'object') o.payload = backupOnly(o.payload);
    return o;
  });
  if (req.method === 'HEAD') { json(res, 200, undefined, req); return; }
  json(res, 200, out, req);
}

async function bookPost(req, res) {
  const sp = searchParams(req);
  const onConflict = sp.get('on_conflict');
  if (onConflict && onConflict !== 'id') throw new HttpError(400, 'on_conflict must be id');
  const body = await readBody(req, STAFF_BODY_CAP);
  const list = Array.isArray(body) ? body : [body];
  if (!list.length || list.length > 10) throw new HttpError(400, 'send 1–10 book rows');
  const rows = list.map(r => {
    const row = pick('ledger_book', r);
    requireId(row);
    if (!row.payload || typeof row.payload !== 'object') throw new HttpError(400, 'payload must be a JSON object');
    if (!row.updated_at) row.updated_at = new Date().toISOString();
    return row;
  });
  const prefer = String(req.headers?.prefer || req.headers?.Prefer || '');
  const minimal = /return=minimal/.test(prefer);
  const out = await upsert('ledger_book', rows, 'id', { returning: !minimal });
  json(res, 201, minimal ? [] : out, req);
}

export default wrap('ledger', async (req, res) => {
  requireEnv(ENV);
  requireStaff(req);
  const parts = pathParts(req, 'ledger');
  const [head, ...rest] = parts;
  if (head === 'state' && rest.length === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return getState(req, res);
  }
  if (head === 'sync' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postSync(req, res);
  }
  if (head === 'rest' && rest[0] === 'v1' && rest[1] === 'ledger_book' && rest.length === 2) {
    if (req.method === 'GET' || req.method === 'HEAD') return bookGet(req, res);
    if (req.method === 'POST') return bookPost(req, res);
    throw new HttpError(405, 'Method not allowed');
  }
  if (head === 'rest' && rest[0] === 'v1') throw new HttpError(404, 'Only ledger_book is exposed here');
  throw new HttpError(404, 'Not found');
});
