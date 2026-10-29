// node --test tests/ledjaa-db.test.js
// Boots ledger/ledjaa-db.js against a stubbed window/localStorage/fetch and checks the
// console-vocabulary mapping, status normalisation and the sync queue payload.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal browser stubs (must exist before the module's top-level await runs) ----
const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: k => { store.delete(k); }
};
globalThis.localStorage = localStorage;
globalThis.window = globalThis; // no __ledger shim → the adapter fetches /state itself
localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: 'https://ledger.test/api/ledger', key: 'test-key', table: 'ledger_book', bookId: 'main' }));

const cloud = {
  employees: [{ id: 'e1', name: 'Craig Moatshe', email: 'craig@ecoloans.co.za', role: 'admin', active: true, approval_limit: 250000, created_at: '2025-11-01T08:00:00Z' }],
  clients: [
    { id: 'c_nupay_15', ref: 'EC-015', name: 'Prince Dube', id_number: '7511126083186', dob: '1975-11-12', phone: '0789515656', city: 'Marikana',
      province: 'North West', employment: 'Full-time', employer: 'Sibanye', job_title: 'Artisan', net_salary: '18500', bank: 'FNB', branch_code: '250655',
      account_no: '62379002802', account_type: 'Chequing Account', officer_id: 'e1', score: 0, blocked: false, expenses: { rent: 3000, groceries: 1500 },
      created_at: '2026-01-14T08:00:00Z', deleted_at: null },
    { id: 'c_gone', ref: 'EC-016', name: 'Archived Person', created_at: '2026-01-14T08:00:00Z', deleted_at: '2026-02-01T00:00:00Z' }
  ],
  loans: [
    { id: 'l_nupay_80786120', ref: 'ECL-112', client_id: 'c_nupay_15', principal: 4050, return_rate_pct: 35, instalment_amount: 4140.47,
      schedule: ['2026-09-25', '2026-10-23', '2026-11-25'], instalments_paid: 1, prior_instalments: 2, status: 'issued', mandate_id: '78056477',
      purpose: 'Personal', issued_on: '2026-08-05', issued_by: 'Craig Moatshe', officer_id: 'e1', paid_dates: ['2026-09-25'], created_at: '2026-08-05T08:00:00Z' },
    { id: 'l_paid', ref: 'ECL-090', client_id: 'c_nupay_15', principal: 1000, return_rate_pct: 35, instalment_amount: 1350,
      schedule: ['2026-03-25', '2026-04-25'], instalments_paid: 0, status: 'paid', created_at: '2026-02-20T08:00:00Z' },
    { id: 'l_settled', ref: 'ECL-091', client_id: 'c_nupay_15', principal: 500, instalment_amount: 675, schedule: ['2026-05-25'], instalments_paid: 1, status: 'settled_early', created_at: '2026-04-20T08:00:00Z' },
    { id: 'l_wo', ref: 'ECL-092', client_id: 'c_nupay_15', principal: 500, instalment_amount: 675, schedule: [], instalments_paid: 0, status: 'written_off', created_at: '2026-04-20T08:00:00Z' }
  ],
  applications: [], audit_log: [], petty_cash: [], bank_tx: [], expenses: [], settings: null, server_time: '2026-10-29T00:00:00Z'
};
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  if (/\/state$/.test(url)) return { ok: true, status: 200, json: async () => cloud };
  if (/\/sync$/.test(url)) { const ops = JSON.parse(init.body).ops; return { ok: true, status: 200, json: async () => ({ ok: true, results: ops.map(o => ({ table: o.table, op: o.op, count: 1 })) }) }; }
  return { ok: false, status: 404, json: async () => ({}) };
};

let m, db;
before(async () => { m = await import('../ledger/ledjaa-db.js'); db = m.db; await db.ready; });

test('boots from the cloud state and caches it', () => {
  assert.equal(db.sync.source, 'cloud');
  assert.equal(db.sync.status, 'ready');
  assert.equal(calls[0].url, 'https://ledger.test/api/ledger/state');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  assert.deepEqual(m.SEED_LOANS, []); assert.deepEqual(m.SEED_CLIENTS, []);
  assert.ok(m.SCHEMA.tables.find(t => t.name === 'audit_log').append_only);
  assert.ok(m.PERMISSIONS.loans.admin.includes('update'));
  const cached = JSON.parse(localStorage.getItem('ledjaa.db.v3'));
  assert.equal(cached.__v, m.SCHEMA.version);
  assert.equal(cached.data.loans.length, 4);
  assert.equal(globalThis.window.__ledgerDb, db);
});

test('toConsoleState maps loans with schedule, paid instalments and status like instNorm', () => {
  const s = db.toConsoleState();
  // every non-deleted row, none of the archived ones
  assert.deepEqual(s.clients.map(c => c.id), ['c_nupay_15']);
  assert.equal(s.loans.length, 4);

  const l = s.loans.find(x => x.id === 'l_nupay_80786120');
  assert.equal(l.clientId, 'c_nupay_15');
  assert.equal(l.amount, 4050);
  assert.equal(l.ret, 35);
  assert.equal(l.retAmt, 4140.47);
  assert.equal(l.status, 'issued');
  assert.deepEqual(l.sched, ['25 Sep 2026', '23 Oct 2026', '25 Nov 2026']);
  assert.equal(l.paidInst, 1);
  assert.equal(l.instDone, 2);
  assert.equal(l.due, '23 Oct 2026');       // sched[paidInst]
  assert.equal(l.nextDue, '25 Nov 2026');
  assert.equal(l.instNo, 4);                // instDone + idx + 1
  assert.equal(l.instTotal, 5);             // instDone + sched.length
  assert.equal(l.instRemaining, 2);
  assert.equal(l.mandate, '78056477');
  assert.equal(l.issued, '5 Aug 2026');
  assert.equal(l.issuedBy, 'Craig Moatshe');
  assert.equal(l.employeeId, 'e1');
  assert.equal(l.term, '5m');
  assert.deepEqual(l.paidDates, ['25 Sep 2026']);

  const paid = s.loans.find(x => x.id === 'l_paid');
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paidInst, 2);           // a paid loan reports every instalment paid
  assert.equal(paid.instRemaining, 0);
  assert.equal(paid.due, '25 Apr 2026');
  assert.equal(paid.nextDue, null);
  assert.equal(s.loans.find(x => x.id === 'l_settled').status, 'paid');
  const wo = s.loans.find(x => x.id === 'l_wo');
  assert.equal(wo.status, 'written off');
  assert.equal(wo.due, '—');
  assert.equal(wo.instTotal, 0);

  const c = s.clients[0];
  assert.equal(c.idFull, '7511126083186');
  assert.equal(c.added, '14 Jan 2026');
  assert.equal(c.employee, 'Craig Moatshe');
  assert.equal(c.netSalary, 18500);
  assert.equal(c.account, '62379002802');
  assert.equal(c.jobTitle, 'Artisan');
  assert.equal(c.email, '—');
  assert.equal(c.blocked, false);
  assert.equal(c.expRent, 3000);
  assert.equal(c.expFood, 1500);

  assert.deepEqual(s.employees.map(e => [e.id, e.role, e.status]), [['e1', 'Admin', 'ACTIVE']]);
  assert.equal(s.employees[0].added, '1 Nov 2025');
});

test('status normalisation both ways', () => {
  assert.equal(m.statusToConsole('written_off'), 'written off');
  assert.equal(m.statusToConsole('settled_early'), 'paid');
  assert.equal(m.statusToConsole('issued'), 'issued');
  assert.equal(m.statusToConsole('overdue'), 'overdue');
  assert.equal(m.statusToConsole('paid'), 'paid');
  assert.equal(m.statusToConsole(null), 'issued');

  assert.equal(m.statusToDb('written off'), 'written_off');
  assert.equal(m.statusToDb('WRITTEN OFF'), 'written_off');
  assert.equal(m.statusToDb('writtenoff'), 'written_off');
  assert.equal(m.statusToDb('duetoday'), 'issued');
  assert.equal(m.statusToDb('issued'), 'issued');
  assert.equal(m.statusToDb('overdue'), 'overdue');
  assert.equal(m.statusToDb('paid'), 'paid');
  assert.equal(m.statusToDb('paid', 'settled_early'), 'settled_early'); // never downgrade a settled loan
  assert.equal(m.statusToDb('settled early'), 'settled_early');
  assert.equal(m.statusToDb('restructured'), 'issued');
  assert.equal(m.statusToDb(''), 'issued');
  assert.equal(m.labelOf('2026-06-25'), '25 Jun 2026');
  assert.equal(m.labelOf('2026-06-05'), '5 Jun 2026');
  assert.equal(m.isoOf('25 Jun 2026'), '2026-06-25');
  assert.equal(m.isoOf('5 Jun 2026'), '2026-06-05');
  assert.equal(m.isoOf('—'), null);
});

test('update() queues an upsert with live column names only', async () => {
  db.setActor('e1');
  calls.length = 0;
  // the exact patch shape the console's dbPush() sends for an existing loan
  const row = db.update('loans', 'l_nupay_80786120', {
    ref: 'ECL-112', client_id: 'c_nupay_15', status: 'written off', due_date: '2026-10-23', purpose: 'Personal',
    schedule: ['25 Sep 2026', '23 Oct 2026', '25 Nov 2026'], issued_on: '2026-08-05', issued_by: 'Craig Moatshe',
    employee_id: null, mandate_id: '78056477', instalments_paid: 2
  });
  assert.equal(row.status, 'written_off');
  assert.equal(row.instalments_paid, 2);
  assert.equal(row.officer_id, 'e1');          // a null employee_id never clears the officer
  assert.equal(row.due_date, undefined);       // not a live column
  assert.ok(row.written_off_at);
  assert.equal(db.history('loans', 'l_nupay_80786120').length, 1);
  assert.equal(db.sync.pending, 1);
  assert.ok(JSON.parse(localStorage.getItem('ledjaa.db.queue')).ops.length === 1);

  await db.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ledger.test/api/ledger/sync');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-key');
  const ops = calls[0].body.ops;
  assert.equal(ops.length, 1);
  assert.equal(ops[0].table, 'loans');
  assert.equal(ops[0].op, 'upsert');
  const sent = ops[0].rows[0];
  const allowed = new Set(m.LIVE_COLUMNS.loans);
  Object.keys(sent).forEach(k => assert.ok(allowed.has(k), 'unexpected column ' + k));
  assert.equal(sent.id, 'l_nupay_80786120');
  assert.equal(sent.status, 'written_off');
  assert.equal(sent.instalment_amount, 4140.47);
  assert.deepEqual(sent.schedule, ['2026-09-25', '2026-10-23', '2026-11-25']);
  assert.equal(sent.officer_id, 'e1');
  assert.equal(sent.instalments_paid, 2);
  assert.equal('due_date' in sent, false);
  assert.equal('employee_id' in sent, false);
  assert.equal('instalment' in sent, false);
  assert.equal(db.sync.pending, 0);
  assert.equal(db.sync.status, 'ready');
  assert.deepEqual(JSON.parse(localStorage.getItem('ledjaa.db.queue')).ops, []);

  // an identical patch is a no-op: nothing versioned, nothing queued
  calls.length = 0;
  db.update('loans', 'l_nupay_80786120', { status: 'written off', schedule: ['25 Sep 2026', '23 Oct 2026', '25 Nov 2026'], employee_id: null });
  assert.equal(db.history('loans', 'l_nupay_80786120').length, 1);
  assert.equal(db.sync.pending, 0);
});

test('insert() and softDelete() map users→employees and never hard delete', async () => {
  calls.length = 0;
  db.insert('users', { id: 'e2', name: 'Poppy Sithole', email: 'poppy@ecoloans.co.za', role: 'Loan Officer', active: true,
    branch_id: null, client_id: null, approval_limit: 0, created_at: '2026-10-29T08:00:00Z', last_login_at: null, relogin_required_at: null });
  db.insert('clients', { id: 'c_new', ref: 'EC-017', name: 'New Client', id_number: null, phone: '0821234567', net_salary: 0, score: 0,
    blocked: false, blocked_at: null, dob: null, officer_id: null, branch_id: null, created_at: '2026-10-29T08:00:00Z', retain_until: null, deleted_at: null });
  db.softDelete('loans', 'l_wo', 'Removed in console');
  await new Promise(r => setTimeout(r, 5)); // console-driven archives are applied a tick later (burst guard)
  await db.flush();
  const ops = calls[0].body.ops;
  assert.deepEqual(ops.map(o => [o.table, o.op]), [['employees', 'upsert'], ['clients', 'upsert'], ['loans', 'soft_delete']]);
  assert.equal(ops[0].rows[0].role, 'agent');
  assert.equal('branch_id' in ops[0].rows[0], false);
  assert.equal('blocked_at' in ops[1].rows[0], false);
  assert.equal('branch_id' in ops[1].rows[0], false);
  assert.equal(ops[2].id, 'l_wo');
  assert.equal(ops[2].reason, 'Removed in console');
  assert.ok(db.find('loans', 'l_wo').deleted_at);
  assert.equal(db.toConsoleState().loans.some(l => l.id === 'l_wo'), false);
  assert.equal(db.toConsoleState().employees.length, 2);
  assert.equal(db.toConsoleState().clients.find(c => c.id === 'c_new').employee, 'Unassigned');
});

test('a console-created loan keeps its due date as a one-date schedule; principal_derived is never sent', async () => {
  calls.length = 0;
  // the exact insert shape the console's dbPush() sends for a loan it created (no sched, only due)
  const row = db.insert('loans', { id: 'l_new', ref: 'ECL-0113', client_id: 'c_nupay_15', principal: 1000, return_rate_pct: 35, status: 'issued',
    due_date: '25 Nov 2026', purpose: 'Groceries', instalment: 1350, schedule: undefined, issued_on: '2026-10-29', issued_by: 'Craig Moatshe',
    employee_id: null, mandate_id: null, instalments_paid: 0, application_id: null, term_months: 1, initiation_fee: 0, service_fee: 0,
    disbursed_on: '2026-10-29', parent_loan_id: null, relation: 'original', written_off_at: null, write_off_reason: null, written_off_by: null,
    officer_id: null, branch_id: null, created_at: '2026-10-29T08:00:00.000Z', deleted_at: null, principal_derived: null });
  assert.deepEqual(row.schedule, ['2026-11-25']);
  assert.equal('due_date' in row, false);
  assert.equal(db.toConsoleState().loans.find(l => l.id === 'l_new').due, '25 Nov 2026', 'the console sees the date again after a reload');
  await db.flush();
  const sent = calls[0].body.ops[0].rows[0];
  assert.deepEqual(sent.schedule, ['2026-11-25']);
  assert.equal('principal_derived' in sent, false);
  // a later save that still carries no schedule (sched derived from due only) must not clear it
  db.update('loans', 'l_new', { due_date: '2026-11-25', schedule: undefined, purpose: 'Groceries' });
  assert.deepEqual(db.find('loans', 'l_new').schedule, ['2026-11-25']);
  // ...and a loan that already has a multi-date schedule never gets it replaced by the next due date
  db.update('loans', 'l_nupay_80786120', { due_date: '2026-11-25', schedule: undefined });
  assert.deepEqual(db.find('loans', 'l_nupay_80786120').schedule, ['2026-09-25', '2026-10-23', '2026-11-25']);
});

test('a closed loan keeps its collection history: the console\'s "every instalment paid" view never rewrites it', async () => {
  calls.length = 0;
  const before = db.sync.pending;
  // what dbPush sends for l_paid (schedule 2, instalments_paid 0 in the DB; the console shows paidInst 2)
  db.update('loans', 'l_paid', { ref: 'ECL-090', client_id: 'c_nupay_15', status: 'paid', due_date: '2026-04-25', schedule: ['25 Mar 2026', '25 Apr 2026'], instalments_paid: 2 });
  assert.equal(db.find('loans', 'l_paid').instalments_paid, 0);
  db.update('loans', 'l_settled', { status: 'paid', instalments_paid: 1, paid_dates: ['25 May 2026'] });
  assert.equal(db.find('loans', 'l_settled').status, 'settled_early');
  assert.equal(db.find('loans', 'l_settled').instalments_paid, 1);
  assert.equal(db.sync.pending, before, 'nothing queued: the first boot does not touch closed loans');
  // reopening a loan is a real change and the counter travels with it
  db.update('loans', 'l_paid', { status: 'issued', instalments_paid: 1 });
  assert.equal(db.find('loans', 'l_paid').status, 'issued');
  assert.equal(db.find('loans', 'l_paid').instalments_paid, 1);
  await db.flush();
});

test('ops the server reports as retryable go back on the queue with backoff; final errors are dropped', async () => {
  const realFetch = globalThis.fetch;
  let outage = true;
  globalThis.fetch = async (url, init) => {
    const ops = JSON.parse(init.body).ops;
    return { ok: true, status: 200, json: async () => ({ ok: false, results: ops.map(o => outage && o.table === 'clients'
      ? { table: o.table, op: o.op, count: 0, error: 'Database unreachable', retryable: true }
      : o.table === 'loans' ? { table: o.table, op: o.op, count: 0, error: 'Database error 23505', retryable: false } : { table: o.table, op: o.op, count: 1 }) }) };
  };
  try {
    db.update('clients', 'c_new', { score: 41 });
    db.update('loans', 'l_new', { purpose: 'dup' });
    db.update('users', 'e2', { name: 'Poppy S' });
    await db.flush();
    assert.equal(db.sync.status, 'error');
    assert.equal(db.sync.attempts, 1);
    assert.equal(db.sync.pending, 1, 'only the outage op is kept');
    assert.deepEqual(db.queue.map(o => [o.table, o.rows[0].id]), [['clients', 'c_new']]);
    assert.deepEqual(JSON.parse(localStorage.getItem('ledjaa.db.queue')).ops.map(o => o.table), ['clients']);
    assert.ok(db._holdUntil > Date.now());
    outage = false; db._holdUntil = 0;
    await db.flush();
    assert.equal(db.sync.status, 'ready');
    assert.equal(db.sync.pending, 0);
    assert.equal(db.sync.attempts, 0);
  } finally { globalThis.fetch = realFetch; }
});

test('a burst of "Removed in console" archives is refused; small ones apply', async () => {
  for (let i = 1; i <= 7; i++) db.insert('loans', { id: 'l_b' + i, ref: 'ECL-b' + i, client_id: 'c_nupay_15', principal: 1, status: 'issued', due_date: '2026-12-25' });
  await db.flush();
  const live = db.rows('loans').length;
  const limit = Math.max(3, Math.ceil(live * 0.1));
  assert.ok(limit < 7);
  calls.length = 0;
  for (let i = 1; i <= limit + 1; i++) db.softDelete('loans', 'l_b' + i, 'Removed in console');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(db.rows('loans').length, live, 'a stale console state cannot archive the book');
  assert.equal(db.sync.pending, 0);
  for (let i = 1; i <= 2; i++) db.softDelete('loans', 'l_b' + i, 'Removed in console');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(db.rows('loans').length, live - 2);
  await db.flush();
  assert.deepEqual(calls[0].body.ops.map(o => [o.op, o.id]), [['soft_delete', 'l_b1'], ['soft_delete', 'l_b2']]);
  const explicit = db.softDelete('loans', 'l_b7', 'Client request');
  assert.ok(explicit.deleted_at, 'an explicit, reasoned archive applies at once');
  await db.flush();
  assert.equal(db.sync.pending, 0);
});

test('an adapter with neither cloud nor cache never originates writes', async () => {
  const src = db.sync.source; const pending = db.sync.pending;
  db.sync.source = 'empty';
  try {
    assert.equal(db.insert('clients', { id: 'c_demo', ref: 'EC-032', name: 'Viginia Morola' }), null);
    assert.equal(db.update('clients', 'c_new', { score: 99 }), null);
    assert.equal(db.softDelete('loans', 'l_new', 'Removed in console'), null);
    assert.equal(db.find('clients', 'c_demo'), null);
    assert.equal(db.find('clients', 'c_new').score, 41);
    assert.equal(db.sync.pending, pending);
  } finally { db.sync.source = src; }
});

test('a failed sync keeps the queue, backs off and persists it', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  db.update('clients', 'c_new', { score: 40 });
  await db.flush();
  assert.equal(db.sync.status, 'error');
  assert.equal(db.sync.attempts, 1);
  assert.equal(db.sync.pending, 1);
  assert.equal(JSON.parse(localStorage.getItem('ledjaa.db.queue')).ops.length, 1);
  globalThis.fetch = realFetch;
  db._holdUntil = 0;
  await db.flush();
  assert.equal(db.sync.status, 'ready');
  assert.equal(db.sync.pending, 0);
});
