// node --test tests/api/   — /api/quik1/* public customer routes with a stubbed fetch.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ENV = { SUPABASE_URL: 'https://db.test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN' };
Object.assign(process.env, ENV);

const handler = (await import('../../api/quik1/[...path].js')).default;
const { publicLimiter } = await import('../../api/_lib/ratelimit.js');

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
let ipSeq = 0;
async function call({ method = 'GET', path = [], url, headers = {}, body, ip }) {
  const req = { method, query: { path }, url: url || '/api/quik1/' + path.join('/'), headers: { 'x-forwarded-for': ip || ('10.0.0.' + (++ipSeq % 250)), ...headers }, body };
  const res = makeRes();
  if (!process.env.__keepEnv) { Object.assign(process.env, ENV); delete process.env.LEDGER_KEY; } // public routes must not need LEDGER_KEY
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
// count() asks PostgREST for an exact count via the Content-Range header.
const countThen = (n, rest) => r => (r.method === 'GET' && r.headers.Prefer === 'count=exact')
  ? { status: 200, body: [], headers: { 'content-range': `0-0/${n}` } }
  : rest(r);
describe('quik1', () => {

beforeEach(() => { publicLimiter.reset(); stubFetch(countThen(12, r => ({ status: 201, body: r.body || [] }))); });

const appRecord = { // exactly what quik1/index.html passes to Quik1Link.submitApplication (+ the link's own id/submittedAt)
  id: 'ap_0123456789ab', submittedAt: 1761724800000, status: 'Needs decision', source: 'app',
  name: 'Thandi Mokoena', phone: '0824410912', amount: 2500, term: '3 mo', purpose: 'School fees', income: 18500, surplus: 4000
};

test('quik1 POST applications: validates, whitelists, inserts source=quik1 with meta.surplus, returns Needs decision', async () => {
  const res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, hacker: 'x', net_income: 999999, status: 'approved', decision: { verdict: 'approved' } } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(res.json(), { id: 'ap_0123456789ab', ref: 'AP-1097', status: 'Needs decision' });
  const ins = calls.find(c => c.method === 'POST');
  assert.equal(ins.url.pathname, '/rest/v1/applications');
  assert.equal(ins.url.searchParams.get('on_conflict'), 'id');
  assert.match(ins.headers.Prefer, /ignore-duplicates/);
  assert.equal(ins.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const row = ins.body[0];
  assert.equal(row.id, 'ap_0123456789ab', 'well-formed client id honoured');
  assert.equal(row.ref, 'AP-1097');
  assert.equal(row.name, 'Thandi Mokoena'); assert.equal(row.phone, '0824410912');
  assert.equal(row.amount, 2500); assert.equal(row.term_months, 3); assert.equal(row.purpose, 'School fees');
  assert.equal(row.net_income, 18500, 'income maps to net_income; the client cannot set net_income directly');
  assert.equal(row.source, 'quik1'); assert.equal(row.status, 'new', 'client cannot pre-approve itself');
  assert.equal(row.decision, undefined); assert.equal(row.hacker, undefined);
  assert.equal(row.meta.surplus, 4000); assert.equal(row.meta.submittedAt, 1761724800000); assert.equal(row.meta.client, 'quik1');
  assert.deepEqual(row.meta.raw, { source: 'app', status: 'approved' }, 'extras are kept verbatim under meta.raw, never promoted to columns');
  assert.deepEqual(row.meta.docs, []);
  assert.ok(!res.body.includes('service-role-secret'));
});

test('quik1 POST applications: ids that are not well-formed are replaced by a server id', async () => {
  for (const id of ['AP-1085', "ap_'; drop table", 'ap_0123456789ABCD', 'su_0123456789ab', '', undefined]) {
    publicLimiter.reset();
    const res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, id } });
    assert.equal(res.statusCode, 201);
    assert.match(res.json().id, /^ap_[0-9a-f]{12}$/);
    assert.notEqual(res.json().id, id);
  }
});

test('quik1 POST applications: amount bounds, phone/name required, term parsing', async () => {
  for (const amount of [0, -5, 50001, 'abc', null]) {
    const res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, amount } });
    assert.equal(res.statusCode, 400, 'amount ' + amount);
    assert.match(res.json().error, /amount/);
  }
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { ...appRecord, amount: 50000 } })).statusCode, 201);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { ...appRecord, amount: '2 500' } })).statusCode, 201);
  let res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, phone: '' } });
  assert.equal(res.statusCode, 400); assert.match(res.json().error, /phone/);
  res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, phone: '12' } });
  assert.equal(res.statusCode, 400);
  res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, name: '   ' } });
  assert.equal(res.statusCode, 400); assert.match(res.json().error, /name/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 2, 'invalid payloads never reach the database');

  stubFetch(countThen(0, r => ({ status: 201, body: r.body })));
  res = await call({ method: 'POST', path: ['applications'], body: { ...appRecord, term: 'whatever', purpose: '', income: 'R 20 000', email: 'not-an-email', surplus: '1 200' } });
  const row = calls.find(c => c.method === 'POST').body[0];
  assert.equal(res.json().ref, 'AP-1085', 'first application gets the base ref');
  assert.equal(row.term_months, 1); assert.equal(row.purpose, 'Personal'); assert.equal(row.net_income, 20000); assert.equal(row.email, null); assert.equal(row.meta.surplus, 1200);
});

test('quik1 POST applications: body must be JSON, 16 KB cap, non-object rejected', async () => {
  assert.equal((await call({ method: 'POST', path: ['applications'], body: 'garbage' })).statusCode, 400);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { ...appRecord, purpose: 'x'.repeat(17_000) } })).statusCode, 413);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: '[1,2]' })).statusCode, 400);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('quik1 GET applications/:id: status mapping and decision shape', async () => {
  const base = { id: 'ap_0123456789ab', amount: 2500, decision: null, decided_at: null, decline_reason: null, updated_at: '2026-10-29T09:00:00Z' };
  const cases = [
    [{ ...base, status: 'new' }, { status: 'Needs decision', decision: null }],
    [{ ...base, status: 'reviewing' }, { status: 'Needs decision', decision: null }],
    [{ ...base, status: 'approved', decided_at: '2026-10-29T10:00:00Z', decision: { verdict: 'approved', amount: 2000, by: 'Ecoloans', note: '', at: '2026-10-29T10:00:00Z' } },
      { status: 'Approved', decision: { verdict: 'approved', amount: 2000, by: 'Ecoloans', note: '', at: Date.parse('2026-10-29T10:00:00Z') } }],
    [{ ...base, status: 'declined', decided_at: '2026-10-29T10:00:00Z', decline_reason: 'Affordability' },
      { status: 'Declined', decision: { verdict: 'declined', amount: 2500, by: 'Ecoloans', note: 'Affordability', at: Date.parse('2026-10-29T10:00:00Z') } }]
  ];
  for (const [row, expect] of cases) {
    stubFetch(() => ({ status: 200, body: [row] }));
    const res = await call({ path: ['applications', row.id] });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { id: row.id, ...expect });
    assert.equal(calls[0].url.searchParams.get('id'), 'eq.' + row.id);
    assert.equal(calls[0].url.searchParams.get('source'), 'eq.quik1', 'only app-originated rows are readable');
    assert.ok(!res.body.includes('0824410912') && !res.body.includes('Thandi'), 'no PII beyond status/decision');
  }
  stubFetch(() => ({ status: 200, body: [] }));
  assert.equal((await call({ path: ['applications', 'ap_ffffffffffff'] })).statusCode, 404);
  assert.equal((await call({ path: ['applications', 'bad id!'] })).statusCode, 400);
});

test('quik1 POST signups: auto-approved immediately, GET returns the decision', async () => {
  const before = Date.now();
  const su = { id: 'su_0123456789ab', name: 'Thandi Mokoena', idnum: '9001015009087', phone: '+27 82 441 0912', email: 'thandi@example.com', employment: 'Full-time', employer: 'Sibanye', income: 18500, payday: '25th', status: 'Pending review' };
  const res = await call({ method: 'POST', path: ['signups'], body: su });
  assert.equal(res.statusCode, 201, res.body);
  const out = res.json();
  assert.equal(out.id, 'su_0123456789ab'); assert.equal(out.status, 'Approved'); assert.equal(out.by, 'auto'); assert.equal(out.note, 'Auto-approved by Quik1 bridge');
  assert.ok(out.decidedAt >= before);
  const row = calls.find(c => c.method === 'POST').body[0];
  assert.equal(calls.find(c => c.method === 'POST').url.pathname, '/rest/v1/q1_signups');
  assert.equal(row.status, 'Approved'); assert.equal(row.decided_by, 'auto'); assert.equal(row.id_number, '9001015009087');
  assert.equal(row.phone, '+27 82 441 0912'); assert.equal(row.reviewer, 'applications@ecoloans.co.za'); assert.equal(row.income, 18500);
  assert.equal((await call({ method: 'POST', path: ['signups'], body: { ...su, name: '' } })).statusCode, 400);
  const gen = await call({ method: 'POST', path: ['signups'], body: { ...su, id: 'SU-2041' } });
  assert.match(gen.json().id, /^su_[0-9a-f]{12}$/);

  stubFetch(() => ({ status: 200, body: [{ id: 'su_0123456789ab', status: 'Approved', decided_at: '2026-10-29T10:00:00Z', decided_by: 'auto', note: 'Auto-approved by Quik1 bridge' }] }));
  const got = await call({ path: ['signups', 'su_0123456789ab'] });
  assert.deepEqual(got.json(), { id: 'su_0123456789ab', status: 'Approved', decidedAt: Date.parse('2026-10-29T10:00:00Z'), by: 'auto', note: 'Auto-approved by Quik1 bridge' });
  stubFetch(() => ({ status: 200, body: [] }));
  assert.equal((await call({ path: ['signups', 'su_ffffffffffff'] })).statusCode, 404);
});

test('quik1 POST requests and GET repayments/:key', async () => {
  const res = await call({ method: 'POST', path: ['requests'], body: { type: 'New account', detail: 'Savings pocket', name: 'Thandi', to: 'applications@ecoloans.co.za' } });
  assert.equal(res.statusCode, 201);
  assert.match(res.json().id, /^rq_[0-9a-f]{12}$/); assert.equal(res.json().status, 'New');
  const row = calls.find(c => c.method === 'POST').body[0];
  assert.equal(calls.find(c => c.method === 'POST').url.pathname, '/rest/v1/q1_requests');
  assert.equal(row.type, 'New account'); assert.equal(row.detail, 'Savings pocket'); assert.equal(row.to, 'applications@ecoloans.co.za'); assert.equal(row.status, 'New');
  assert.equal((await call({ method: 'POST', path: ['requests'], body: { detail: 'no type' } })).statusCode, 400);

  stubFetch(() => ({ status: 200, body: [{ key: 'app', ok: true, by: 'Craig', at: '2026-10-29T10:00:00Z' }] }));
  let rep = await call({ path: ['repayments', 'app'] });
  assert.deepEqual(rep.json(), { ok: true, by: 'Craig', at: Date.parse('2026-10-29T10:00:00Z') });
  assert.equal(calls[0].url.searchParams.get('key'), 'eq.app');
  stubFetch(() => ({ status: 200, body: [] }));
  rep = await call({ path: ['repayments', 'app'] });
  assert.equal(rep.statusCode, 200); assert.equal(rep.json(), null);
});

test('quik1: routing — 404 unknown, 405 wrong method, never DELETE, no auth header needed', async () => {
  assert.equal((await call({ path: ['loans'] })).statusCode, 404);
  assert.equal((await call({ method: 'DELETE', path: ['applications', 'ap_0123456789ab'] })).statusCode, 405);
  assert.equal((await call({ method: 'GET', path: ['applications'] })).statusCode, 405);
  assert.equal((await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: { status: 'approved' } })).statusCode, 405, 'customers cannot decide');
  assert.equal((await call({ method: 'GET', path: ['requests', 'rq_0123456789ab'] })).statusCode, 405);
  assert.ok(!calls.some(c => c.method === 'DELETE' || c.method === 'PATCH'));
});

test('quik1: rate limiter returns 429 after the per-minute limit from one ip, other ips unaffected', async () => {
  stubFetch(() => ({ status: 200, body: [] }));
  const limit = publicLimiter.limit;
  assert.ok(limit >= 30 && limit <= 1000, 'sane default (120/min unless QUIK1_RATE_LIMIT overrides it)');
  let last;
  for (let i = 0; i < limit; i++) { last = await call({ path: ['repayments', 'app'], ip: '203.0.113.9' }); assert.equal(last.statusCode, 200); }
  assert.equal(last.headers['x-ratelimit-remaining'], '0');
  const blocked = await call({ path: ['repayments', 'app'], ip: '203.0.113.9' });
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.json(), { error: 'Too many requests' });
  assert.ok(Number(blocked.headers['retry-after']) >= 1);
  assert.equal((await call({ path: ['repayments', 'app'], ip: '203.0.113.10' })).statusCode, 200);
  assert.equal(calls.length, limit + 1, 'the blocked request never touched the database');
});

test('quik1: missing env → 503 plain message; db failure → 502 without internals', async () => {
  const saved = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL; process.env.__keepEnv = '1';
  try { const res = await call({ path: ['repayments', 'app'] }); assert.equal(res.statusCode, 503); assert.deepEqual(res.json(), { error: 'Server not configured' }); }
  finally { delete process.env.__keepEnv; process.env.SUPABASE_URL = saved; }
  stubFetch(() => ({ status: 500, body: { code: 'XX000', message: 'stack trace here' } }));
  const res = await call({ path: ['repayments', 'app'] });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'Database error XX000' });
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  const down = await call({ path: ['repayments', 'app'] });
  assert.equal(down.statusCode, 502); assert.deepEqual(down.json(), { error: 'Database unreachable' });
});
});
