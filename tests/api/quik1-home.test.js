import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, SESSION_COOKIE } from '../../api/_lib/quik1-session.js';

const ENV = { SUPABASE_URL: 'https://db.test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN' };
Object.assign(process.env, ENV);

const handler = (await import('../../api/quik1.js')).default;
const { publicLimiter } = await import('../../api/_lib/ratelimit.js');

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
let ipSeq = 0;
async function call({ method = 'GET', path = [], url, headers = {}, body }) {
  const req = { method, query: { path }, url: url || '/api/quik1/' + path.join('/'), headers: { 'x-forwarded-for': '10.9.0.' + (++ipSeq % 200), ...headers }, body };
  const res = makeRes();
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
    return { ok: out.status < 400, status: out.status, headers: new Headers(out.headers || {}), text: async () => text, json: async () => JSON.parse(text || 'null') };
  };
}

describe('quik1 ledger home', () => {
  beforeEach(() => {
    publicLimiter.reset();
    Object.assign(process.env, ENV);
    delete process.env.QUIK1_LEDGER_SYNC_KEY;
    delete process.env.QUIK1_SESSION_SECRET;
    delete process.env.QUIK1_Q1_URL;
    delete process.env.QUIK1_Q1_KEY;
    delete process.env.QUIK1_ALLOW_PRODUCTION_AUTH;
    stubFetch(() => ({ status: 200, body: [] }));
  });

  test('GET /me without a session is a non-person zero book and does not read clients', async () => {
    const res = await call({ path: ['me'] });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.identified, false);
    assert.equal(body.profile.name, '');
    assert.equal(body.account.available, 0);
    assert.equal(body.account.outstanding_principal, 0);
    assert.equal(body.account.credit_limit, 0);
    assert.equal(calls.length, 0);
    assert.equal(JSON.stringify(body).includes('id_number'), false);
  });

  test('POST /session does not check a PIN against ID numbers even if the production flag is set', async () => {
    process.env.QUIK1_ALLOW_PRODUCTION_AUTH = '1';
    const res = await call({ method: 'POST', path: ['session'], body: { pin: '0000' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, identified: false, reason: 'pin_verification_disabled' });
    assert.equal(calls.length, 0);
    assert.equal(res.body.includes('0000'), false);
  });

  test('GET /me with a signed session returns that client book and no identity numbers', async () => {
    process.env.QUIK1_SESSION_SECRET = 'session-secret-at-least-32-characters';
    const token = signSession('c_book_01');
    stubFetch(r => {
      if (r.table === 'clients') return { status: 200, body: [{ id: 'c_book_01', ref: 'EC-01', name: 'Book Client', bank: 'Capitec', deleted_at: null }] };
      if (r.table === 'loans') return { status: 200, body: [
        { id: 'l_open', ref: 'ECL-9', principal: 2500, status: 'issued', schedule: ['2026-12-01'], instalment_amount: 2500, deleted_at: null },
        { id: 'l_paid', ref: 'ECL-8', principal: 4000, status: 'paid', deleted_at: null }
      ], headers: { 'content-range': '0-1/2' } };
      return { status: 200, body: [] };
    });
    const res = await call({ path: ['me'], headers: { cookie: SESSION_COOKIE + '=' + token } });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.identified, true);
    assert.equal(body.profile.name, 'Book Client');
    assert.equal(body.account.credit_limit, 4000);
    assert.equal(body.account.outstanding_principal, 2500);
    assert.equal(body.account.available, 1500);
    assert.equal(body.profile.id_number, undefined);
    assert.equal(body.profile.phone, undefined);
    assert.equal(res.body.includes('id_number'), false);
    assert.ok(calls.every(c => !String(c.url).includes('id_number')));
  });

  test('GET /ledger/account is forbidden until the sync key exists', async () => {
    const res = await call({ path: ['ledger', 'account'], url: '/api/quik1/ledger/account?ledger_client_id=c_book_01' });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.json(), { error: 'forbidden' });
    assert.equal(calls.length, 0);
  });

  test('POST /q1 reports the missing team endpoint and does not call a made-up URL', async () => {
    const res = await call({ method: 'POST', path: ['q1'], body: { message: 'What is my balance?' } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, 'q1_not_configured');
    assert.equal(res.json().missing, 'QUIK1_Q1_URL');
    assert.equal(calls.length, 0);
  });

  test('POST /q1 forwards only the question when a team URL is configured', async () => {
    process.env.QUIK1_Q1_URL = 'https://q1.example.test/ask';
    stubFetch(() => ({ status: 200, body: { reply: 'Your book balance is with the team.' } }));
    const res = await call({ method: 'POST', path: ['q1'], body: { message: 'What do I owe?', pin: '0000' } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().reply, 'Your book balance is with the team.');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.origin + calls[0].url.pathname, 'https://q1.example.test/ask');
    assert.equal(calls[0].body.message, 'What do I owe?');
    assert.equal(calls[0].body.pin, undefined);
    assert.equal(calls[0].body.account, null);
  });

  test('GET /available uses the largest principal, not a fixed cap', async () => {
    stubFetch(r => {
      if (r.table === 'applications') return { status: 200, body: [{ id: 'ap_0123456789ab', client_id: 'c_book_01', source: 'quik1', status: 'approved', amount: 1000 }] };
      if (r.table === 'loans') return { status: 200, body: [
        { principal: 6600, status: 'paid' },
        { principal: 1350, status: 'issued', schedule: ['2026-08-24'] }
      ], headers: { 'content-range': '0-1/2' } };
      return { status: 200, body: [] };
    });
    const res = await call({ path: ['available', 'ap_0123456789ab'] });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json();
    assert.equal(body.credit_limit, 6600);
    assert.equal(body.outstanding_principal, 1350);
    assert.equal(body.available, 5250);
    assert.notEqual(body.credit_limit, 8000);
  });
});
