// node --test tests/api/ecoloans.test.js — public EcoLoans marketing ingest.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ENV = { SUPABASE_URL: 'https://db.test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN' };
Object.assign(process.env, ENV);

const handler = (await import('../../api/ecoloans.js')).default;
const { ecoloansLimiter, CORS_ORIGINS } = await import('../../api/ecoloans.js');
const { publicLimiter } = await import('../../api/_lib/ratelimit.js');
const quik1 = (await import('../../api/quik1.js')).default;

const here = path.dirname(fileURLToPath(import.meta.url));

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
let ipSeq = 0;
async function call({ method = 'GET', path = [], url, headers = {}, body, ip }) {
  const req = { method, query: { path }, url: url || '/api/ecoloans/' + path.join('/'), headers: { 'x-forwarded-for': ip || ('10.1.0.' + (++ipSeq % 250)), ...headers }, body };
  const res = makeRes();
  if (!process.env.__keepEnv) { Object.assign(process.env, ENV); delete process.env.LEDGER_KEY; }
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
function stubDb({ total = 12, hourly = 0, phone = 0, existing = null } = {}) {
  stubFetch(r => {
    if (r.method === 'GET' && r.headers.Prefer === 'count=exact') {
      const n = r.url.searchParams.has('phone') ? phone : r.url.searchParams.has('created_at') ? hourly : total;
      return { status: 200, body: [], headers: { 'content-range': `0-0/${n}` } };
    }
    if (r.method === 'GET') return { status: 200, body: existing ? [existing] : [] };
    return { status: 201, body: r.body || [] };
  });
}
function inserted() { return calls.find(c => c.method === 'POST').body[0]; }

describe('ecoloans', () => {

beforeEach(() => {
  ecoloansLimiter.reset();
  publicLimiter.reset();
  delete process.env.ECOLOANS_HOURLY_CAP;
  delete process.env.ECOLOANS_PHONE_DAILY_CAP;
  delete process.env.ALLOWED_ORIGIN;
  delete process.env.QUIK1_HOURLY_CAP;
  stubDb();
});

const siteRecord = { // live ecoloan.co.za apply form (field ids) plus a couple of canonical aliases
  aName: 'Thandi Mokoena', aCell: '082 123 4567', aEmail: 'thandi@example.co.za',
  aAmt: 'R10 000', aterm: '3', awhy: 'School fees', aTake: 'R10 000 to R20 000',
  aEmp: 'Sibanye', aBank: 'Capitec', aProv: 'North West', atype: 'Personal',
  aPay: '25th', ainc: 'salaried', submittedAt: 1761724800000,
  docs: ['South African ID', { name: 'Latest 3 payslips' }, 'x'.repeat(200), 'd4', 'd5', 'd6']
};

test('POST applications: site fields land on applications as source ecoloan_web, status new, ew_/EW-', async () => {
  const res = await call({ method: 'POST', path: ['applications'], body: {
    ...siteRecord, hacker: 'x', source: 'quik1', status: 'approved', decision: { verdict: 'approved' }
  } });
  assert.equal(res.statusCode, 201, res.body);
  const out = res.json();
  assert.match(out.id, /^ew_[0-9a-f]{12}$/);
  assert.equal(out.ref, 'EW-1097');
  assert.equal(out.status, 'new');
  const ins = calls.find(c => c.method === 'POST');
  assert.equal(ins.url.pathname, '/rest/v1/applications');
  assert.equal(ins.url.searchParams.get('on_conflict'), 'id');
  assert.match(ins.headers.Prefer, /ignore-duplicates/);
  assert.equal(ins.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const row = ins.body[0];
  assert.equal(row.id, out.id);
  assert.equal(row.ref, 'EW-1097');
  assert.equal(row.name, 'Thandi Mokoena');
  assert.equal(row.phone, '082 123 4567', 'aCell maps to phone');
  assert.equal(row.email, 'thandi@example.co.za');
  assert.equal(row.amount, 10000);
  assert.equal(row.term_months, 3);
  assert.equal(row.purpose, 'School fees');
  assert.equal(row.net_income, null, 'a take-home band is not coerced into a salary');
  assert.equal(row.employer, 'Sibanye');
  assert.equal(row.bank, 'Capitec');
  assert.equal(row.source, 'ecoloan_web');
  assert.equal(row.status, 'new');
  assert.equal(row.decision, undefined);
  assert.equal(row.hacker, undefined);
  assert.equal(row.loanType, undefined);
  assert.equal(row.province, undefined);
  assert.equal(row.meta.client, 'ecoloan_web');
  assert.equal(row.meta.submittedAt, 1761724800000);
  assert.equal(row.meta.province, 'North West');
  assert.equal(row.meta.takeHome, 'R10 000 to R20 000');
  assert.equal(row.meta.raw.loanType, 'personal');
  assert.equal(row.meta.raw.payday, '25th');
  assert.equal(row.meta.raw.incomeType, 'salaried');
  assert.equal(row.meta.raw.source, undefined);
  assert.equal(row.meta.docs.length, 5);
  assert.ok(row.meta.docs.every(d => d.length <= 80));
  assert.equal(calls.some(c => c.url.searchParams.get('source') === 'eq.quik1'), false);
  assert.ok(calls.some(c => c.url.searchParams.get('source') === 'eq.ecoloan_web'));
  assert.ok(!res.body.includes('service-role-secret'));
});

test('POST applications: canonical names, numeric income, business loan type, id number', async () => {
  const res = await call({ method: 'POST', path: ['applications'], body: {
    id: 'ew_0123456789ab', name: 'Amahle Dlamini', phone: '0730001122', email: 'not-an-email',
    amount: 15000, term_months: 2, why: 'Stock', income: 'R 18 500', takeHome: 'R20 000 to R50 000',
    loanType: 'business', aWork: 'Amahle Spaza', aReg: '2023/848161/07', aInd: 'Retail',
    ayears: '1 to 3 years', employment: 'Self-employed', aPay: 'Month end', bank: 'FNB',
    province: 'Gauteng', idNumber: '9001015009087'
  } });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(res.json(), { id: 'ew_0123456789ab', ref: 'EW-1097', status: 'new' });
  const row = inserted();
  assert.equal(row.email, null);
  assert.equal(row.amount, 15000);
  assert.equal(row.term_months, 2);
  assert.equal(row.purpose, 'Stock');
  assert.equal(row.net_income, 18500, 'numeric income wins; the band stays beside it');
  assert.equal(row.meta.takeHome, 'R20 000 to R50 000');
  assert.equal(row.employer, 'Amahle Spaza');
  assert.equal(row.id_number, '9001015009087');
  assert.equal(row.meta.province, 'Gauteng');
  assert.deepEqual(row.meta.raw, {
    loanType: 'business', employment: 'Self-employed', payday: 'Month end',
    business: 'Amahle Spaza', cipc: '2023/848161/07', industry: 'Retail', trading: '1 to 3 years'
  });
});

test('POST applications: ids that are not ew_ + 12 hex are replaced; ap_ ids are never reused', async () => {
  for (const id of ['AP-1085', 'ap_0123456789ab', 'ew_0123456789ABCD', "ew_'; drop table", '', undefined]) {
    ecoloansLimiter.reset();
    stubDb();
    const res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi Mokoena', phone: '0821234567', amount: 1000, id } });
    assert.equal(res.statusCode, 201, res.body);
    assert.match(res.json().id, /^ew_[0-9a-f]{12}$/);
    assert.notEqual(res.json().id, id);
    assert.equal(calls[0].url.searchParams.get('source'), 'eq.ecoloan_web');
    assert.match(calls[0].url.searchParams.get('id'), /^eq\.ew_[0-9a-f]{12}$/);
  }
});

test('POST applications: name and phone are required; amount bounds match Quik1 when present; omitted amount is null', async () => {
  for (const amount of [0, -5, 50001, 'abc']) {
    const res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount } });
    assert.equal(res.statusCode, 400, 'amount ' + amount);
    assert.match(res.json().error, /amount/);
  }
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: 50000 } })).statusCode, 201);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: '2 500' } })).statusCode, 201);
  let res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '' } });
  assert.equal(res.statusCode, 400); assert.match(res.json().error, /phone/);
  res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '12' } });
  assert.equal(res.statusCode, 400);
  res = await call({ method: 'POST', path: ['applications'], body: { name: '   ', aCell: '0821234567' } });
  assert.equal(res.statusCode, 400); assert.match(res.json().error, /name/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 2, 'invalid payloads never reach the database');

  stubDb({ total: 0 });
  res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi Mokoena', aCell: '0821234567' } });
  assert.equal(res.statusCode, 201, res.body);
  const row = inserted();
  assert.equal(res.json().ref, 'EW-1085');
  assert.equal(row.amount, null);
  assert.equal(row.term_months, 1);
  assert.equal(row.purpose, 'Personal');
  assert.equal(row.net_income, null);
  assert.equal(row.phone, '0821234567');
  assert.equal(row.meta.takeHome, undefined);
  assert.deepEqual(row.meta.raw, {});
});

test('POST applications: a retried well-formed id answers from the stored ecoloan_web row', async () => {
  const stored = { id: 'ew_0123456789ab', ref: 'EW-2585', status: 'approved' };
  stubDb({ existing: stored });
  const res = await call({ method: 'POST', path: ['applications'], body: { id: 'ew_0123456789ab', name: 'Thandi', phone: '0821234567', amount: 1000, status: 'new' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'ew_0123456789ab', ref: 'EW-2585', status: 'approved' });
  assert.equal(calls[0].url.searchParams.get('id'), 'eq.ew_0123456789ab');
  assert.equal(calls[0].url.searchParams.get('source'), 'eq.ecoloan_web');
  assert.equal(calls[0].url.searchParams.get('select'), 'id,ref,status');
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('POST applications: hourly and per-phone caps count only source ecoloan_web and read EcoLoans env', async () => {
  stubDb({ hourly: 60 });
  let res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0824410912', amount: 1000 } });
  assert.equal(res.statusCode, 429);
  assert.match(res.json().error, /Too many applications/);
  assert.ok(Number(res.headers['retry-after']) >= 60);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  const throttle = calls.filter(c => c.headers.Prefer === 'count=exact');
  assert.equal(throttle.length, 2);
  for (const c of throttle) {
    assert.equal(c.url.searchParams.get('source'), 'eq.ecoloan_web');
    assert.match(c.url.searchParams.get('created_at'), /^gte\.\d{4}-/);
  }
  assert.equal(throttle.find(c => c.url.searchParams.has('phone')).url.searchParams.get('phone'), 'eq.0824410912');

  process.env.QUIK1_HOURLY_CAP = '1';
  stubDb({ hourly: 59, phone: 2 });
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0824410912', amount: 1000 } })).statusCode, 201, 'Quik1 cap env is a different counter');

  process.env.ECOLOANS_HOURLY_CAP = '10';
  stubDb({ hourly: 10, phone: 0 });
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0824410912', amount: 1000 } })).statusCode, 429);
  process.env.ECOLOANS_PHONE_DAILY_CAP = '1';
  stubDb({ hourly: 0, phone: 1 });
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0824410912', amount: 1000 } })).statusCode, 429);
  stubDb({ hourly: 9, phone: 0 });
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0824410912', amount: 1000 } })).statusCode, 201);
});

test('POST applications: body must be JSON and within 16 KB', async () => {
  assert.equal((await call({ method: 'POST', path: ['applications'], body: 'garbage' })).statusCode, 400);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', purpose: 'x'.repeat(17_000) } })).statusCode, 413);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: '[1,2]' })).statusCode, 400);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('routing: applications POST only; no signups; no LEDGER_KEY', async () => {
  assert.equal((await call({ path: ['signups'] })).statusCode, 404);
  assert.equal((await call({ path: ['loans'] })).statusCode, 404);
  assert.equal((await call({ method: 'GET', path: ['applications'] })).statusCode, 405);
  assert.equal((await call({ method: 'GET', path: ['applications', 'ew_0123456789ab'] })).statusCode, 405);
  assert.equal((await call({ method: 'DELETE', path: ['applications'] })).statusCode, 405);
  assert.equal((await call({ method: 'PATCH', path: ['applications'], body: { status: 'approved' } })).statusCode, 405);
  assert.ok(!calls.some(c => c.method === 'DELETE' || c.method === 'PATCH'));
  const src = readFileSync(path.join(here, '../../api/ecoloans.js'), 'utf8');
  assert.equal(/quik1\.js/.test(src), false);
  assert.match(src, /source: SOURCE/);
  assert.match(src, /ecoloan_web/);
});

test('rate limiter is its own bucket: EcoLoans 429 leaves Quik1, and a full Quik1 bucket leaves EcoLoans', async () => {
  assert.notEqual(ecoloansLimiter, publicLimiter);
  const limit = ecoloansLimiter.limit;
  assert.ok(limit >= 1 && limit <= 1000);
  const ip = '203.0.113.9';
  for (let i = 0; i < limit; i++) {
    const res = await call({ method: 'POST', path: ['applications'], body: { phone: '0821234567' }, ip });
    assert.equal(res.statusCode, 400);
  }
  const blocked = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: 1000 }, ip });
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.json(), { error: 'Too many requests' });
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: 1000 }, ip: '203.0.113.10' })).statusCode, 201);

  const qreq = { method: 'GET', query: { path: ['repayments', 'app'] }, url: '/api/quik1/repayments/app', headers: { 'x-forwarded-for': ip } };
  const qres = makeRes();
  await quik1(qreq, qres);
  assert.equal(qres.statusCode, 200, 'the shared IP is still under Quik1\'s own limiter');

  publicLimiter.reset();
  for (let i = 0; i < publicLimiter.limit; i++) publicLimiter.check(ip);
  assert.equal(publicLimiter.check(ip).ok, false);
  ecoloansLimiter.reset();
  assert.equal((await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: 1000 }, ip })).statusCode, 201);
});

test('CORS allowlist echoes the four marketing origins and ignores ALLOWED_ORIGIN', async () => {
  assert.deepEqual([...CORS_ORIGINS], [
    'https://ecoloan.co.za',
    'https://www.ecoloan.co.za',
    'https://ecoloans.co.za',
    'https://www.ecoloans.co.za'
  ]);
  process.env.ALLOWED_ORIGIN = '*';
  for (const origin of CORS_ORIGINS) {
    const res = await call({ method: 'OPTIONS', path: ['applications'], headers: { origin } });
    assert.equal(res.statusCode, 204, origin);
    assert.equal(res.headers['access-control-allow-origin'], origin);
    assert.equal(res.headers['vary'], 'Origin');
    assert.equal(res.headers['access-control-allow-methods'], 'POST, OPTIONS');
    assert.equal(res.headers['access-control-allow-headers'], 'Content-Type');
    assert.equal(res.headers['access-control-max-age'], '600');
    assert.equal(res.headers['access-control-allow-credentials'], undefined);
  }
  for (const origin of ['https://evil.example', 'http://ecoloan.co.za', 'https://ecoloan.co.za.evil.com', 'https://app.ecoloans.co.za', 'https://staff.example']) {
    const res = await call({ method: 'OPTIONS', path: ['applications'], headers: { origin } });
    assert.equal(res.statusCode, 204, origin);
    assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
    assert.equal(res.headers['vary'], 'Origin');
  }
  const noOrigin = await call({ method: 'OPTIONS', path: ['applications'] });
  assert.equal(noOrigin.statusCode, 204);
  assert.equal(noOrigin.headers['access-control-allow-origin'], undefined);

  delete process.env.ALLOWED_ORIGIN;
  const post = await call({ method: 'POST', path: ['applications'], headers: { origin: 'https://www.ecoloans.co.za' }, body: { name: 'Thandi', phone: '0821234567', amount: 1000 } });
  assert.equal(post.statusCode, 201);
  assert.equal(post.headers['access-control-allow-origin'], 'https://www.ecoloans.co.za');

  process.env.ALLOWED_ORIGIN = 'https://staff.example';
  const staffOnEco = await call({ method: 'OPTIONS', path: ['applications'], headers: { origin: 'https://staff.example' } });
  assert.equal(staffOnEco.headers['access-control-allow-origin'], undefined);
  const qreq = { method: 'OPTIONS', query: { path: ['applications'] }, url: '/api/quik1/applications', headers: { origin: 'https://staff.example' } };
  const qres = makeRes();
  await quik1(qreq, qres);
  assert.equal(qres.statusCode, 204);
  assert.equal(qres.headers['access-control-allow-origin'], 'https://staff.example');
  assert.equal(qres.headers['access-control-allow-methods'], 'GET,POST,PATCH,OPTIONS');
  const qMarketing = makeRes();
  await quik1({ method: 'OPTIONS', query: { path: ['applications'] }, url: '/api/quik1/applications', headers: { origin: 'https://ecoloan.co.za' } }, qMarketing);
  assert.equal(qMarketing.headers['access-control-allow-origin'], undefined);
});

test('missing env is 503 with the allowlist still applied; database failures stay generic', async () => {
  const saved = process.env.SUPABASE_URL; delete process.env.SUPABASE_URL; process.env.__keepEnv = '1';
  try {
    const res = await call({ method: 'POST', path: ['applications'], headers: { origin: 'https://ecoloan.co.za' }, body: { name: 'Thandi', phone: '0821234567' } });
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: 'Server not configured' });
    assert.equal(res.headers['access-control-allow-origin'], 'https://ecoloan.co.za');
  } finally { delete process.env.__keepEnv; process.env.SUPABASE_URL = saved; }
  stubFetch(() => ({ status: 500, body: { code: 'XX000', message: 'stack trace and row dump' } }));
  const res = await call({ method: 'POST', path: ['applications'], body: { name: 'Thandi', phone: '0821234567', amount: 1000 } });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'Database error XX000' });
  assert.ok(!res.body.includes('stack trace'));
});

test('vercel.json rewrites /api/ecoloans/* the same way as quik1', () => {
  const vercel = JSON.parse(readFileSync(path.join(here, '../../vercel.json'), 'utf8'));
  const eco = vercel.rewrites.find(r => r.source === '/api/ecoloans/:path*');
  assert.equal(eco.destination, '/api/ecoloans?path=:path*');
  assert.ok(vercel.rewrites.some(r => r.source === '/api/quik1/:path*' && r.destination === '/api/quik1?path=:path*'));
});

});
