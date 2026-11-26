// node --test tests/api/q1-assistant.test.js
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mintStaffSession } from '../../api/_lib/auth.js';
import { publicLimiter } from '../../api/_lib/ratelimit.js';
import { answerQuestion, mergeBook, parseLedgerData, answerBorrower, todayYmd } from '../../api/_lib/q1-brain.js';

const ENV = {
  SUPABASE_URL: 'https://db.test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
const KEY = ENV.LEDGER_KEY;
Object.assign(process.env, ENV);
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.Q1_WEBHOOK_URL;

const staff = (await import('../../api/q1-assistant.js')).default;
const borrower = (await import('../../api/quik1.js')).default;

const DATA = [
  'TODAY: THU 5 NOV 2026',
  'USER: Craig',
  'CURRENT PAGE: dashboard',
  'BANK BALANCE: R 48 250',
  'DUE TODAY: ECL-112 R 3 000; ECL-114 R 1 500',
  'FLAGGED (past due, status not updated): ECL-110 due 1 Oct 2026',
  'MONTHLY OFFICE EXPENSES: Rent R 4 500',
  'EMPLOYEES: Craig Moatshe (admin, active)',
  'CLIENTS: 2',
  'LOANS (ref | client | principal | CSV instalment x count | status | instalment dates):',
  'ECL-112 | Thandi Mokoena (EC-015) | lent R 2 500 | return per instalment R 3 000 x1 | status duetoday | dates 5 Nov 2026',
  'ECL-110 | Lerato Khumalo (EC-009) | lent R 1 000 | return per instalment R 1 200 x1 | status issued | dates 1 Oct 2026'
].join('\n');

const APP = { id: 'ap_0123456789ab', ref: 'AP-1085', name: 'Thandi Mokoena', amount: 2500, status: 'new', source: 'quik1', created_at: '2026-11-01T08:00:00Z' };

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}

let calls = [];
function stubFetch(route) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = {
      url: u,
      host: u.host,
      table: u.pathname.split('/').pop(),
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body ? JSON.parse(init.body) : undefined
    };
    calls.push(rec);
    const out = (await route(rec)) || { status: 200, body: [] };
    const text = out.body === undefined ? '' : JSON.stringify(out.body);
    return { ok: out.status < 400, status: out.status, headers: new Headers(out.headers || {}), text: async () => text, json: async () => JSON.parse(text || 'null') };
  };
}

function dbRoute(extra) {
  return async (rec) => {
    if (rec.host !== 'db.test.supabase.co') return extra ? extra(rec) : { status: 200, body: { ok: true } };
    if (rec.table === 'applications') return { status: 200, body: [APP] };
    if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 10000 }] };
    if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
    return { status: 200, body: [] };
  };
}

async function callStaff({ method = 'POST', url = '/api/q1-assistant', headers = {}, body, auth = true } = {}) {
  const req = {
    method,
    url,
    headers: { ...(auth ? { authorization: 'Bearer ' + KEY } : {}), ...headers },
    body
  };
  const res = makeRes();
  Object.assign(process.env, ENV);
  delete process.env.AI_GATEWAY_API_KEY;
  await staff(req, res);
  return res;
}

async function callBorrower({ method = 'POST', url = '/api/quik1/q1', headers = {}, body } = {}) {
  const req = { method, url, query: { path: 'q1' }, headers, body };
  const res = makeRes();
  Object.assign(process.env, ENV);
  delete process.env.AI_GATEWAY_API_KEY;
  await borrower(req, res);
  return res;
}

describe('q1 assistant', { concurrency: 1 }, () => {
  beforeEach(() => {
    delete process.env.Q1_WEBHOOK_URL;
    delete process.env.AI_GATEWAY_API_KEY;
    publicLimiter.reset();
    stubFetch(dbRoute());
  });

  test('unauthenticated chat is 401 and does not touch the database or webhook', async () => {
    process.env.Q1_WEBHOOK_URL = 'https://ceo.example/hook';
    const res = await callStaff({ auth: false, body: { message: 'What is due today?', data: DATA } });
    assert.equal(res.statusCode, 401);
    assert.equal(calls.length, 0);
    const wrong = await callStaff({ auth: false, headers: { authorization: 'Bearer nope' }, body: { message: 'hi' } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(calls.length, 0);
    const pasted = await callStaff({
      auth: false,
      body: { message: 'What is due today?', data: DATA, key: KEY, ledgerKey: KEY, apikey: KEY }
    });
    assert.equal(pasted.statusCode, 401);
    assert.equal(calls.length, 0);
    assert.equal(pasted.body.includes(KEY), false);
  });

  test('authenticated chat returns a book reply and an in-app action', async () => {
    const res = await callStaff({ body: { message: "What's due today?", data: DATA, page: 'dashboard' } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.match(j.reply, /ECL-112/);
    assert.match(j.reply, /R 3 000/);
    assert.equal(j.action.go, 'filter:duetoday');
    assert.equal(j.call, null);
    assert.equal(j.connected, true);
    assert.equal(j.reply.includes('{{'), false);
    assert.equal(res.body.includes('service-role-secret'), false);
    assert.equal(res.body.includes(KEY), false);
    assert.ok(calls.every(c => c.host === 'db.test.supabase.co' && c.method === 'GET'));
  });

  test('same-origin staff cookie reads the live book; cross-site cookie is 401', async () => {
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const cookie = 'ledger_staff=' + encodeURIComponent(token);
    const same = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie };
    const ok = await callStaff({ auth: false, headers: same, body: { message: "What's in the bank?", data: DATA, key: KEY, apikey: 'anon-key' } });
    assert.equal(ok.statusCode, 200);
    const j = ok.json();
    assert.equal(j.source, 'server');
    assert.match(j.reply, /R 10 000/);
    assert.equal(j.reply.includes('48 250'), false);
    assert.equal(j.action.go, 'bank');
    assert.equal(ok.body.includes(KEY), false);
    assert.equal(ok.body.includes('anon-key'), false);
    assert.equal(ok.body.includes('craig@ecoloan.co.za'), false);
    const foreign = await callStaff({
      auth: false,
      headers: { origin: 'https://evil.example', host: 'quik1ledger.com', 'sec-fetch-site': 'cross-site', cookie },
      body: { message: "What's in the bank?", data: DATA }
    });
    assert.equal(foreign.statusCode, 401);
  });

  test('a browser DATA block with conflicting loans does not override the server book', async () => {
    const today = todayYmd(new Date());
    stubFetch(async (rec) => {
      if (rec.host !== 'db.test.supabase.co') return { status: 200, body: { ok: true } };
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      if (rec.table === 'clients') return { status: 200, body: [{ id: 'c_live', ref: 'EC-77', name: 'Live Borrower', blocked: false, deleted_at: null }] };
      if (rec.table === 'loans') return { status: 200, body: [{ id: 'l_live', ref: 'ECL-777', client_id: 'c_live', principal: 900, instalment_amount: 1100, status: 'issued', schedule: [today], instalments_paid: 0, deleted_at: null }] };
      if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 25000 }] };
      if (rec.table === 'applications') return { status: 200, body: [] };
      return { status: 200, body: [] };
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const due = await callStaff({ auth: false, headers, body: { message: "What's due today?", data: DATA, page: 'loans', key: KEY } });
    assert.equal(due.statusCode, 200);
    const j = due.json();
    assert.equal(j.source, 'server');
    assert.match(j.reply, /ECL-777/);
    assert.match(j.reply, /R 1 100/);
    assert.equal(j.reply.includes('ECL-112'), false);
    assert.equal(j.reply.includes('ECL-110'), false);
    assert.equal(j.reply.includes('48 250'), false);
    assert.equal(due.body.includes('c_live'), false);
    assert.equal(due.body.includes('l_live'), false);
    assert.equal(due.body.includes('craig@ecoloan.co.za'), false);
    assert.equal(due.body.includes(KEY), false);
    const where = await callStaff({ auth: false, headers, body: { message: 'Where am I?', data: DATA, page: 'loans' } });
    assert.equal(where.statusCode, 200);
    assert.equal(where.json().source, 'server');
    assert.match(where.json().reply, /loans/);
  });

  test('cookie session flags browser-fallback when the server book cannot load', async () => {
    stubFetch(async (rec) => {
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      throw new Error('db down');
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const res = await callStaff({ auth: false, headers, body: { message: "What's due today?", data: DATA } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.equal(j.source, 'browser-fallback');
    assert.match(j.reply, /ECL-112/);
    assert.match(j.reply, /R 3 000/);
    assert.equal(res.body.includes('craig@ecoloan.co.za'), false);
  });

  test('a failed loans read does not count as an empty server book', async () => {
    stubFetch(async (rec) => {
      if (rec.host !== 'db.test.supabase.co') return { status: 200, body: { ok: true } };
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 25000 }] };
      if (rec.table === 'loans') return { status: 500, body: { code: '57014', message: 'hidden row' } };
      return { status: 200, body: [] };
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const res = await callStaff({ auth: false, headers, body: { message: "What's due today?", data: DATA } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.equal(j.source, 'browser-fallback');
    assert.match(j.reply, /ECL-112/);
    assert.equal(j.reply.includes('Nothing is due today'), false);
    assert.equal(res.body.includes('hidden row'), false);
    assert.equal(res.body.includes('craig@ecoloan.co.za'), false);
  });

  test('the live bank balance includes movements after the opening confirmation', async () => {
    stubFetch(async (rec) => {
      if (rec.host !== 'db.test.supabase.co') return { status: 200, body: { ok: true } };
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 10000, bank_opening_at: '2026-10-01T06:00:00.000Z' }] };
      if (rec.table === 'bank_tx') {
        return { status: 200, body: [
          { id: 'bt_before', at: '2026-09-01T08:00:00.000Z', type: 'out', amount: 5000 },
          { id: 'bt_after', at: '2026-10-12T08:00:00.000Z', type: 'out', amount: 1000 }
        ] };
      }
      return { status: 200, body: [] };
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const res = await callStaff({ auth: false, headers, body: { message: "What's in the bank?", data: DATA } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.equal(j.source, 'server');
    assert.match(j.reply, /R 9 000/);
    assert.equal(j.reply.includes('10 000'), false);
    assert.equal(j.reply.includes('48 250'), false);
    assert.equal(res.body.includes('bt_before'), false);
    assert.equal(res.body.includes('bt_after'), false);
  });

  test('a failed bank movement read does not quote the opening balance as current', async () => {
    stubFetch(async (rec) => {
      if (rec.host !== 'db.test.supabase.co') return { status: 200, body: { ok: true } };
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 10000, bank_opening_at: '2026-10-01T06:00:00.000Z' }] };
      if (rec.table === 'bank_tx') return { status: 500, body: { code: '57014' } };
      return { status: 200, body: [] };
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const res = await callStaff({ auth: false, headers, body: { message: "What's in the bank?", data: DATA } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().source, 'browser-fallback');
    assert.match(res.json().reply, /R 48 250/);
  });

  test('the live loan book follows a second page instead of stopping early', async () => {
    const today = todayYmd(new Date());
    const row = (ref) => ({ id: 'l_' + ref, ref, client_id: 'c_page', principal: 100, instalment_amount: 150, status: 'issued', schedule: [today], instalments_paid: 0, deleted_at: null });
    stubFetch(async (rec) => {
      if (rec.host !== 'db.test.supabase.co') return { status: 200, body: { ok: true } };
      if (rec.table === 'employees') return { status: 200, body: [{ id: 'e1', name: 'Craig', email: 'craig@ecoloan.co.za', role: 'admin', active: true }] };
      if (rec.table === 'clients') return { status: 200, body: [{ id: 'c_page', ref: 'EC-70', name: 'Page Borrower', blocked: false, deleted_at: null }] };
      if (rec.table === 'loans') {
        const offset = rec.url.searchParams.get('offset');
        if (offset === '1000') return { status: 200, body: [row('ECL-702')], headers: { 'content-range': '1000-1000/2' } };
        return { status: 200, body: [row('ECL-701')], headers: { 'content-range': '0-0/2' } };
      }
      if (rec.table === 'settings') return { status: 200, body: [{ id: 'org', bank_opening_balance: 1000 }] };
      return { status: 200, body: [] };
    });
    const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig' });
    const headers = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', cookie: 'ledger_staff=' + encodeURIComponent(token) };
    const res = await callStaff({ auth: false, headers, body: { message: "What's due today?", data: DATA } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.equal(j.source, 'server');
    assert.match(j.reply, /ECL-701/);
    assert.match(j.reply, /ECL-702/);
    assert.equal(j.reply.includes('ECL-112'), false);
    const loanCalls = calls.filter(c => c.table === 'loans');
    assert.equal(loanCalls.length, 2);
    assert.ok(loanCalls.every(c => c.url.searchParams.get('limit') === '1000'));
    assert.equal(res.body.includes('l_ECL-701'), false);
    assert.equal(res.body.includes('c_page'), false);
  });

  test('assistant replies with no AI gateway key and never calls an AI host', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    const res = await callStaff({ body: { message: 'Who has not been updated?', data: DATA } });
    assert.equal(res.statusCode, 200);
    assert.match(res.json().reply, /ECL-110/);
    assert.equal(res.json().action.go, 'notifications');
    assert.equal(res.json().action.label, 'Update statuses');
    assert.ok(!calls.some(c => /anthropic|openai|claude|gateway|ai-gateway/i.test(c.host + c.url.pathname)));
    const src = fs.readFileSync(new URL('../../api/q1-assistant.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /AI_GATEWAY_API_KEY|api\.anthropic|api\.openai/);
  });

  test('a dead database still answers from the console DATA', async () => {
    stubFetch(async () => { throw new Error('db down'); });
    const res = await callStaff({ body: { message: 'Summarise the book', data: DATA } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.match(j.reply, /2 loan/);
    assert.match(j.reply, /R 48 250/);
    assert.equal(j.action.go, 'dashboard');
  });

  test('approve proposes a Quik1 PATCH and does not write it', async () => {
    const res = await callStaff({
      body: {
        message: 'Approve Thandi Mokoena',
        data: DATA,
        apps: [{ name: 'Quik1 loan app', actions: true, path: '/applications?status=new', key: 'should-not-echo', url: 'https://secret.example' }]
      }
    });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.match(j.reply, /confirm/);
    assert.equal(j.call.app, 'Quik1 loan app');
    assert.equal(j.call.method, 'PATCH');
    assert.equal(j.call.path, '/applications/ap_0123456789ab');
    assert.deepEqual(j.call.body, { status: 'approved' });
    assert.equal(res.body.includes('should-not-echo'), false);
    assert.equal(res.body.includes('secret.example'), false);
    assert.ok(!calls.some(c => c.method !== 'GET'));
    assert.ok(!calls.some(c => c.table === 'q1_requests'));
  });

  test('actions off does not propose a call', async () => {
    const res = await callStaff({
      body: { message: 'Decline Thandi Mokoena', data: DATA, apps: [{ name: 'Quik1 loan app', actions: false }] }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().call, null);
    assert.match(res.json().reply, /Actions are off/);
    assert.equal(res.json().action.go, 'applications');
  });

  test('webhook is a scrubbed summary and a failed webhook still returns the reply', async () => {
    process.env.Q1_WEBHOOK_URL = 'https://ceo.example/hook';
    stubFetch(dbRoute(rec => {
      assert.equal(rec.headers.Authorization, undefined);
      assert.equal(rec.headers.authorization, undefined);
      return { status: 500, body: { error: 'nope' } };
    }));
    const res = await callStaff({
      body: { message: 'Client 8001015009087 password=hunter2 is overdue', data: DATA, page: 'loans' }
    });
    assert.equal(res.statusCode, 200);
    assert.match(res.json().reply, /overdue|ECL-110|flagged|past due/i);
    const hook = calls.find(c => c.host === 'ceo.example');
    assert.ok(hook, 'webhook was posted');
    assert.equal(hook.method, 'POST');
    assert.deepEqual(Object.keys(hook.body).sort(), ['at', 'message', 'page', 'source']);
    assert.equal(hook.body.source, 'ledger-q1');
    assert.equal(hook.body.page, 'loans');
    assert.match(hook.body.message, /\[id\]/);
    assert.match(hook.body.message, /\[secret\]/);
    assert.equal(hook.body.message.includes('8001015009087'), false);
    assert.equal(hook.body.message.includes('hunter2'), false);
    assert.equal(JSON.stringify(hook.body).includes(KEY), false);
    assert.equal(JSON.stringify(hook.body).includes('service-role-secret'), false);
    assert.equal(hook.body.data, undefined);
  });

  test('missing message is 400, GET is 405, empty book still replies', async () => {
    assert.equal((await callStaff({ body: {} })).statusCode, 400);
    assert.equal((await callStaff({ method: 'GET', body: { message: 'hi' } })).statusCode, 405);
    const res = await callStaff({ body: { message: 'Hello' } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.json().reply.length > 10);
    assert.equal(res.json().reply.includes('{{'), false);
  });

  test('webhook ignores metadata and non-http URLs', async () => {
    process.env.Q1_WEBHOOK_URL = 'http://169.254.169.254/latest/meta-data';
    const meta = await callStaff({ body: { message: "What's due today?", data: DATA } });
    assert.equal(meta.statusCode, 200);
    assert.ok(!calls.some(c => /169\.254\.169\.254|metadata/.test(c.host)));
    calls = [];
    process.env.Q1_WEBHOOK_URL = 'file:///tmp/q1-hook';
    const file = await callStaff({ body: { message: "What's due today?", data: DATA } });
    assert.equal(file.statusCode, 200);
    assert.ok(!calls.some(c => c.url.protocol === 'file:'));
  });

  test('open loans is a navigation action, not a write', async () => {
    const res = await callStaff({ body: { message: 'Open loans', data: DATA } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().action.go, 'loans');
    assert.equal(res.json().call, null);
  });
});

describe('q1 brain', { concurrency: 1 }, () => {
  test('parses the console DATA block and quotes its figures', () => {
    const snap = mergeBook(parseLedgerData(DATA), null);
    assert.equal(snap.bank, 'R 48 250');
    assert.equal(snap.loans.length, 2);
    assert.equal(snap.loans[0].client, 'Thandi Mokoena');
    assert.equal(snap.clientCount, 2);
    const due = answerQuestion("What's due today?", snap);
    assert.match(due.reply, /ECL-112/);
    assert.equal(due.action.go, 'filter:duetoday');
    const who = answerQuestion('Look up Lerato Khumalo', snap);
    assert.match(who.reply, /ECL-110/);
    assert.match(who.reply, /R 1 000/);
  });

  test('preferLive quotes the server book and keeps only the screen from the DATA block', () => {
    const now = new Date('2026-11-26T10:00:00Z');
    const live = {
      bank: 25000,
      loans: [{ ref: 'ECL-777', client: 'Live Borrower', clientRef: 'EC-77', status: 'issued', principal: 900, instalment: 1100, schedule: ['2026-11-26'], paid: 0 }],
      clients: [{ id: 'c_live', ref: 'EC-77', name: 'Live Borrower' }],
      expenses: [{ name: 'Rent', amount: 100 }],
      employees: [],
      applications: []
    };
    const stale = mergeBook(parseLedgerData(DATA), live, now);
    assert.equal(stale.bank, 'R 48 250');
    assert.equal(stale.loans[0].ref, 'ECL-112');
    const snap = mergeBook(parseLedgerData(DATA), live, now, { preferLive: true });
    assert.equal(snap.page, 'dashboard');
    assert.equal(snap.bank, 'R 25 000');
    assert.equal(snap.loans.length, 1);
    assert.equal(snap.loans[0].ref, 'ECL-777');
    assert.equal(snap.clients[0].id, undefined);
    const due = answerQuestion("What's due today?", snap, [], now);
    assert.match(due.reply, /ECL-777/);
    assert.match(due.reply, /R 1 100/);
    assert.equal(due.reply.includes('ECL-112'), false);
  });

  test('borrower answers from the brief and only navigates on an open request', () => {
    const brief = [
      'Customer: Thandi',
      'Payout account: Capitec',
      'Outstanding balance (principal + charge): R 1 350',
      'Next debit date: 28 Nov 2026',
      'Credit limit: R 8 000',
      'Flat charge: 35% of the amount drawn'
    ].join('\n');
    const owe = answerBorrower('What do I owe?', brief);
    assert.match(owe.reply, /R 1 350/);
    assert.equal(owe.go, null);
    const open = answerBorrower('Open statements', brief);
    assert.equal(open.go, 'statements');
    const early = answerBorrower('Can I settle early?', brief);
    assert.match(early.reply, /nothing extra/);
    assert.equal(early.go, null);
    assert.equal(owe.reply.includes('{{'), false);
  });
});

describe('quik1 borrower q1', { concurrency: 1 }, () => {
  beforeEach(() => {
    delete process.env.Q1_WEBHOOK_URL;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.QUIK1_Q1_URL;
    publicLimiter.reset();
    stubFetch(dbRoute());
  });

  test('public ask returns a reply without a gateway key or QUIK1_Q1_URL', async () => {
    const brief = 'Outstanding balance (principal + charge): R 1 350\nNext debit date: 28 Nov 2026\nPayout account: Capitec\nFlat charge: 35% of the amount drawn';
    const res = await callBorrower({ body: { message: 'When is my debit?', brief } });
    assert.equal(res.statusCode, 200);
    const j = res.json();
    assert.match(j.reply, /28 Nov 2026/);
    assert.match(j.reply, /Capitec/);
    assert.equal(j.connected, true);
    assert.equal(j.reply.includes('not connected'), false);
    assert.ok(!calls.some(c => /anthropic|openai|gateway/i.test(c.host)));
    assert.ok(!calls.some(c => c.table === 'q1_requests'));
  });

  test('a safe application id adds that row status and does not require staff auth', async () => {
    const res = await callBorrower({ body: { message: 'What is my application status?', applicationId: 'ap_0123456789ab', brief: 'Customer: Thandi' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.json().reply, /Needs decision/);
    assert.match(res.json().reply, /R 2 500/);
    const looked = calls.filter(c => c.table === 'applications');
    assert.ok(looked.length >= 1);
    assert.equal(looked[0].url.searchParams.get('id'), 'eq.ap_0123456789ab');
    assert.equal(String(looked[0].url.searchParams.get('select')).includes('id_number'), false);
  });

  test('borrower chat does not accept a staff-only method mixup', async () => {
    assert.equal((await callBorrower({ method: 'GET', body: { message: 'hi' } })).statusCode, 405);
    assert.equal((await callBorrower({ body: {} })).statusCode, 400);
  });
});

describe('q1 icon source', { concurrency: 1 }, () => {
  const ledger = fs.readFileSync(new URL('../../ledger/index.html', import.meta.url), 'utf8');
  const quik = fs.readFileSync(new URL('../../quik1/index.html', import.meta.url), 'utf8');

  test('ledger chat reaches /api/q1-assistant before any Claude call', () => {
    const fn = ledger.slice(ledger.indexOf('async botFromLedger'), ledger.indexOf('botRun(act)'));
    assert.match(fn, /fetch\('\/api\/q1-assistant'/);
    assert.match(fn, /credentials:'include'/);
    assert.equal(fn.includes('ledjaa.supabase'), false);
    assert.equal(fn.includes('Authorization'), false);
    assert.equal(fn.includes("I can't reach Claude"), false);
    assert.ok(fn.indexOf("fetch('/api/q1-assistant'") < fn.indexOf('window.claude'));
    assert.match(ledger, /CONNECTED · LEDGER/);
    assert.equal(ledger.includes('NOT CONNECTED — ADD KEY IN SETTINGS'), false);
    const status = ledger.slice(ledger.indexOf('botStatus:'), ledger.indexOf('botDotStyle:'));
    assert.equal(status.includes('window.claude'), false);
  });

  test('quik1 Ask Q1 posts to /api/quik1/q1 before Claude and keeps a local reply', () => {
    const fn = quik.slice(quik.indexOf('askQ1(text)'), quik.indexOf('async downloadStatement'));
    assert.match(fn, /fetch\('\/api\/quik1\/q1'/);
    assert.ok(fn.indexOf("fetch('/api/quik1/q1'") < fn.indexOf('window.claude'));
    assert.match(fn, /localAnswer\(q\)/);
    assert.equal(quik.includes('Online · powered by Claude'), false);
    assert.match(quik, /aiStatus:.*'Online'/);
  });
});
