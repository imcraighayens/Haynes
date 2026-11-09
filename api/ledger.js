// Staff endpoints for the LEDGER console (Bearer LEDGER_KEY):
//   GET  /api/ledger/state                      full snapshot for boot
//   POST /api/ledger/sync                       ordered ops {upsert|insert|update|soft_delete}
//   GET|POST /api/ledger/rest/v1/ledger_book    PostgREST emulation for the console's "Supabase book"
import { wrap, json, readBody, pathParts, searchParams, requireEnv, HttpError, STAFF_BODY_CAP } from './_lib/http.js';
import { requireStaff, isSameOrigin, verifyManagerPin, demoResetAllowed, mintStaffSession, staffCookieHeader, staffIdentity } from './_lib/auth.js';
import { signInStaff } from './_lib/staff.js';
import { select, selectOne, upsert, insert, update, eq } from './_lib/supabase.js';
import { COLUMNS, pick, requireId } from './_lib/validate.js';
import { aiStatus, completeAi, twilioStatus, sendTwilio } from './_lib/providers.js';
import { createInvite, revokeInvite, listInvites } from './_lib/borrower.js';
import { staffFeed, decideApplication, postStaffReply, signStaffDocument } from './_lib/borrower-book.js';
import { runNupayImport } from './_lib/nupay-import.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LEDGER_KEY'];
const AUDIT_LIMIT = 1000;
const BANK_TX_LIMIT = 500;
// applications is fed by the public Quik1 and EcoLoans routes, so its size is not under staff control: the
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
  // Replacing the book is not a normal sync op. The PIN is required before any read or write.
  if (table === 'loans' && kind === 'replace_book') {
    verifyManagerPin(op.manager_pin);
    return replaceLoans(op.rows);
  }
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
    // Deleting a loan is destructive. The manager PIN is checked here so a staff session
    // alone cannot archive the book. The PIN is not written to the database.
    if (table === 'loans') verifyManagerPin(op.manager_pin);
    const out = await update(table, { id }, { deleted_at: new Date().toISOString() });
    return out.length;
  }
  throw new HttpError(400, 'unknown op');
}

// Validate every incoming row before the first delete, so a bad payload cannot wipe the book.
async function replaceLoans(rows) {
  if (!Array.isArray(rows)) throw new HttpError(400, 'rows required');
  if (rows.length > MAX_ROWS_PER_OP) throw new HttpError(400, 'too many rows');
  const incoming = rows.map(r => {
    const row = pick('loans', r);
    requireId(row);
    row.deleted_at = null;
    return row;
  });
  const existing = await select('loans', { select: 'id,deleted_at' });
  const now = new Date().toISOString();
  let n = 0;
  for (const row of existing) {
    if (row && row.id && !row.deleted_at) {
      await update('loans', { id: row.id }, { deleted_at: now });
      n++;
    }
  }
  if (incoming.length) await upsert('loans', incoming, 'id');
  return n + incoming.length;
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
  try { await pushRepaymentFlags(ops); } catch { /* never fail the staff sync on Quik1 flag write */ }
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


const OPEN_LOAN = new Set(['issued', 'overdue']);
const CLOSED_LOAN = new Set(['paid', 'settled_early']);
const DEFAULT_CREDIT_LIMIT = Math.max(500, parseInt(process.env.QUIK1_CREDIT_LIMIT, 10) || 8000);

function creditLimit() { return DEFAULT_CREDIT_LIMIT; }

function outstandingPrincipal(loans) {
  return (loans || []).filter(l => l && !l.deleted_at && OPEN_LOAN.has(String(l.status || '').toLowerCase()))
    .reduce((s, l) => s + (Number(l.principal) || 0), 0);
}

function availableOf(loans) {
  const outstanding = outstandingPrincipal(loans);
  return { credit_limit: creditLimit(), outstanding_principal: outstanding, available: Math.max(0, creditLimit() - outstanding) };
}

async function pushRepaymentFlags(ops) {
  // Ledger → Quik1: when a loan lands paid/settled_early, flag q1_repayments under app:<application_id>
  // so Quik1Link's repayment poll unlocks the next borrow. Interest / return_rate stay on the loan row.
  const flags = [];
  for (const op of ops || []) {
    if (!op || op.table !== 'loans') continue;
    const rows = Array.isArray(op.rows) ? op.rows : (op.row ? [op.row] : []);
    if (op.op === 'update' && op.patch) {
      const st = String(op.patch.status || '').toLowerCase();
      if (CLOSED_LOAN.has(st) && op.id) {
        const row = await selectOne('loans', { select: 'id,application_id,status,principal', id: eq(op.id) }).catch(() => null);
        if (row && row.application_id) flags.push({ key: 'app:' + row.application_id, ok: true, by: 'Ledger', at: new Date().toISOString() });
      }
    }
    for (const r of rows) {
      const st = String((r && r.status) || '').toLowerCase();
      if (CLOSED_LOAN.has(st) && r && r.application_id) {
        flags.push({ key: 'app:' + r.application_id, ok: true, by: 'Ledger', at: new Date().toISOString() });
      }
    }
  }
  if (!flags.length) return;
  // Dedup by key
  const byKey = new Map();
  flags.forEach(f => byKey.set(f.key, f));
  try { await upsert('q1_repayments', [...byKey.values()], 'key', { returning: false }); } catch { /* table optional until migration */ }
}

async function postManagerPin(req, res) {
  const body = await readBody(req, 4 * 1024);
  verifyManagerPin(body.pin);
  json(res, 200, { ok: true }, req);
}

async function postDestructive(req, res) {
  const body = await readBody(req, STAFF_BODY_CAP);
  const action = String(body.action || '');
  if (action === 'delete_loan') {
    const count = await applyOp({ table: 'loans', op: 'soft_delete', id: body.id, manager_pin: body.pin });
    json(res, 200, { ok: true, count }, req);
    return;
  }
  if (action === 'replace_book') {
    const count = await applyOp({ table: 'loans', op: 'replace_book', rows: body.rows, manager_pin: body.pin });
    json(res, 200, { ok: true, count }, req);
    return;
  }
  throw new HttpError(400, 'unknown action');
}

async function getAi(req, res) {
  const status = aiStatus();
  json(res, 200, { configured: status.configured, provider: status.configured ? status.provider : null }, req);
}

async function postAi(req, res) {
  const body = await readBody(req, STAFF_BODY_CAP);
  // Ignore any key, token, or provider secret the client tried to send.
  const text = await completeAi({ prompt: body.prompt, docText: body.docText, images: body.images });
  json(res, 200, { text }, req);
}

async function getTwilio(req, res) {
  json(res, 200, { configured: twilioStatus().configured }, req);
}

async function postTwilio(req, res) {
  const body = await readBody(req, 16 * 1024);
  await sendTwilio({ action: body.action, to: body.to, body: body.body });
  json(res, 200, { ok: true }, req);
}

async function postLock(req, res) {
  if (!isSameOrigin(req)) throw new HttpError(403, 'Same-origin required');
  res.setHeader('Set-Cookie', staffCookieHeader('', 0, { clear: true }));
  json(res, 200, { ok: true }, req);
}

async function postLogin(req, res) {
  // Same-origin only. Supabase Auth checks the password; we mint the existing staff cookie.
  if (!isSameOrigin(req)) throw new HttpError(403, 'Same-origin required');
  requireEnv(['LEDGER_KEY']);
  const body = await readBody(req, 4 * 1024);
  const result = await signInStaff(body && body.email, body && body.password);
  if (!result.ok) {
    if (result.status === 503) throw new HttpError(503, 'Server not configured');
    throw new HttpError(401, 'Unauthorized');
  }
  const { token, exp } = mintStaffSession(Date.now(), result.staff);
  res.setHeader('Set-Cookie', staffCookieHeader(token, exp));
  json(res, 200, {
    ok: true,
    expires_at: new Date(exp).toISOString(),
    staff: { email: result.staff.email, displayName: result.staff.displayName }
  }, req);
}

async function getSession(req, res) {
  requireEnv(['LEDGER_KEY']);
  await requireStaff(req);
  const staff = staffIdentity(req);
  json(res, 200, { ok: true, staff: staff ? { email: staff.email, displayName: staff.displayName } : null }, req);
}

async function getAvailable(req, res, clientId) {
  if (!clientId) throw new HttpError(400, 'client id required');
  const client = await selectOne('clients', { select: 'id,ref,deleted_at', id: eq(clientId) });
  if (!client || client.deleted_at) throw new HttpError(404, 'Client not found');
  const loans = await select('loans', { select: 'id,ref,client_id,application_id,principal,status,schedule,deleted_at', client_id: eq(clientId) });
  const open = (loans || []).filter(l => l && !l.deleted_at && OPEN_LOAN.has(String(l.status || '').toLowerCase()));
  const bal = availableOf(loans);
  // Counts + money only — no names, ID numbers, or account numbers.
  json(res, 200, {
    client_id: client.id,
    ref: client.ref || null,
    open_loans: open.length,
    ...bal,
    next_due: open.map(l => Array.isArray(l.schedule) && l.schedule[0] ? l.schedule[0] : null).filter(Boolean).sort()[0] || null,
    server_time: new Date().toISOString()
  }, req);
}

export default wrap('ledger', async (req, res) => {
  const parts = pathParts(req, 'ledger');
  const [head, ...rest] = parts;

  // Login and lock mint or clear the staff cookie. Bearer is not required to call them.
  // /unlock is gone: a PIN must not mint a session, even if a caller still posts one.
  if (head === 'unlock') throw new HttpError(404, 'Not found');
  if (head === 'login' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postLogin(req, res);
  }
  if (head === 'session' && rest.length === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return getSession(req, res);
  }
  if (head === 'lock' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postLock(req, res);
  }

  requireEnv(ENV);
  await requireStaff(req);
  if (head === 'state' && rest.length === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return getState(req, res);
  }
  if (head === 'sync' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postSync(req, res);
  }
  if (head === 'available' && rest.length === 1) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return getAvailable(req, res, rest[0]);
  }
  if (head === 'features' && rest.length === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return json(res, 200, { demoReset: demoResetAllowed(req) }, req);
  }
  if (head === 'manager-pin' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postManagerPin(req, res);
  }
  if (head === 'destructive' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return postDestructive(req, res);
  }
  if (head === 'ai' && rest.length === 0) {
    if (req.method === 'GET' || req.method === 'HEAD') return getAi(req, res);
    if (req.method === 'POST') return postAi(req, res);
    throw new HttpError(405, 'Method not allowed');
  }
  if (head === 'twilio' && rest.length === 0) {
    if (req.method === 'GET' || req.method === 'HEAD') return getTwilio(req, res);
    if (req.method === 'POST') return postTwilio(req, res);
    throw new HttpError(405, 'Method not allowed');
  }
  if (head === 'quik1-invites' && rest.length === 0) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return json(res, 200, await listInvites(searchParams(req).get('clientId') || ''), req);
    }
    if (req.method === 'POST') {
      const body = await readBody(req, 4096);
      const clientId = body && typeof body.clientId === 'string' ? body.clientId : '';
      return json(res, 201, await createInvite(req, clientId), req);
    }
    throw new HttpError(405, 'Method not allowed');
  }
  if (head === 'quik1-invites' && rest.length === 2 && rest[1] === 'revoke') {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    return json(res, 200, await revokeInvite(rest[0]), req);
  }
  if (head === 'quik1-feed' && rest.length === 0) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    return json(res, 200, await staffFeed(), req);
  }
  if (head === 'quik1-applications' && rest.length === 1) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readBody(req, 8192);
    return json(res, 200, await decideApplication(rest[0], body && body.status, body && body.amount), req);
  }
  if (head === 'quik1-messages' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readBody(req, 8192);
    const clientId = body && typeof body.clientId === 'string' ? body.clientId : '';
    return json(res, 201, await postStaffReply(clientId, body), req);
  }
  if (head === 'nupay-clients' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readBody(req, STAFF_BODY_CAP);
    const commit = !!(body && body.commit === true);
    const who = staffIdentity(req);
    const result = await runNupayImport(body && body.csv, { commit, actor: (who && who.displayName) || 'staff' });
    if (commit && result.errors && result.errors.length) return json(res, 400, result, req);
    return json(res, 200, result, req);
  }
  if (head === 'quik1-documents' && rest.length === 0) {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const body = await readBody(req, 8192);
    const applicationId = body && typeof body.applicationId === 'string' ? body.applicationId : '';
    const path = body && typeof body.path === 'string' ? body.path : '';
    return json(res, 200, await signStaffDocument(applicationId, path), req);
  }
  if (head === 'rest' && rest[0] === 'v1' && rest[1] === 'ledger_book' && rest.length === 2) {
    if (req.method === 'GET' || req.method === 'HEAD') return bookGet(req, res);
    if (req.method === 'POST') return bookPost(req, res);
    throw new HttpError(405, 'Method not allowed');
  }
  if (head === 'rest' && rest[0] === 'v1') throw new HttpError(404, 'Only ledger_book is exposed here');
  throw new HttpError(404, 'Not found');
});
