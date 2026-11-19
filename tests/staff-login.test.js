// Staff Admin sign-in: Supabase password grant, then public.employees (active) allowlist.
// Fixture passwords below are test doubles for the mocked GoTrue. They are not staff passwords.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRAIG = 'craig@ecoloan.co.za';
const SECOND = 'second.staff@test.invalid';
const INTRUDER = 'intruder@test.invalid';
// TEST-ONLY. The mock treats these as GoTrue's answer. They are not production secrets.
const FIXTURE_PASSWORD = 'test-only-staff';

const ENV = {
  SUPABASE_URL: 'https://db.test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
Object.assign(process.env, ENV);

const handler = (await import('../api/ledger.js')).default;

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
async function call({ method = 'GET', path = [], headers = {}, body, auth = false }) {
  const req = {
    method,
    query: { path },
    url: '/api/ledger/' + path.join('/'),
    headers: { ...(auth ? { authorization: 'Bearer ' + ENV.LEDGER_KEY } : {}), ...headers },
    body
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}
function sameOrigin(extra = {}) {
  return { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin', ...extra };
}
function http(status, body) {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, headers: new Headers(), text: async () => text };
}

let employees = [];
let authCalls = [];
function installFetch() {
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(init.body);
      authCalls.push({ url: u.toString(), body, apikey: init.headers.apikey, authorization: init.headers.Authorization });
      const email = String(body.email || '').toLowerCase();
      if (body.password !== FIXTURE_PASSWORD || (email !== CRAIG && email !== SECOND && email !== INTRUDER)) {
        return http(400, { error: 'invalid_credentials', error_description: 'Invalid login credentials' });
      }
      const name = email === CRAIG ? 'Craig Haynes' : (email === SECOND ? 'Second Staff' : 'Intruder');
      return http(200, {
        access_token: 'supabase-access-token',
        refresh_token: 'supabase-refresh-token',
        token_type: 'bearer',
        user: { id: 'user-' + email, email, user_metadata: { full_name: name } }
      });
    }
    if (u.pathname.endsWith('/employees')) {
      let rows = employees.slice();
      const emailF = u.searchParams.get('email') || '';
      if (emailF) {
        const want = emailF.replace(/^ilike\./i, '').toLowerCase();
        rows = rows.filter(e => String(e.email).toLowerCase() === want);
      }
      if (u.searchParams.get('active') === 'eq.true') rows = rows.filter(e => e.active === true);
      return http(200, rows);
    }
    return http(200, []);
  };
}

function cookieFrom(res) {
  const setCookie = String(res.headers['set-cookie'] || '');
  const m = /ledger_staff=([^;]+)/.exec(setCookie);
  assert.ok(m, 'staff cookie was set');
  return { setCookie, token: decodeURIComponent(m[1]), header: 'ledger_staff=' + m[1] };
}

test('protected ledger routes reject a visitor with no session', async () => {
  installFetch();
  const paths = [
    { method: 'GET', path: ['state'] },
    { method: 'POST', path: ['sync'], body: { ops: [] } },
    { method: 'GET', path: ['quik1-invites'] },
    { method: 'POST', path: ['quik1-invites'], body: { clientId: 'c_test' } },
    { method: 'POST', path: ['nupay-clients'], body: { csv: 'ref,name\n', commit: false } },
    { method: 'GET', path: ['features'] }
  ];
  for (const item of paths) {
    const res = await call({ method: item.method, path: item.path, headers: sameOrigin(), body: item.body });
    assert.equal(res.statusCode, 401, item.path.join('/'));
    assert.equal(JSON.stringify(res.json()).includes('client'), false);
  }
});

test('sidebar says Admin and the shared passcode is gone', () => {
  const html = fs.readFileSync(path.join(ROOT, 'ledger/index.html'), 'utf8');
  const sync = fs.readFileSync(path.join(ROOT, 'ledger/ledger-sync.js'), 'utf8');
  const gate = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261105_auth_signup_allowlist.sql'), 'utf8');
  assert.match(html, /\['ledger','ADMIN'/);
  assert.doesNotMatch(html, /246810/);
  assert.doesNotMatch(html, /PROTOTYPE CODE/);
  assert.match(html, /Sign in with your staff email and password/);
  assert.match(sync, /\/login/);
  assert.match(gate, /public\.employees/);
  assert.match(gate, /e\.active/);
  assert.match(gate, /Sign-up is closed/);
  assert.equal(fs.existsSync(path.join(ROOT, 'tools/staff-hash.js')), false);
  const tree = ['api', 'ledger', 'tools', 'docs'];
  for (const dir of tree) {
    const files = walk(path.join(ROOT, dir));
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(text.includes(FIXTURE_PASSWORD), false, file);
      assert.equal(text.includes('supabase-access-token'), false, file);
    }
  }
});

test('Supabase staff login: Craig, a second active employee, failures, logout, machine key', async () => {
  employees = [{ id: 'e1', name: 'Craig Moatshe', email: 'Craig@Ecoloan.co.za', role: 'admin', active: true }];
  authCalls = [];
  installFetch();
  const same = sameOrigin();

  const cross = await call({ method: 'POST', path: ['login'], headers: { origin: 'https://evil.example', host: 'quik1ledger.com', 'sec-fetch-site': 'cross-site' }, body: { email: CRAIG, password: FIXTURE_PASSWORD } });
  assert.equal(cross.statusCode, 403);
  assert.equal(authCalls.length, 0, 'a cross-site call never reaches GoTrue');

  const wrong = await call({ method: 'POST', path: ['login'], headers: same, body: { email: CRAIG, password: 'nope' } });
  const unknown = await call({ method: 'POST', path: ['login'], headers: same, body: { email: 'nobody@test.invalid', password: FIXTURE_PASSWORD } });
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.body, unknown.body);
  assert.deepEqual(wrong.json(), { error: 'Unauthorized' });
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.equal(wrong.body.includes(CRAIG), false);
  assert.equal(wrong.body.includes('invalid_credentials'), false);

  const intruder = await call({ method: 'POST', path: ['login'], headers: same, body: { email: INTRUDER, password: FIXTURE_PASSWORD } });
  assert.equal(intruder.statusCode, 401);
  assert.equal(intruder.body, wrong.body, 'a GoTrue user who is not an active employee gets the same error');
  assert.equal(intruder.headers['set-cookie'], undefined);

  employees[0].active = false;
  const inactive = await call({ method: 'POST', path: ['login'], headers: same, body: { email: CRAIG, password: FIXTURE_PASSWORD } });
  assert.equal(inactive.statusCode, 401);
  assert.equal(inactive.body, wrong.body);
  employees[0].active = true;

  const craig = await call({ method: 'POST', path: ['login'], headers: same, body: { email: '  CRAIG@ECOLOAN.CO.ZA  ', password: FIXTURE_PASSWORD } });
  assert.equal(craig.statusCode, 200);
  assert.equal(craig.json().staff.email, CRAIG);
  assert.equal(craig.json().staff.displayName, 'Craig Haynes');
  assert.equal(JSON.stringify(craig.json()).includes('supabase-access-token'), false);
  assert.equal(JSON.stringify(craig.json()).includes('supabase-refresh-token'), false);
  assert.equal(JSON.stringify(craig.json()).includes(FIXTURE_PASSWORD), false);
  const issued = cookieFrom(craig);
  assert.equal(issued.setCookie.includes('HttpOnly'), true);
  assert.equal(issued.setCookie.includes('Secure'), true);
  assert.equal(issued.setCookie.includes('SameSite=Strict'), true);
  assert.equal(issued.token.includes(FIXTURE_PASSWORD), false);
  const claims = JSON.parse(Buffer.from(issued.token.split('.')[3], 'base64url').toString('utf8'));
  assert.equal(claims.email, CRAIG);
  assert.equal(claims.name, 'Craig Haynes');
  const grant = authCalls.find(c => c.body.email === CRAIG && c.body.password === FIXTURE_PASSWORD);
  assert.ok(grant);
  assert.match(grant.url, /\/auth\/v1\/token\?grant_type=password$/);
  assert.equal(grant.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(grant.authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);

  const anon = await call({ path: ['state'], headers: same });
  assert.equal(anon.statusCode, 401);
  const authed = await call({ path: ['state'], headers: sameOrigin({ cookie: issued.header }) });
  assert.equal(authed.statusCode, 200);
  assert.ok(Array.isArray(authed.json().clients));
  const session = await call({ path: ['session'], headers: sameOrigin({ cookie: issued.header }) });
  assert.deepEqual(session.json().staff, { email: CRAIG, displayName: 'Craig Haynes' });

  const machine = await call({ path: ['state'], auth: true, headers: same });
  assert.equal(machine.statusCode, 200);
  const machineSession = await call({ path: ['session'], auth: true, headers: same });
  assert.equal(machineSession.json().staff, null);

  employees.push({ id: 'e2', name: 'Second Staff', email: SECOND, role: 'agent', active: true });
  const second = await call({ method: 'POST', path: ['login'], headers: same, body: { email: SECOND, password: FIXTURE_PASSWORD } });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().staff.displayName, 'Second Staff');
  assert.equal(second.json().staff.email, SECOND);

  employees[0].active = false;
  const dropped = await call({ path: ['state'], headers: sameOrigin({ cookie: issued.header }) });
  assert.equal(dropped.statusCode, 401, 'deactivating the employee row closes the cookie');

  employees[0].active = true;
  const locked = await call({ method: 'POST', path: ['lock'], headers: sameOrigin({ cookie: issued.header }) });
  assert.equal(locked.statusCode, 200);
  assert.match(String(locked.headers['set-cookie']), /ledger_staff=;/);
  assert.match(String(locked.headers['set-cookie']), /Max-Age=0/);
  const after = await call({ path: ['state'], headers: same });
  assert.equal(after.statusCode, 401);
});

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'original') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
