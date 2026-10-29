// node --test tests/ledger-sync.test.js  — unit tests for ledger/ledger-sync.js (browser globals are stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../ledger/ledger-sync.js', import.meta.url), 'utf8');
const ORIGIN = 'https://ledger.test';

class FakeStorage {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  key(i) { return [...this._m.keys()][i] ?? null; }
  get length() { return this._m.size; }
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

// Boots the script in a vm context with stubbed window/localStorage/fetch/document.
async function boot({ local = {}, state = null, stateStatus = 200 } = {}) {
  const localStorage = new FakeStorage();
  for (const [k, v] of Object.entries(local)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (/\/state$/.test(url)) return jsonResponse(stateStatus, state);
    if (/\/sync$/.test(url)) return jsonResponse(200, { ok: true, results: (JSON.parse(init.body).ops || []).map(() => ({ count: 1 })) });
    return jsonResponse(404, {});
  };
  const head = { children: [], appendChild(el) { this.children.push(el); } };
  const document = { readyState: 'complete', head, createElement: (tag) => ({ tagName: tag }), addEventListener() {}, removeEventListener() {} };
  const window = {
    localStorage, Storage: FakeStorage, document, fetch, console: { info() {} },
    location: { origin: ORIGIN }, setTimeout, clearTimeout, AbortController, addEventListener() {},
  };
  window.window = window;
  vm.createContext(window);
  vm.runInContext(SRC, window, { filename: 'ledger-sync.js' });
  await window.__ledger.booted;
  const read = (k) => JSON.parse(localStorage.getItem(k));
  const plain = (v) => JSON.parse(JSON.stringify(v)); // objects built inside the vm realm have a foreign prototype
  const queue = () => plain(window.__ledger._.queue());
  return { window, L: window.__ledger, localStorage, calls, head, read, plain, queue };
}

const STATE = {
  employees: [{ id: 'e1', name: 'Craig Moatshe', email: 'c@x.za', role: 'admin', active: true }],
  clients: [{ id: 'c_nupay_15', ref: 'EC-015', name: 'A' }, { id: 'c2', ref: 'EC-007', name: 'B' }],
  loans: [],
  applications: [],
  audit_log: [
    { id: 'al_db_1', at: '2026-10-15T12:00:00Z', type: 'PAYMENT RECEIVED', ref: 'ECL-112', customer: 'Thabo M', amount: 1250.5, by: 'e1', comment: 'Inst 2' },
    { id: 'al_db_2', at: '2026-10-14T09:00:00Z', type: 'LOAN UPDATED', ref: 'ECL-110', customer: 'Lerato K', amount: 0, by: 'Ops Bot', comment: '' },
  ],
  petty_cash: [{ id: 'p1', date: '2026-10-10', amount: 120, category: 'travel', purpose: 'Taxi', borrower: '', notes: '', status: 'REPAID', by: 'Craig Moatshe' }],
  bank_tx: [{ id: 'bt1', at: '2026-10-12T08:00:00Z', type: 'in', amount: 500, ref: 'ECL-112', label: 'Collected', by: 'e1' }],
  expenses: [{ id: 'x1', name: 'Rent', amount: 4500, deleted_at: null }, { id: 'x2', name: 'Old', amount: 1, deleted_at: '2026-10-01T00:00:00Z' }],
  settings: { id: 'org', org_name: 'Ecoloans', org_legal_name: 'Ecoloans Finance (Pty) Ltd', contact_email: 'info@ecoloans.co.za', bank_opening_balance: 10000, bank_opening_at: '2026-10-01T06:00:00Z', updated_by: 'e1' },
  server_time: '2026-10-29T10:00:00Z',
};

test('seeds ledjaa.supabase when absent and boots local-only without a key', async () => {
  const { read, calls, head, L } = await boot();
  assert.deepEqual(read('ledjaa.supabase'), { url: ORIGIN + '/api/ledger', key: '', table: 'ledger_book', bookId: 'main', connected: false });
  assert.equal(calls.length, 0, 'no state fetch without a key');
  assert.equal(await L.state, null);
  assert.match(L.error, /no key/);
  assert.equal(head.children.length, 1);
  assert.equal(head.children[0].src, 'c53b361c-bb83-4c37-90f5-7116b8407f79.js');
  assert.equal(read('q1.apps'), null, 'q1.apps untouched without a key');
});

test('fills only the empty fields of ledjaa.supabase and q1.apps', async () => {
  const userApps = [
    { id: 'q0', name: 'Quik1 loan app', url: 'https://mine.example/q1', path: '', key: '', proxy: '', on: false, actions: false, hint: 'h', pathHint: '/applications?status=new' },
    { id: 'q1', name: 'NuPay (debit orders)', url: '', path: '/transactions?days=7', key: '', proxy: '', on: false, actions: false, hint: 'n', pathHint: '/transactions?days=7' },
  ];
  const { read, calls } = await boot({ local: { 'ledjaa.supabase': { url: '', key: 'secret-key', connected: true, lastSync: 'x' }, 'q1.apps': userApps }, state: STATE });
  const cfg = read('ledjaa.supabase');
  assert.equal(cfg.url, ORIGIN + '/api/ledger');
  assert.equal(cfg.key, 'secret-key');
  assert.equal(cfg.connected, true, 'user value preserved');
  assert.equal(cfg.lastSync, 'x');
  assert.equal(cfg.table, 'ledger_book');
  assert.equal(cfg.bookId, 'main');
  const apps = read('q1.apps');
  assert.equal(apps.length, 2, 'existing list kept');
  assert.equal(apps[0].url, 'https://mine.example/q1', 'user url not overwritten');
  assert.equal(apps[0].on, false, 'user toggle not flipped when url already set');
  assert.equal(apps[0].key, 'secret-key', 'empty key filled');
  assert.equal(apps[0].path, '/applications?status=new', 'empty path filled');
  assert.equal(apps[1].url, '', 'other entries untouched');
  const stateCall = calls.find((c) => /\/state$/.test(c.url));
  assert.ok(stateCall);
  assert.equal(stateCall.init.headers.Authorization, 'Bearer secret-key');
});

test('seeds the full default q1.apps list with a configured Quik1 entry when the key is absent', async () => {
  const { read } = await boot({ local: { 'ledjaa.supabase': { key: 'k' } }, state: STATE });
  const apps = read('q1.apps');
  assert.equal(apps.length, 7, 'console default list preserved');
  const q = apps.find((a) => /quik1/i.test(a.name));
  assert.equal(q.url, ORIGIN + '/api/q1');
  assert.equal(q.key, 'k');
  assert.equal(q.on, true);
  assert.equal(q.actions, true);
  assert.equal(q.path, '/applications?status=new');
  assert.ok(apps.some((a) => /nupay/i.test(a.name)));
});

test('maps audit_log rows to console logbook entries and back', async () => {
  const { L, read, plain } = await boot({ local: { 'ledjaa.supabase': { key: 'k' } }, state: STATE });
  const sv = read('evoltConsoleV4');
  assert.deepEqual(sv.clients, []); assert.deepEqual(sv.loans, []); // the app only accepts sv with these keys
  assert.equal(sv.logbook.length, 2);
  const e = sv.logbook[0];
  assert.equal(e.id, 'al_db_1');
  assert.equal(e.type, 'PAYMENT RECEIVED');
  assert.equal(e.ref, 'ECL-112');
  assert.equal(e.customer, 'Thabo M');
  assert.equal(e.amount, 1250.5);
  assert.equal(e.by, 'Craig Moatshe', 'employee id mapped to name on read');
  assert.equal(e.date, '15 OCT 2026', 'console date label, uppercase');
  assert.equal(e.at, Date.parse('2026-10-15T12:00:00Z'));
  assert.equal(sv.logbook[1].by, 'Ops Bot', 'non-id by passes through');

  // back: console shape → audit_log row (by written as-is, ISO at, defaults for blanks)
  const row = plain(L._.logToAudit({ id: 'al_x', at: Date.parse('2026-10-20T10:00:00Z'), ref: 'ECL-1', customer: 'Zee', amount: 'R1 250.50', type: 'LOAN ADDED', date: '20 OCT 2026', by: 'Craig Moatshe', comment: 'Mandate 7' }));
  assert.deepEqual(row, { id: 'al_x', at: '2026-10-20T10:00:00.000Z', type: 'LOAN ADDED', ref: 'ECL-1', customer: 'Zee', amount: 1250.5, by: 'Craig Moatshe', comment: 'Mandate 7' });
  const noAt = L._.logToAudit({ ref: 'Q1', customer: '—', amount: 0, type: 'Q1 APP ACTION', date: '3 JAN 2026', by: 'Q1', comment: '', id: 'al_y' });
  assert.equal(new Date(noAt.at).getFullYear(), 2026);
  assert.equal(new Date(noAt.at).getMonth(), 0);
  assert.equal(new Date(noAt.at).getDate(), 3, 'label parsed when no at');

  // other keys seeded from the DB
  const petty = sv.petty; assert.equal(petty.length, 1);
  assert.equal(petty[0].cat, 'travel'); assert.equal(petty[0].status, 'PAID'); assert.equal(petty[0].iso, '2026-10-10'); assert.equal(petty[0].date, '10 Oct 2026'); assert.equal(petty[0].staffId, 'e1');
  const tx = read('ledjaa.bank.tx'); assert.equal(tx.length, 1); assert.equal(tx[0].at, Date.parse('2026-10-12T08:00:00Z')); assert.equal(tx[0].type, 'in');
  const exp = read('ledjaa.expenses'); assert.deepEqual(exp.map((x) => x.id), ['x1'], 'deleted expense dropped'); assert.equal(exp[0].cat, 'Other');
  const bank = read('ledjaa.bank'); assert.equal(bank.balance, 10000); assert.equal(bank.at, Date.parse('2026-10-01T06:00:00Z'));
  const org = read('evoltOrg'); assert.equal(org.name, 'Ecoloans'); assert.equal(org.legal, 'Ecoloans Finance (Pty) Ltd'); assert.equal(org.email, 'info@ecoloans.co.za'); assert.equal(org.admin, 'Craig Moatshe');
  assert.equal(read('ledjaa.clientRefHigh'), 15);
  assert.equal(L._.queue().length, 0, 'nothing to re-queue when local was empty');
});

test('keeps local logbook entries the DB lacks, re-queues them, and never duplicates on repeat writes', async () => {
  const localEntry = { ref: 'ECL-200', customer: 'Local Only', amount: 300, type: 'LOAN ADDED', date: '1 OCT 2026', by: 'Craig Moatshe', comment: 'offline' };
  // same content as audit row al_db_1 (by name instead of employee id) — a pre-bridge browser holds these
  const legacyDup = { ref: 'ECL-112', customer: 'Thabo M', amount: 1250.5, type: 'PAYMENT RECEIVED', date: '15 OCT 2026', by: 'Craig Moatshe', comment: 'Inst 2' };
  const sv0 = { clients: [{ id: 'c1' }], loans: [], logbook: [localEntry, legacyDup], petty: [], applications: [{ id: 'a9' }] };
  const { L, localStorage, read, queue } = await boot({ local: { 'ledjaa.supabase': { key: 'k' }, evoltConsoleV4: sv0 }, state: STATE });

  let sv = read('evoltConsoleV4');
  assert.equal(sv.logbook.length, 3, 'DB rows + the local extra; the legacy duplicate is matched by content');
  assert.equal(sv.logbook.filter((e) => e.ref === 'ECL-112').length, 1);
  assert.deepEqual(sv.applications, [{ id: 'a9' }], 'local applications kept');
  assert.deepEqual(sv.clients, [{ id: 'c1' }], 'local clients untouched');
  const extra = sv.logbook.find((e) => e.ref === 'ECL-200');
  assert.ok(extra.id.startsWith('al_'), 'derived id');
  let q = queue();
  assert.equal(q.length, 1);
  assert.equal(q[0].table, 'audit_log'); assert.equal(q[0].op, 'insert'); assert.equal(q[0].rows[0].id, extra.id); assert.equal(q[0].rows[0].by, 'Craig Moatshe');

  // the console persists its in-memory state: DB-seeded entries carry their ids, the entry added
  // in-memory does not (logAdd never sets one) → ids are re-derived identically, nothing new queued
  localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...sv, logbook: sv.logbook.map((e) => (e.ref === 'ECL-200' ? localEntry : e)) }));
  assert.equal(L._.queue().length, 1, 'ids are re-derived identically, nothing new queued');

  // logAdd prepends a new entry → exactly one more insert
  const fresh = { ref: 'ECL-113', customer: 'New One', amount: 750, type: 'PAYMENT RECEIVED', date: '29 OCT 2026', by: 'Craig Moatshe', comment: 'Inst 1' };
  const persisted = { ...sv, logbook: [fresh, ...sv.logbook] };
  localStorage.setItem('evoltConsoleV4', JSON.stringify(persisted));
  q = queue();
  assert.equal(q.length, 2);
  const op = q[1];
  assert.equal(op.table, 'audit_log'); assert.equal(op.op, 'insert');
  assert.equal(op.rows[0].ref, 'ECL-113'); assert.equal(op.rows[0].amount, 750); assert.equal(op.rows[0].type, 'PAYMENT RECEIVED');
  assert.match(op.rows[0].at, /^\d{4}-\d{2}-\d{2}T/);
  const stored = read('evoltConsoleV4');
  assert.equal(stored.logbook[0].id, op.rows[0].id, 'derived id injected into the stored entry');
  assert.equal(stored.logbook[0].ref, 'ECL-113');

  // repeat the identical write → still 2 ops
  localStorage.setItem('evoltConsoleV4', JSON.stringify(persisted));
  localStorage.setItem('evoltConsoleV4', JSON.stringify(read('evoltConsoleV4')));
  assert.equal(L._.queue().length, 2, 'no duplicate audit_log ops');

  // a second identical-looking entry on the same day is a different record
  localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...persisted, logbook: [fresh, ...persisted.logbook] }));
  q = queue();
  assert.equal(q.length, 3);
  assert.notEqual(q[2].rows[0].id, q[1].rows[0].id);

  // queue is persisted for offline recovery
  assert.equal(read('ledjaa.sync.queue').length, 3);
});

test('mirrors petty, bank tx, expenses, bank and org writes as the right ops', async () => {
  const { L, localStorage, read, queue } = await boot({ local: { 'ledjaa.supabase': { key: 'k' } }, state: STATE });
  const sv = read('evoltConsoleV4');
  const p = { id: 'p77', staffId: 'e1', staffName: 'Craig Moatshe', cat: 'printing', purpose: 'Flyers', borrower: '—', amount: 80, notes: '', iso: '2026-10-29', date: '29 Oct 2026', status: 'PENDING', by: '' };
  localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...sv, petty: [p, ...sv.petty] }));
  let q = queue();
  assert.equal(q.length, 1);
  assert.deepEqual(q[0], { table: 'petty_cash', op: 'upsert', rows: [{ id: 'p77', date: '2026-10-29', amount: 80, category: 'office', purpose: 'Flyers', borrower: '—', notes: '', status: 'PENDING', by: 'Craig Moatshe' }] });
  // status cycle → upsert replaces the pending op for the same row
  localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...sv, petty: [{ ...p, status: 'PAID' }, ...sv.petty] }));
  q = queue(); assert.equal(q.length, 1); assert.equal(q[0].rows[0].status, 'REPAID');

  const tx = read('ledjaa.bank.tx');
  const t = { type: 'out', amount: 4500, ref: 'Rent', label: 'Office expense · Oct', at: 1761727200000, by: 'Craig Moatshe' };
  localStorage.setItem('ledjaa.bank.tx', JSON.stringify([t, ...tx]));
  localStorage.setItem('ledjaa.bank.tx', JSON.stringify([t, ...tx]));
  q = queue(); assert.equal(q.length, 2);
  assert.equal(q[1].table, 'bank_tx'); assert.equal(q[1].op, 'insert'); assert.equal(q[1].rows[0].at, new Date(1761727200000).toISOString()); assert.equal(q[1].rows[0].amount, 4500);
  assert.ok(read('ledjaa.bank.tx')[0].id.startsWith('bt_'));

  const exp = read('ledjaa.expenses');
  localStorage.setItem('ledjaa.expenses', JSON.stringify([...exp, { id: 'x9', name: 'Wifi', amount: 699, cat: 'Utilities', day: 5, paid: {} }]));
  q = queue(); assert.equal(q.length, 3); assert.deepEqual(q[2], { table: 'expenses', op: 'upsert', rows: [{ id: 'x9', name: 'Wifi', amount: 699 }] });
  localStorage.setItem('ledjaa.expenses', JSON.stringify([{ id: 'x9', name: 'Wifi', amount: 699, cat: 'Utilities', day: 5, paid: {} }]));
  q = queue(); assert.equal(q.length, 4); assert.deepEqual(q[3], { table: 'expenses', op: 'soft_delete', id: 'x1' });

  localStorage.setItem('ledjaa.bank', JSON.stringify({ balance: 12345.5, at: 1761727200000, by: 'Craig Moatshe', history: [] }));
  q = queue(); assert.equal(q.length, 5); assert.deepEqual(q[4], { table: 'settings', op: 'upsert', rows: [{ id: 'org', bank_opening_balance: 12345.5, bank_opening_at: new Date(1761727200000).toISOString() }] });

  localStorage.setItem('evoltOrg', JSON.stringify({ name: 'Ecoloans', admin: 'Craig Moatshe', email: 'hello@ecoloans.co.za', legal: 'Ecoloans Finance (Pty) Ltd' }));
  // bank and org both patch settings/org → one merged upsert, never one clobbering the other
  q = queue(); assert.equal(q.length, 5);
  assert.deepEqual(q[4].rows[0], { id: 'org', bank_opening_balance: 12345.5, bank_opening_at: new Date(1761727200000).toISOString(), org_name: 'Ecoloans', org_legal_name: 'Ecoloans Finance (Pty) Ltd', contact_email: 'hello@ecoloans.co.za' });
  assert.ok(!('ncr_reg_no' in q[4].rows[0]));

  // flush posts the batch with the Bearer key and clears the queue
  await L._.flush();
  assert.equal(L._.queue().length, 0);
  assert.deepEqual(read('ledjaa.sync.queue'), []);
});

test('a failed or slow state fetch falls back to local-only and still injects the runtime', async () => {
  const sv0 = { clients: [], loans: [], logbook: [{ ref: 'X', customer: 'Y', amount: 1, type: 'T', date: '2 OCT 2026', by: 'me', comment: '' }], petty: [] };
  const { L, head, read, localStorage } = await boot({ local: { 'ledjaa.supabase': { key: 'k' }, evoltConsoleV4: sv0 }, state: { error: 'nope' }, stateStatus: 503 });
  assert.equal(await L.state, null);
  assert.match(L.error, /HTTP 503/);
  assert.equal(head.children.length, 1);
  assert.equal(L._.queue().length, 0, 'offline boot queues nothing it cannot diff');
  assert.ok(read('evoltConsoleV4').logbook[0].id, 'local entries still get ids');
  // writes after an offline boot are still mirrored
  localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...sv0, logbook: [{ ref: 'Z', customer: 'Q', amount: 2, type: 'T', date: '29 OCT 2026', by: 'me', comment: '' }, ...sv0.logbook] }));
  assert.equal(L._.queue().length, 1);
});
