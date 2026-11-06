// Staff password recovery. GoTrue is mocked. Nothing here is a real staff password
// or a live recovery token, and no email is sent.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ENV = {
  SUPABASE_URL: 'https://rcektqecduuzqqmcsgat.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
Object.assign(process.env, ENV);

const handler = (await import('../api/ledger.js')).default;
const { mintStaffSession } = await import('../api/_lib/auth.js');

const STAFF = 'staff.one@example.test';
const OUTSIDER = 'outsider@example.test';
const TOKEN_HASH = 'abcDEF123_token-hash-value-0001';
const ACCESS = 'recovery-access-token-not-for-the-browser';
const NEW_PASSWORD = 'correct-horse-battery';

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
async function call({ method = 'POST', path = ['recover'], headers = {}, body }) {
  const req = { method, query: { path }, url: '/api/ledger/' + path.join('/'), headers, body };
  const res = makeRes();
  await handler(req, res);
  return res;
}
const same = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin' };

let employees = [];
let calls = [];
function installFetch() {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = { path: u.pathname + u.search, method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    calls.push(rec);
    const text = (status, body) => ({ ok: status < 400, status, headers: new Headers(), text: async () => JSON.stringify(body) });
    if (u.pathname.endsWith('/employees')) {
      const want = String(u.searchParams.get('email') || '').replace(/^ilike\./i, '').toLowerCase();
      const rows = employees.filter(e => String(e.email).toLowerCase() === want && e.active === true);
      return text(200, rows);
    }
    if (u.pathname === '/auth/v1/recover') return text(200, {});
    if (u.pathname === '/auth/v1/verify') {
      const body = JSON.parse(init.body);
      if (body.type !== 'recovery' || body.token_hash !== TOKEN_HASH) return text(403, { error: 'invalid' });
      return text(200, {
        access_token: ACCESS,
        refresh_token: 'refresh-should-not-leak',
        user: { id: 'user-1', email: STAFF }
      });
    }
    if (u.pathname === '/auth/v1/user' && (init.method || 'GET') === 'PUT') return text(200, { id: 'user-1' });
    if (u.pathname === '/auth/v1/logout') return text(204, {});
    return text(500, { error: 'unexpected' });
  };
}

test('the reset pages do not name a staff address or collect a card', () => {
  const login = fs.readFileSync(new URL('../login/index.html', import.meta.url), 'utf8');
  const forgot = fs.readFileSync(new URL('../login/forgot/index.html', import.meta.url), 'utf8');
  const reset = fs.readFileSync(new URL('../login/reset/index.html', import.meta.url), 'utf8');
  assert.match(login, /href="\/login\/forgot\/"/);
  assert.match(login, /Forgot password\?/);
  assert.match(login, /placeholder="name@example.com"/);
  assert.match(forgot, /placeholder="name@example.com"/);
  assert.match(forgot, /does not create an account/);
  assert.match(reset, /token works once|works once/i);
  assert.doesNotMatch(login + forgot + reset, /craig@|ecoloan\.co\.za|card|stripe/i);
});

describe('recovery against a mocked GoTrue', { concurrency: false }, () => {
test('recovery mail is generic and only active staff reach GoTrue', async () => {
  employees = [{ id: 'e1', email: STAFF, name: 'Staff One', role: 'admin', active: true }];
  installFetch();
  const headers = same;
  const outsider = await call({ headers, body: { email: OUTSIDER, redirect_to: 'https://evil.example/phish' } });
  const insider = await call({ headers: { ...headers, host: 'preview.vercel.app' }, body: { email: '  ' + STAFF.toUpperCase() + '  ', redirect_to: 'https://evil.example/phish' } });
  assert.equal(outsider.statusCode, 200);
  assert.equal(insider.statusCode, 200);
  assert.equal(outsider.body, insider.body);
  assert.deepEqual(outsider.json(), { ok: true });
  assert.equal(outsider.body.includes(OUTSIDER), false);
  assert.equal(insider.body.includes(STAFF), false);
  const recover = calls.filter(c => c.path.startsWith('/auth/v1/recover'));
  assert.equal(recover.length, 1);
  const target = new URL('https://db.test' + recover[0].path);
  assert.equal(target.searchParams.get('redirect_to'), 'https://quik1ledger.com/login/reset/');
  assert.equal(JSON.parse(recover[0].body).email, STAFF);
  assert.equal(recover[0].body.includes('evil.example'), false);
});

test('a new password requires a recovery token, then drops the staff cookie', async () => {
  employees = [{ id: 'e1', email: STAFF, name: 'Staff One', role: 'admin', active: true }];
  installFetch();
  const session = mintStaffSession(Date.now(), { email: STAFF, displayName: 'Staff One' });
  const cookie = { cookie: 'ledger_staff=' + encodeURIComponent(session.token), ...same };

  const sessionOnly = await call({
    path: ['recover', 'complete'],
    headers: cookie,
    body: { access_token: ACCESS, password: NEW_PASSWORD }
  });
  assert.equal(sessionOnly.statusCode, 400);
  assert.equal(calls.some(c => c.path === '/auth/v1/verify' || c.path === '/auth/v1/user'), false);
  assert.equal(sessionOnly.body.includes(NEW_PASSWORD), false);
  assert.equal(sessionOnly.body.includes(ACCESS), false);

  calls = [];
  const done = await call({
    path: ['recover', 'complete'],
    headers: cookie,
    body: { token_hash: TOKEN_HASH, password: NEW_PASSWORD, access_token: 'ordinary-session-token' }
  });
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { ok: true });
  assert.match(String(done.headers['set-cookie']), /ledger_staff=;/);
  assert.match(String(done.headers['set-cookie']), /Max-Age=0/);
  assert.equal(done.body.includes(NEW_PASSWORD), false);
  assert.equal(done.body.includes(ACCESS), false);
  assert.equal(done.body.includes(ENV.SUPABASE_SERVICE_ROLE_KEY), false);

  const verify = calls.find(c => c.path === '/auth/v1/verify');
  assert.deepEqual(JSON.parse(verify.body), { type: 'recovery', token_hash: TOKEN_HASH });
  const update = calls.find(c => c.path === '/auth/v1/user');
  assert.equal(update.method, 'PUT');
  assert.equal(update.headers.Authorization, 'Bearer ' + ACCESS);
  assert.notEqual(update.headers.Authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(JSON.parse(update.body).password, NEW_PASSWORD);
  const logout = calls.find(c => c.path.startsWith('/auth/v1/logout'));
  assert.match(logout.path, /scope=global/);
  assert.equal(logout.headers.Authorization, 'Bearer ' + ACCESS);

  employees[0].active = false;
  calls = [];
  const inactive = await call({
    path: ['recover', 'complete'],
    headers: same,
    body: { token_hash: TOKEN_HASH, password: NEW_PASSWORD }
  });
  assert.equal(inactive.statusCode, 400);
  assert.equal(calls.some(c => c.path === '/auth/v1/user'), false);
  assert.equal(inactive.body.includes(STAFF), false);
});
});
