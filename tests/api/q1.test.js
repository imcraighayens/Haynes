// node --test tests/api/   — /api/q1/* (LEDGER's Quik1 integration: list + decide) with a stubbed fetch.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ENV = { SUPABASE_URL: 'https://db.test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN', LEDGER_KEY: 'ledger-test-key-0123456789abcdef' };
const KEY = ENV.LEDGER_KEY;
Object.assign(process.env, ENV);

const handler = (await import('../../api/q1.js')).default;

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
async function call({ method = 'GET', path = [], url, headers = {}, body, auth = true }) {
  const req = { method, query: { path }, url: url || '/api/q1/' + path.join('/'), headers: { ...(auth ? { authorization: 'Bearer ' + KEY } : {}), ...headers }, body };
  const res = makeRes();
  Object.assign(process.env, ENV);
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
const app = { id: 'ap_0123456789ab', ref: 'AP-1085', name: 'Thandi Mokoena', phone: '0824410912', email: null, id_number: null, employer: null, job_title: null,
  net_income: 18500, bank: null, amount: 2500, term_months: 3, purpose: 'School fees', source: 'quik1', status: 'new', decided_by: null, decided_at: null,
  created_at: '2026-10-29T08:00:00Z', meta: { surplus: 4000, docs: ['payslip.pdf'], client: 'quik1' }, decision: null };
describe('q1', () => {

beforeEach(() => stubFetch(() => ({ status: 200, body: [app] })));

test('q1: auth required (401), service key never echoed', async () => {
  assert.equal((await call({ path: ['applications'], auth: false })).statusCode, 401);
  assert.equal((await call({ path: ['applications'], auth: false, headers: { authorization: 'Bearer nope' } })).statusCode, 401);
  assert.equal(calls.length, 0);
  const res = await call({ path: ['applications'] });
  assert.equal(res.statusCode, 200);
  assert.ok(!res.body.includes('service-role-secret'));
});

test('q1 GET applications: defaults to status=new, filters source=quik1, augments term/income/submitted/docs', async () => {
  const res = await call({ path: ['applications'], url: '/api/q1/applications?status=new' });
  assert.equal(res.statusCode, 200);
  const rows = res.json();
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, 'ap_0123456789ab');
  assert.equal(r.term, 3);
  assert.equal(r.income, 18500);
  assert.equal(r.submitted, '2026-10-29T08:00:00Z');
  assert.deepEqual(r.docs, ['payslip.pdf']);
  assert.equal(r.name, 'Thandi Mokoena'); assert.equal(r.phone, '0824410912'); assert.equal(r.amount, 2500); // raw columns kept for qkMap
  const q = calls[0].url.searchParams;
  assert.equal(calls[0].url.pathname, '/rest/v1/applications');
  assert.equal(q.get('source'), 'eq.quik1');
  assert.equal(q.get('status'), 'eq.new');
  assert.equal(q.get('order'), 'created_at.desc');

  await call({ path: ['applications'] });
  assert.equal(calls[1].url.searchParams.get('status'), 'eq.new', 'default filter is new');
  await call({ path: ['applications'], url: '/api/q1/applications?status=all' });
  assert.equal(calls[2].url.searchParams.has('status'), false, 'status=all drops the filter');
  await call({ path: ['applications'], url: '/api/q1/applications?status=declined' });
  assert.equal(calls[3].url.searchParams.get('status'), 'eq.declined');
  assert.equal((await call({ path: ['applications'], url: '/api/q1/applications?status=bogus' })).statusCode, 400);
});

test('q1 GET applications: docs defaults to [] and missing numbers are safe', async () => {
  stubFetch(() => ({ status: 200, body: [{ ...app, meta: null, term_months: null, net_income: null }] }));
  const r = (await call({ path: ['applications'] })).json()[0];
  assert.deepEqual(r.docs, []); assert.equal(r.term, 1); assert.equal(r.income, 0);
});

test('q1 PATCH applications/:id approved → status, decided_at, decided_by ledger, decision blob; returns the row', async () => {
  const before = Date.now();
  stubFetch(r => r.method === 'PATCH' ? { status: 200, body: [{ ...app, ...r.body }] } : { status: 200, body: [app] });
  const res = await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: { status: 'approved' } });
  assert.equal(res.statusCode, 200);
  const row = res.json();
  assert.equal(row.id, 'ap_0123456789ab');
  assert.equal(row.status, 'approved');
  assert.equal(row.decided_by, 'ledger');
  assert.ok(Date.parse(row.decided_at) >= before - 1000);
  assert.equal(row.decision.verdict, 'approved');
  assert.equal(row.decision.amount, 2500);
  assert.equal(row.decision.by, 'Ecoloans');
  assert.equal(row.decision.note, '');
  assert.equal(row.decision.at, row.decided_at);
  assert.equal(row.term, 3, 'augmented like the list');

  const lookup = calls[0], patch = calls[1];
  assert.equal(lookup.method, 'GET'); assert.equal(lookup.url.searchParams.get('id'), 'eq.ap_0123456789ab'); assert.equal(lookup.url.searchParams.get('source'), 'eq.quik1');
  assert.equal(patch.method, 'PATCH');
  assert.equal(patch.url.pathname, '/rest/v1/applications');
  assert.equal(patch.url.searchParams.get('id'), 'eq.ap_0123456789ab');
  assert.equal(patch.url.searchParams.get('source'), 'eq.quik1');
  assert.equal(patch.headers.Prefer, 'return=representation');
  assert.deepEqual(Object.keys(patch.body).sort(), ['decided_at', 'decided_by', 'decision', 'status']);
});

test('q1 PATCH applications/:id declined / reviewing / new mapping and validation', async () => {
  stubFetch(r => r.method === 'PATCH' ? { status: 200, body: [{ ...app, ...r.body }] } : { status: 200, body: [app] });
  let row = (await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: { status: 'declined' } })).json();
  assert.equal(row.status, 'declined'); assert.equal(row.decision.verdict, 'declined'); assert.equal(row.decided_by, 'ledger');

  row = (await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: { status: 'reviewing' } })).json();
  assert.equal(row.status, 'reviewing'); assert.equal(row.decision, null); assert.equal(row.decided_at, null);

  row = (await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: '{"status":"new"}' })).json();
  assert.equal(row.status, 'new', 'string bodies are parsed');

  assert.equal((await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: { status: 'paid' } })).statusCode, 400);
  assert.equal((await call({ method: 'PATCH', path: ['applications', 'ap_0123456789ab'], body: {} })).statusCode, 400);
  assert.equal((await call({ method: 'PATCH', path: ['applications', 'bad id!'], body: { status: 'approved' } })).statusCode, 400);
  assert.equal((await call({ method: 'DELETE', path: ['applications', 'ap_0123456789ab'] })).statusCode, 405);
  assert.equal((await call({ path: ['loans'] })).statusCode, 404);
  assert.ok(!calls.some(c => c.method === 'DELETE'));
});

test('q1 PATCH applications/:id unknown or non-quik1 id → 404', async () => {
  stubFetch(() => ({ status: 200, body: [] }));
  const res = await call({ method: 'PATCH', path: ['applications', 'ap_ffffffffffff'], body: { status: 'approved' } });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: 'Application not found' });
  assert.equal(calls.length, 1, 'no PATCH is attempted for an unknown row');
});
});
