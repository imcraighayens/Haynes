// node --test tests/api/   — /api/ledger/* (state, sync, ledger_book emulation) with a stubbed fetch.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ENV = { SUPABASE_URL: 'https://db.test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN', LEDGER_KEY: 'ledger-test-key-0123456789abcdef' };
const KEY = ENV.LEDGER_KEY;
Object.assign(process.env, ENV);

const handler = (await import('../../api/ledger.js')).default;

// ---- tiny req/res + fetch fakes -------------------------------------------------------------------
function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
async function call({ method = 'GET', path = [], url, headers = {}, body, auth = true }) {
  const req = { method, query: { path }, url: url || '/api/ledger/' + path.join('/'), headers: { ...(auth ? { authorization: 'Bearer ' + KEY } : {}), ...headers }, body };
  const res = makeRes();
  if (!process.env.__keepEnv) Object.assign(process.env, ENV);
  await handler(req, res);
  return res;
}
let calls = [];
function stubFetch(route) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = { url: u, table: u.pathname.split('/').pop(), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(rec);
    const out = (await route(rec)) || { status: 200, body: [] };
    const text = out.body === undefined ? '' : JSON.stringify(out.body);
    return { ok: out.status < 400, status: out.status, headers: new Headers(out.headers || {}), text: async () => text, json: async () => JSON.parse(text) };
  };
}
const tableRows = {
  clients: [{ id: 'c1', ref: 'EC-001', name: 'A', deleted_at: null }, { id: 'c2', ref: 'EC-002', name: 'B', deleted_at: '2026-01-01T00:00:00Z' }],
  loans: [{ id: 'l1', ref: 'ECL-1', client_id: 'c1', status: 'issued' }],
  employees: [{ id: 'e1', name: 'Craig Moatshe', role: 'admin' }],
  applications: [], audit_log: [{ id: 'a1', type: 'PAYMENT RECEIVED', by: 'e1' }], petty_cash: [], bank_tx: [], expenses: [],
  settings: [], ledger_book: [{ updated_at: '2026-10-28T10:00:00Z' }]
};
describe('ledger', () => {

beforeEach(() => stubFetch(r => ({ status: 200, body: tableRows[r.table] || [] })));

// ---- auth -----------------------------------------------------------------------------------------
test('ledger: 401 without a key, with a wrong key, and never leaks the service key', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'Bearer ' + KEY.slice(0, -1) }]) {
    const res = await call({ path: ['state'], auth: false, headers });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: 'Unauthorized' });
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(calls.length, 0, 'no database call before auth');
  const ok = await call({ path: ['state'], auth: false, headers: { apikey: KEY } });
  assert.equal(ok.statusCode, 200);
  assert.ok(!JSON.stringify(ok.json()).includes('service-role-secret'));
});

test('ledger: missing env is a 503 with a plain message', async () => {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.__keepEnv = '1';
  try { const res = await call({ path: ['state'] }); assert.equal(res.statusCode, 503); assert.deepEqual(res.json(), { error: 'Server not configured' }); }
  finally { delete process.env.__keepEnv; process.env.SUPABASE_SERVICE_ROLE_KEY = saved; }
});

// ---- state ----------------------------------------------------------------------------------------
test('ledger GET state: shape, parallel per-table selects with service headers, limits and ordering', async () => {
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  assert.deepEqual(Object.keys(s).sort(), ['applications', 'attention', 'audit_log', 'bank_tx', 'clients', 'employees', 'expenses', 'ledger_book', 'loans', 'petty_cash', 'server_time', 'settings'].sort());
  assert.deepEqual(s.attention, { ready: true, rows: [], viewer: '' });
  assert.equal(s.clients.length, 2, 'deleted rows are included; the client filters');
  assert.equal(s.settings, null, 'no org row yet → null');
  assert.deepEqual(s.ledger_book, { updated_at: '2026-10-28T10:00:00Z' });
  assert.ok(!Number.isNaN(Date.parse(s.server_time)));
  const byTable = Object.fromEntries(calls.map(c => [c.table, c]));
  assert.equal(byTable.audit_log.url.searchParams.get('limit'), '1000');
  assert.equal(byTable.audit_log.url.searchParams.get('order'), 'at.desc');
  assert.equal(byTable.bank_tx.url.searchParams.get('limit'), '500');
  assert.equal(byTable.settings.url.searchParams.get('id'), 'eq.org');
  for (const c of calls) {
    assert.equal(c.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(c.headers.Authorization, 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(c.method, 'GET');
  }
});

test('ledger GET state: a missing attention table does not fail the book', async () => {
  stubFetch(r => r.table === 'ledger_attention' ? { status: 404, body: { code: '42P01', message: 'relation does not exist' } } : { status: 200, body: tableRows[r.table] || [] });
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().attention, { ready: false, rows: [], viewer: '' });
});

test('ledger POST attention: stores one marker per staff email and loan, and ignores a missing table', async () => {
  const { mintStaffSession } = await import('../../api/_lib/auth.js');
  const { token } = mintStaffSession(Date.now(), { email: 'staff@test.invalid', displayName: 'Test Staff' });
  const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
  stubFetch(r => ({ status: 200, body: r.method === 'POST' ? (r.body || []) : [] }));
  const saved = await call({ method: 'POST', path: ['attention'], headers, body: { items: [
    { loanId: 'l_test_902', marker: 'overdue|2026-08-01|2026-10-02T08:00:00.000Z' },
    { loanId: 'not a loan', marker: 'overdue||' },
    { loanId: 'l_test_902', marker: 'nope' }
  ] } });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().ready, true);
  assert.equal(saved.json().saved, 1);
  const write = calls.find(c => c.table === 'ledger_attention' && c.method === 'POST');
  assert.equal(write.body.length, 1);
  assert.equal(write.body[0].staff_email, 'staff@test.invalid');
  assert.equal(write.body[0].loan_id, 'l_test_902');
  assert.equal(write.body[0].id, 'staff@test.invalid:l_test_902');
  stubFetch(r => r.table === 'ledger_attention' ? { status: 404, body: { code: '42P01', message: 'relation does not exist' } } : { status: 200, body: [] });
  const missing = await call({ method: 'POST', path: ['attention'], headers, body: { items: [{ loanId: 'l_test_902', marker: 'overdue|2026-08-01|' }] } });
  assert.equal(missing.statusCode, 200);
  assert.deepEqual(missing.json(), { ready: false, saved: 0 });
});

test('loan-status updates public.loans and audit_log together, and puts the loan back if the audit insert fails', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', client_id: 'c_synth', status: 'overdue', status_at: '2026-11-05T08:00:00.000Z', principal: 4050, instalment_amount: 4140.47, deleted_at: null };
  const client = { id: 'c_synth', name: 'Synthetic Borrower' };
  let failAudit = false;
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'clients' && r.method === 'GET') return { status: 200, body: [client] };
    if (r.table === 'loans' && r.method === 'PATCH') { Object.assign(loan, r.body); return { status: 200, body: [{ ...loan }] }; }
    if (r.table === 'audit_log' && r.method === 'POST') {
      if (failAudit) return { status: 500, body: { code: 'XX000', message: 'hidden' } };
      return { status: 200, body: r.body };
    }
    return { status: 200, body: [] };
  });
  const res = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', note: 'Marked paid' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().loan.status, 'paid');
  assert.ok(res.json().loan.status_at);
  assert.ok(res.json().loan.instalments_paid >= 1);
  assert.equal(res.json().loan.paid_dates.length, 1);
  assert.equal(loan.status, 'paid');
  const audit = calls.find(c => c.table === 'audit_log' && c.method === 'POST');
  assert.ok(audit);
  assert.equal(audit.body[0].ref, 'SYN-9050');
  assert.equal(audit.body[0].customer, 'Synthetic Borrower');
  assert.equal(audit.body[0].amount, 4140.47);
  const patchCall = calls.find(c => c.table === 'loans' && c.method === 'PATCH');
  const patch = patchCall.body;
  assert.equal(patchCall.url.searchParams.get('updated_at'), 'is.null');
  assert.equal(patch.status, 'paid');
  assert.ok(patch.status_at);
  assert.ok(patch.updated_at);
  assert.equal(patch.updated_by, 'staff');
  assert.ok(patch.instalments_paid >= 1);
  assert.equal(Array.isArray(patch.paid_dates) && patch.paid_dates.length, 1);
  const writes = calls.filter(c => c.method === 'PATCH' || (c.table === 'audit_log' && c.method === 'POST')).map(c => c.table + ' ' + c.method);
  assert.deepEqual(writes, ['loans PATCH', 'audit_log POST']);
  failAudit = true;
  const bad = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'issued', note: 'should roll back' } });
  assert.equal(bad.statusCode, 502);
  assert.equal(loan.status, 'paid');
  assert.equal(bad.body.includes('hidden'), false);
  const patches = calls.filter(c => c.table === 'loans' && c.method === 'PATCH');
  const revert = patches[patches.length - 1];
  assert.equal(revert.url.searchParams.get('updated_at'), 'eq.' + patches[patches.length - 2].body.updated_at);
  assert.equal(revert.body.status, 'paid');
});

test('loan-status does not write an audit row when the loan update changes no rows', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', client_id: 'c_synth', status: 'overdue', deleted_at: null, instalment_amount: 10, schedule: [], paid_dates: [] };
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') return { status: 200, body: [] };
    if (r.table === 'clients' && r.method === 'GET') return { status: 200, body: [{ id: 'c_synth', name: 'Synthetic Borrower' }] };
    return { status: 200, body: [] };
  });
  const res = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', note: 'no row' } });
  assert.equal(res.statusCode, 409);
  assert.equal(calls.some(c => c.table === 'audit_log'), false);
  assert.equal(loan.status, 'overdue');
});

test('loan-status refuses a written-off loan and will not turn settled_early into paid', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', status: 'written_off', deleted_at: null, updated_at: '2026-11-01T00:00:00.000Z' };
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') { Object.assign(loan, r.body); return { status: 200, body: [{ ...loan }] }; }
    return { status: 200, body: [] };
  });
  const written = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', requestId: 'req-written' } });
  assert.equal(written.statusCode, 409);
  assert.match(written.json().error, /written-off/);
  assert.equal(calls.some(c => c.method === 'PATCH'), false);
  loan.status = 'settled_early';
  const settled = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', requestId: 'req-settled' } });
  assert.equal(settled.statusCode, 409);
  assert.match(settled.json().error, /settled/);
  assert.equal(loan.status, 'settled_early');
  assert.equal(calls.some(c => c.method === 'PATCH'), false);
});

test('loan-status advances one instalment and closes the loan only on the last one', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', client_id: 'c_synth', status: 'overdue', instalments_paid: 0, paid_dates: [], schedule: ['2026-09-01', '2026-10-01', '2026-11-01'], instalment_amount: 100, deleted_at: null, updated_at: '2026-11-01T00:00:00.000Z' };
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') {
      const filter = r.url.searchParams.get('updated_at');
      if (filter !== 'eq.' + loan.updated_at) return { status: 200, body: [] };
      Object.assign(loan, r.body);
      return { status: 200, body: [{ ...loan }] };
    }
    if (r.table === 'clients') return { status: 200, body: [{ id: 'c_synth', name: 'Synthetic Borrower' }] };
    if (r.table === 'audit_log') return { status: 200, body: r.body };
    return { status: 200, body: [] };
  });
  const early = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', instalmentsPaid: 1, requestId: 'inst-1' } });
  assert.equal(early.statusCode, 422);
  assert.match(early.json().error, /does not close/);
  assert.equal(loan.status, 'overdue');
  assert.equal(loan.instalments_paid, 0);
  const step = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'overdue', instalmentsPaid: 1, requestId: 'inst-1' } });
  assert.equal(step.statusCode, 200);
  assert.equal(loan.status, 'overdue');
  assert.equal(loan.instalments_paid, 1);
  assert.equal(loan.paid_dates.length, 1);
  loan.instalments_paid = 2;
  const done = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', instalmentsPaid: 3, requestId: 'inst-3' } });
  assert.equal(done.statusCode, 200);
  assert.equal(loan.status, 'paid');
  assert.ok(loan.instalments_paid >= 3);
});

test('loan-status audit id is stable for the same request and a stale updated_at is a 409', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', client_id: 'c_synth', status: 'issued', instalments_paid: 0, paid_dates: [], schedule: [], instalment_amount: 10, deleted_at: null, updated_at: '2026-11-01T00:00:00.000Z' };
  let conflict = false;
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') {
      if (conflict) return { status: 200, body: [] };
      if (r.url.searchParams.get('updated_at') !== 'eq.' + loan.updated_at) return { status: 200, body: [] };
      Object.assign(loan, r.body);
      return { status: 200, body: [{ ...loan }] };
    }
    if (r.table === 'clients') return { status: 200, body: [{ id: 'c_synth', name: 'Synthetic Borrower' }] };
    if (r.table === 'audit_log') return { status: 200, body: r.body };
    return { status: 200, body: [] };
  });
  const first = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'overdue', requestId: 'same-click' } });
  const second = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'overdue', requestId: 'same-click' } });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.json().audit.id, second.json().audit.id);
  assert.match(first.json().audit.id, /^al_[a-f0-9]{32}$/);
  const token = loan.updated_at;
  conflict = true;
  const raced = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', requestId: 'other-click' } });
  assert.equal(raced.statusCode, 409);
  assert.match(raced.json().error, /changed while/);
  const racedPatch = calls.filter(c => c.table === 'loans' && c.method === 'PATCH').pop();
  assert.equal(racedPatch.url.searchParams.get('updated_at'), 'eq.' + token);
  assert.equal(calls.filter(c => c.table === 'audit_log').length, 2);
});

test('a failed audit does not roll back a newer loan write', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', client_id: 'c_synth', status: 'issued', instalments_paid: 0, paid_dates: [], schedule: [], deleted_at: null, updated_at: '2026-11-01T00:00:00.000Z' };
  let wrote = '';
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') {
      const filter = r.url.searchParams.get('updated_at');
      const expect = loan.updated_at == null ? 'is.null' : 'eq.' + loan.updated_at;
      if (filter !== expect) return { status: 200, body: [] };
      Object.assign(loan, r.body);
      wrote = r.body.updated_at;
      return { status: 200, body: [{ ...loan }] };
    }
    if (r.table === 'audit_log') {
      loan.updated_at = '2099-01-01T00:00:00.000Z';
      loan.status = 'overdue';
      return { status: 500, body: { code: 'XX000', message: 'hidden' } };
    }
    return { status: 200, body: [] };
  });
  const res = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', requestId: 'race' } });
  assert.equal(res.statusCode, 502);
  assert.equal(loan.status, 'overdue');
  assert.equal(loan.updated_at, '2099-01-01T00:00:00.000Z');
  const revert = calls.filter(c => c.method === 'PATCH').pop();
  assert.equal(revert.url.searchParams.get('updated_at'), 'eq.' + wrote);
});

test('ledger GET state: survives a missing ledger_book table (pre-migration)', async () => {
  stubFetch(r => r.table === 'ledger_book' ? { status: 404, body: { code: '42P01', message: 'relation does not exist' } } : { status: 200, body: tableRows[r.table] || [] });
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ledger_book, null);
});

test('ledger GET state: database failure is a JSON 502 without details', async () => {
  stubFetch(r => r.table === 'loans' ? { status: 500, body: { code: 'XX000', message: 'secret internals' } } : { status: 200, body: [] });
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'Database error XX000' });
});

// ---- sync -----------------------------------------------------------------------------------------
test('ledger POST sync: whitelist drops unknown columns, strips NCR/fee settings, merge vs ignore duplicates', async () => {
  stubFetch(r => ({ status: 200, body: r.method === 'PATCH' ? [{ id: r.url.searchParams.get('id').slice(3), ...r.body }] : (r.body || []) }));
  const res = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'upsert', rows: [{ id: 'l1', ref: 'ECL-1', client_id: 'c1', principal: '100', status: 'Settled early', bogus: 'x', due: '25 Jun 2026', schedule: ['25 Jun 2026'] }] },
    { table: 'audit_log', op: 'insert', rows: [{ id: 'a9', at: 1793232000000, type: 'LOAN ADDED', by: 'Craig', amount: '100', secret: 1 }] },
    { table: 'bank_tx', op: 'upsert', rows: [{ id: 'b1', at: '2026-10-29T00:00:00Z', type: 'IN', amount: 5 }] },
    { table: 'settings', op: 'upsert', rows: [{ id: 'anything', org_name: 'Ecoloans', ncr_reg_no: 'NCRCP1', company_reg_no: 'X', default_collection_fee: 1, protection_fee: 2 }] },
    { table: 'expenses', op: 'soft_delete', id: 'x1', reason: 'gone' }
  ] } });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.ok, true);
  assert.deepEqual(out.results.map(r => [r.table, r.op, r.count]), [['loans', 'upsert', 1], ['audit_log', 'insert', 1], ['bank_tx', 'upsert', 1], ['settings', 'upsert', 1], ['expenses', 'soft_delete', 1]]);

  const loans = calls.find(c => c.table === 'loans' && c.method === 'POST');
  const audit = calls.find(c => c.table === 'audit_log');
  const bank = calls.find(c => c.table === 'bank_tx');
  const settings = calls.find(c => c.table === 'settings');
  const exp = calls.find(c => c.table === 'expenses');
  assert.equal(loans.method, 'POST');
  assert.equal(loans.url.searchParams.get('on_conflict'), 'id');
  assert.equal(loans.headers.Prefer, 'resolution=merge-duplicates,return=representation');
  const created = loans.body[0];
  assert.equal(created.id, 'l1');
  assert.equal(created.ref, 'ECL-1');
  assert.equal(created.client_id, 'c1');
  assert.equal(created.principal, 100);
  assert.deepEqual(created.schedule, ['2026-06-25']);
  assert.equal(created.status, 'issued');
  assert.equal(created.instalments_paid, 0);
  assert.deepEqual(created.paid_dates, []);
  assert.match(created.status_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(created.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(created.updated_by, null);
  assert.equal(created.bogus, undefined);

  assert.equal(audit.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
  assert.deepEqual(audit.body, [{ id: 'a9', at: '2026-10-29T00:00:00.000Z', type: 'LOAN ADDED', amount: 100, by: 'Craig' }]);
  assert.equal(bank.headers.Prefer, 'resolution=ignore-duplicates,return=representation');
  assert.equal(bank.body[0].type, 'in');

  assert.deepEqual(settings.body, [{ id: 'org', org_name: 'Ecoloans' }], 'singleton id forced, NCR/fee columns never written');
  assert.equal(settings.url.searchParams.get('on_conflict'), 'id');

  assert.equal(exp.method, 'PATCH');
  assert.equal(exp.url.searchParams.get('id'), 'eq.x1');
  assert.deepEqual(Object.keys(exp.body), ['deleted_at'], 'soft delete only sets deleted_at');
  assert.ok(!calls.some(c => c.method === 'DELETE'), 'never DELETE');
});

test('ledger POST sync strips loan status fields on update and on an existing upsert', async () => {
  stubFetch(r => {
    if (r.method === 'GET' && r.table === 'loans') return { status: 200, body: [{ id: 'l1' }] };
    if (r.method === 'PATCH') return { status: 200, body: [{ id: 'l1', ...r.body }] };
    return { status: 200, body: r.body || [] };
  });
  const updated = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'update', id: 'l1', patch: { status: 'paid', status_at: '2020-01-01T00:00:00.000Z', instalments_paid: 9, paid_dates: ['2020-01-01'], purpose: 'School fees' } }
  ] } });
  assert.equal(updated.statusCode, 200);
  const patch = calls.find(c => c.method === 'PATCH').body;
  assert.equal(patch.purpose, 'School fees');
  assert.equal(patch.status, undefined);
  assert.equal(patch.status_at, undefined);
  assert.equal(patch.instalments_paid, undefined);
  assert.equal(patch.paid_dates, undefined);
  calls.length = 0;
  const again = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'upsert', rows: [{ id: 'l1', ref: 'SYN-1', client_id: 'c1', principal: 100, status: 'paid', status_at: '2020-01-01T00:00:00.000Z', instalments_paid: 4, paid_dates: ['2020-01-01'] }] }
  ] } });
  assert.equal(again.statusCode, 200);
  const row = calls.find(c => c.table === 'loans' && c.method === 'POST').body[0];
  assert.equal(row.ref, 'SYN-1');
  assert.equal(row.status, undefined);
  assert.equal(row.instalments_paid, undefined);
  assert.equal(row.paid_dates, undefined);
  calls.length = 0;
  const empty = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'update', id: 'l1', patch: { status: 'paid', instalments_paid: 1, paid_dates: ['2020-01-01'], status_at: '2020-01-01T00:00:00.000Z' } }
  ] } });
  assert.equal(empty.json().results[0].count, 0);
  assert.equal(calls.some(c => c.method === 'PATCH'), false);
});

test('sync does not rewind updated_at or updated_by, and a new loan gets server stamps', async () => {
  stubFetch(r => {
    if (r.method === 'GET' && r.table === 'loans') return { status: 200, body: [{ id: 'l1' }] };
    if (r.method === 'PATCH') return { status: 200, body: [{ id: 'l1', ...r.body }] };
    return { status: 200, body: r.body || [] };
  });
  const updated = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'update', id: 'l1', patch: { purpose: 'School fees', updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'browser' } }
  ] } });
  assert.equal(updated.statusCode, 200);
  const patch = calls.find(c => c.method === 'PATCH').body;
  assert.deepEqual(patch, { purpose: 'School fees' });
  calls.length = 0;
  const again = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'upsert', rows: [{ id: 'l1', ref: 'SYN-1', client_id: 'c1', principal: 100, updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'browser', status: 'paid' }] }
  ] } });
  assert.equal(again.statusCode, 200);
  const kept = calls.find(c => c.table === 'loans' && c.method === 'POST').body[0];
  assert.equal(kept.ref, 'SYN-1');
  assert.equal(kept.updated_at, undefined);
  assert.equal(kept.updated_by, undefined);
  assert.equal(kept.status, undefined);
  calls.length = 0;
  const created = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'insert', rows: [{ id: 'l_new', ref: 'SYN-2', client_id: 'c1', principal: 40, updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'browser', status: 'paid' }] }
  ] } });
  assert.equal(created.statusCode, 200);
  const fresh = calls.find(c => c.table === 'loans' && c.method === 'POST').body[0];
  assert.equal(fresh.status, 'issued');
  assert.equal(fresh.updated_by, null);
  assert.match(fresh.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.notEqual(fresh.updated_at, '2020-01-01T00:00:00.000Z');
});

test('replace_book keeps status columns on an existing loan and defaults them on a new one', async () => {
  process.env.LEDGER_MANAGER_PIN = 'fixture-manager-pin';
  try {
    stubFetch(r => {
      if (r.method === 'GET') return { status: 200, body: [{ id: 'l_keep', deleted_at: null }, { id: 'l_gone', deleted_at: '2026-01-01T00:00:00.000Z' }] };
      if (r.method === 'PATCH') return { status: 200, body: [{ id: 'l_keep', deleted_at: '2026-11-10T00:00:00.000Z' }] };
      return { status: 200, body: r.body || [] };
    });
    const rows = [
      { id: 'l_keep', ref: 'SYN-1', client_id: 'c1', principal: 100, purpose: 'School fees', status: 'paid', status_at: '2020-01-01T00:00:00.000Z', instalments_paid: 4, paid_dates: ['2020-01-01'], updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'browser' },
      { id: 'l_new', ref: 'SYN-2', client_id: 'c1', principal: 50, status: 'paid', status_at: '2020-01-01T00:00:00.000Z', instalments_paid: 9, paid_dates: ['2020-01-01'], updated_at: '2020-01-01T00:00:00.000Z', updated_by: 'browser' }
    ];
    const viaSync = await call({ method: 'POST', path: ['sync'], body: { ops: [
      { table: 'loans', op: 'replace_book', manager_pin: 'fixture-manager-pin', rows }
    ] } });
    assert.equal(viaSync.statusCode, 200);
    assert.equal(viaSync.json().ok, true);
    const posted = calls.find(c => c.table === 'loans' && c.method === 'POST').body;
    const kept = posted.find(r => r.id === 'l_keep');
    const created = posted.find(r => r.id === 'l_new');
    assert.equal(kept.purpose, 'School fees');
    assert.equal(kept.deleted_at, null);
    assert.equal(kept.status, undefined);
    assert.equal(kept.status_at, undefined);
    assert.equal(kept.instalments_paid, undefined);
    assert.equal(kept.paid_dates, undefined);
    assert.equal(kept.updated_at, undefined);
    assert.equal(kept.updated_by, undefined);
    assert.equal(created.status, 'issued');
    assert.equal(created.instalments_paid, 0);
    assert.deepEqual(created.paid_dates, []);
    assert.equal(created.updated_by, null);
    assert.match(created.updated_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.notEqual(created.updated_at, '2020-01-01T00:00:00.000Z');
    assert.equal(created.deleted_at, null);
    calls.length = 0;
    const viaDestructive = await call({ method: 'POST', path: ['destructive'], body: { action: 'replace_book', pin: 'fixture-manager-pin', rows } });
    assert.equal(viaDestructive.statusCode, 200);
    const again = calls.find(c => c.table === 'loans' && c.method === 'POST').body.find(r => r.id === 'l_keep');
    assert.equal(again.status, undefined);
    assert.equal(again.updated_at, undefined);
    assert.equal(again.updated_by, undefined);
  } finally {
    delete process.env.LEDGER_MANAGER_PIN;
  }
});

test('loan-status returns 404 for a deleted loan and does not write', async () => {
  const loan = { id: 'l_synth', ref: 'SYN-9050', status: 'overdue', deleted_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' };
  stubFetch(r => {
    if (r.table === 'loans' && r.method === 'GET') return { status: 200, body: [{ ...loan }] };
    if (r.table === 'loans' && r.method === 'PATCH') { Object.assign(loan, r.body); return { status: 200, body: [{ ...loan }] }; }
    return { status: 200, body: [] };
  });
  const res = await call({ method: 'POST', path: ['loan-status'], body: { loanId: 'l_synth', status: 'paid', requestId: 'deleted' } });
  assert.equal(res.statusCode, 404);
  assert.equal(loan.status, 'overdue');
  assert.equal(calls.some(c => c.method === 'PATCH' || c.table === 'audit_log'), false);
});

test('ledger POST sync: audit_log update/soft_delete rejected as no-op, unknown table reported, rest still applied', async () => {
  stubFetch(r => ({ status: 200, body: r.method === 'PATCH' ? [{ id: 'c1', ...r.body }] : (r.body || []) }));
  const res = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'audit_log', op: 'update', id: 'a1', patch: { comment: 'tamper' } },
    { table: 'audit_log', op: 'soft_delete', id: 'a1' },
    { table: 'bank_tx', op: 'update', id: 'b1', patch: { amount: 1 } },
    { table: 'payments', op: 'upsert', rows: [{ id: 'p1' }] },
    { table: 'clients', op: 'update', id: 'c1', patch: { name: 'New', ncr: 'x' } },
    { table: 'loans', op: 'upsert', rows: [{ ref: 'no-id' }] },
    { table: 'employees', op: 'soft_delete', id: 'e1' }
  ] } });
  const out = res.json();
  assert.equal(res.statusCode, 200);
  assert.equal(out.ok, false);
  assert.equal(out.results[0].count, 0); assert.match(out.results[0].error, /append-only/);
  assert.equal(out.results[1].count, 0); assert.match(out.results[1].error, /append-only/);
  assert.match(out.results[2].error, /not allowed/);
  assert.match(out.results[3].error, /not syncable/);
  assert.deepEqual(out.results[4], { table: 'clients', op: 'update', count: 1 });
  assert.match(out.results[5].error, /string id/);
  assert.match(out.results[6].error, /not allowed on employees/);
  assert.equal(calls.length, 1, 'only the valid clients update reached the database');
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url.searchParams.get('id'), 'eq.c1');
  assert.deepEqual(calls[0].body, { name: 'New' });
});

test('ledger POST sync: a database error on one op is reported, not thrown', async () => {
  stubFetch(r => r.table === 'loans' ? { status: 409, body: { code: '23503' } } : { status: 200, body: r.body || [] });
  const res = await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'upsert', rows: [{ id: 'l1', ref: 'x', client_id: 'ghost' }] },
    { table: 'clients', op: 'upsert', rows: [{ id: 'c1', ref: 'EC-1', name: 'A' }] }
  ] } });
  const out = res.json();
  assert.equal(out.ok, false);
  assert.deepEqual(out.results[0], { table: 'loans', op: 'upsert', count: 0, error: 'Database error 23503', retryable: false });
  assert.deepEqual(out.results[1], { table: 'clients', op: 'upsert', count: 1 });
});

test('ledger POST sync: upstream outages are reported as retryable, validation/conflict errors are not', async () => {
  stubFetch(r => r.table === 'loans' ? { status: 503, body: { code: 'XX000', message: 'pooler restarting' } } : { status: 200, body: r.body || [] });
  let out = (await call({ method: 'POST', path: ['sync'], body: { ops: [
    { table: 'loans', op: 'upsert', rows: [{ id: 'l1', ref: 'x', client_id: 'c1' }] },
    { table: 'audit_log', op: 'update', id: 'a1', patch: { comment: 'x' } },
    { table: 'clients', op: 'upsert', rows: [{ id: 'c1', ref: 'EC-1', name: 'A' }] }
  ] } })).json();
  assert.equal(out.ok, false);
  assert.deepEqual(out.results[0], { table: 'loans', op: 'upsert', count: 0, error: 'Database error XX000', retryable: true });
  assert.equal(out.results[1].retryable, false, 'append-only violation is final');
  assert.deepEqual(out.results[2], { table: 'clients', op: 'upsert', count: 1 });

  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  out = (await call({ method: 'POST', path: ['sync'], body: { ops: [{ table: 'clients', op: 'upsert', rows: [{ id: 'c1', ref: 'EC-1', name: 'A' }] }] } })).json();
  assert.deepEqual(out.results[0], { table: 'clients', op: 'upsert', count: 0, error: 'Database unreachable', retryable: true });
  assert.equal((await call({ method: 'POST', path: ['sync'], body: { ops: [{ table: 'loans', op: 'upsert', rows: [{ id: 'l1', principal_derived: null }] }] } })).statusCode, 200);
});

test('ledger GET state: applications are capped, record tables are paged to completion, a short page is a 503', async () => {
  let res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  const byTable = Object.fromEntries(calls.map(c => [c.table, c]));
  assert.equal(byTable.applications.url.searchParams.get('limit'), '500', 'public submissions cannot grow the boot snapshot without bound');
  assert.equal(byTable.clients.url.searchParams.get('limit'), '1000');
  assert.equal(byTable.clients.url.searchParams.get('offset'), '0');
  assert.equal(byTable.clients.headers.Prefer, 'count=exact');

  // 1500 loans behind Supabase's 1000-row cap: two pages, concatenated in order
  const loans = Array.from({ length: 1500 }, (_, i) => ({ id: 'l' + i, ref: 'ECL-' + i, client_id: 'c1', status: 'issued' }));
  stubFetch(r => {
    if (r.table !== 'loans') return { status: 200, body: tableRows[r.table] || [] };
    const off = Number(r.url.searchParams.get('offset') || 0), page = loans.slice(off, off + 1000);
    return { status: 200, body: page, headers: { 'content-range': `${off}-${off + page.length - 1}/1500` } };
  });
  res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().loans.length, 1500);
  assert.deepEqual(calls.filter(c => c.table === 'loans').map(c => c.url.searchParams.get('offset')), ['0', '1000']);
  assert.equal(calls.filter(c => c.table === 'loans')[1].headers.Prefer, undefined, 'count only on the first page');

  // the server says 1500 exist but stops handing rows out: never return a truncated book
  stubFetch(r => r.table === 'loans'
    ? { status: 200, body: Number(r.url.searchParams.get('offset') || 0) ? [] : loans.slice(0, 1000), headers: { 'content-range': '0-999/1500' } }
    : { status: 200, body: tableRows[r.table] || [] });
  res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: 'partial state' });
});

test('ledger POST sync: bad envelope / method', async () => {
  assert.equal((await call({ method: 'POST', path: ['sync'], body: { nope: 1 } })).statusCode, 400);
  assert.equal((await call({ method: 'POST', path: ['sync'], body: 'not json' })).statusCode, 400);
  assert.equal((await call({ method: 'GET', path: ['sync'] })).statusCode, 405);
  assert.equal((await call({ method: 'GET', path: ['nope'] })).statusCode, 404);
});

// ---- ledger_book PostgREST emulation ---------------------------------------------------------------
test('ledger rest/v1/ledger_book: the console\'s exact GET shapes forward to the real table', async () => {
  stubFetch(() => ({ status: 200, body: [{ id: 'main', payload: { v: 1 }, updated_at: '2026-10-28T10:00:00Z', updated_by: 'Craig' }] }));
  let res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?select=id&limit=1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ id: 'main' }]);
  assert.equal(calls[0].url.pathname, '/rest/v1/ledger_book');
  assert.equal(calls[0].url.searchParams.get('select'), 'id');
  assert.equal(calls[0].url.searchParams.get('limit'), '1');

  res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?id=eq.main&select=payload,updated_at,updated_by' });
  assert.deepEqual(res.json(), [{ payload: { v: 1 }, updated_at: '2026-10-28T10:00:00Z', updated_by: 'Craig' }]);
  assert.equal(calls[1].url.searchParams.get('id'), 'eq.main');

  res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?id=eq.main&select=updated_at' });
  assert.deepEqual(res.json(), [{ updated_at: '2026-10-28T10:00:00Z' }]);

  // Vercel's catch-all can put its own routing key on req.url; it is not a filter
  res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger?path=rest%2Fv1%2Fledger_book&select=id&limit=1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), [{ id: 'main' }]);
  res = await call({ path: 'rest/v1/ledger_book', url: '/api/ledger?path=rest%2Fv1%2Fledger_book&id=eq.main&select=updated_at' });
  assert.deepEqual(res.json(), [{ updated_at: '2026-10-28T10:00:00Z' }]);

  res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?payload=like.*x*' });
  assert.equal(res.statusCode, 400);
  res = await call({ path: ['rest', 'v1', 'clients'], url: '/api/ledger/rest/v1/clients?select=*' });
  assert.equal(res.statusCode, 404, 'only the book is exposed through the emulation');
});

test('ledger rest/v1/ledger_book: a pulled payload never carries the record tables (write-only backup)', async () => {
  const stale = { schema: 'ledger-book/2', clients: [{ id: 'c_old' }], loans: [{ id: 'l_old', status: 'issued' }], employees: [{ id: 'e1' }], applications: [{ id: 'a1' }],
    logbook: [{ ref: 'ECL-1' }], petty: [], bank: { balance: 1 }, bankTx: [], expenses: [], loanSeq: 95, clientSeq: 40, txnSeq: 1041 };
  stubFetch(() => ({ status: 200, body: [{ id: 'main', payload: stale, updated_at: '2026-10-28T10:00:00Z', updated_by: 'Craig' }] }));
  const res = await call({ path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?id=eq.main&select=payload,updated_at,updated_by' });
  assert.equal(res.statusCode, 200);
  const p = res.json()[0].payload;
  for (const k of ['clients', 'loans', 'employees', 'applications']) assert.equal(k in p, false, k + ' stripped so the console cannot restore a stale book over the live tables');
  assert.deepEqual(p.logbook, stale.logbook); assert.equal(p.loanSeq, 95); assert.equal(p.schema, 'ledger-book/2');
  assert.equal(res.json()[0].updated_by, 'Craig');
});

test('ledger rest/v1/ledger_book: POST ?on_conflict=id upserts and honours Prefer return=minimal', async () => {
  stubFetch(r => ({ status: 201, body: r.headers.Prefer.includes('return=minimal') ? undefined : r.body }));
  const body = [{ id: 'main', payload: { clients: [] }, updated_at: '2026-10-29T00:00:00.000Z', updated_by: 'Craig', hacker: 1 }];
  const res = await call({ method: 'POST', path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?on_conflict=id', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.json(), []);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.searchParams.get('on_conflict'), 'id');
  assert.equal(calls[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.deepEqual(calls[0].body, [{ id: 'main', payload: { clients: [] }, updated_at: '2026-10-29T00:00:00.000Z', updated_by: 'Craig' }], 'the push keeps the full book');
  const viaVercel = await call({ method: 'POST', path: 'rest/v1/ledger_book', url: '/api/ledger?path=rest%2Fv1%2Fledger_book&on_conflict=id', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body });
  assert.equal(viaVercel.statusCode, 201);

  const bad = await call({ method: 'POST', path: ['rest', 'v1', 'ledger_book'], url: '/api/ledger/rest/v1/ledger_book?on_conflict=id', body: [{ id: 'main', payload: 'string' }] });
  assert.equal(bad.statusCode, 400);
  const noAuth = await call({ method: 'POST', path: ['rest', 'v1', 'ledger_book'], auth: false, body });
  assert.equal(noAuth.statusCode, 401);
});

test('ledger GET state: once the newest bank_tx window is full, every movement since the bank opening balance is included', async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ id: 'bt' + i, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), type: 'in', amount: 1 }));
  const older = [{ id: 'old1', at: '2026-02-01T00:00:00Z', type: 'out', amount: 7 }, { id: 'bt1', at: many[1].at, type: 'in', amount: 1 }];
  stubFetch(r => {
    if (r.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_at: '2026-01-01T00:00:00Z' }] };
    if (r.table === 'bank_tx') return { status: 200, body: r.url.searchParams.has('at') ? older : many, headers: { 'content-range': '0-1/2' } };
    return { status: 200, body: tableRows[r.table] || [] };
  });
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  const s = res.json();
  const bankCalls = calls.filter(c => c.table === 'bank_tx');
  assert.equal(bankCalls.length, 2);
  assert.equal(bankCalls[0].url.searchParams.get('limit'), '500');
  assert.equal(bankCalls[1].url.searchParams.get('at'), 'gte.2026-01-01T00:00:00.000Z');
  assert.equal(s.bank_tx.length, 501, 'union by id: the 500 newest plus the one older movement since opening');
  assert.ok(s.bank_tx.some(t => t.id === 'old1'));
});

test('ledger unlock is gone and a borrower host cannot call staff routes', async () => {
  const probe = 'unit-test-unlock';
  const same = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin' };
  const gone = await call({ method: 'POST', path: ['unlock'], auth: false, headers: same, body: { pin: probe } });
  assert.equal(gone.statusCode, 404);
  assert.equal(gone.headers['set-cookie'], undefined);
  assert.equal(String(gone.body).includes(probe), false);
  const borrowerHost = await call({ path: ['state'], headers: { host: 'quik1.app' } });
  assert.equal(borrowerHost.statusCode, 404);
  const staffHost = await call({ path: ['state'], headers: { host: 'quik1ledger.com' } });
  assert.equal(staffHost.statusCode, 200);
});

test('ledger GET state: no second bank_tx query while the newest window is not full or no opening balance is set', async () => {
  stubFetch(r => {
    if (r.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_at: '2026-01-01T00:00:00Z' }] };
    if (r.table === 'bank_tx') return { status: 200, body: [{ id: 'bt1', at: '2026-10-01T00:00:00Z', type: 'in', amount: 1 }] };
    return { status: 200, body: tableRows[r.table] || [] };
  });
  const res = await call({ path: ['state'] });
  assert.equal(res.statusCode, 200);
  assert.equal(calls.filter(c => c.table === 'bank_tx').length, 1);
});
});
