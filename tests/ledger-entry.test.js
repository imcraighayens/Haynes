// Ledger landing and staff login. The console document is withheld unless the
// existing staff cookie is valid. Fixture values below are test doubles.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ENV = {
  SUPABASE_URL: 'https://rcektqecduuzqqmcsgat.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
Object.assign(process.env, ENV);

const { mintStaffSession } = await import('../api/_lib/auth.js');
const gate = await import('../api/_lib/gate.js');
const middleware = await import('../middleware.js');

const home = read('index.html');
const login = read('login/index.html');
const css = read('entry.css');
const client = read('entry.js');
const ledger = read('ledger/index.html');
const vercel = JSON.parse(read('vercel.json'));

function http(status, body) {
  const text = JSON.stringify(body);
  return { ok: status < 400, status, headers: new Headers(), text: async () => text };
}

test('public entrance is Ledger, with no signup, oauth, or key field', () => {
  for (const html of [home, login]) {
    assert.match(html, /EcoLoans/);
    assert.match(html, /Ledger/);
    assert.match(html, /The book, in <em>one place\.<\/em>/);
    assert.match(html, /href="\/entry\.css"/);
    assert.match(html, /src="\/entry\.js"/);
    assert.doesNotMatch(html, /Aerivo|aviation|Google|Remember me|Forgot|Sign up|Create account|Privacy Policy|Terms of Service/i);
    assert.doesNotMatch(html, /service_role|LEDGER_KEY|supabase\.co|246810|PROTOTYPE/i);
    assert.doesNotMatch(html, /\b\d{10,}\b/);
  }
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /#050505/);
  assert.match(css, /#1d4ed8/);
  assert.match(home, /href="\/login\/"/);
  assert.match(home, /id="enter"/);
  assert.match(login, /href="\/"/);
  assert.match(login, /Back to home/);
  assert.match(login, /id="staff-login"/);
  assert.match(login, /autocomplete="email"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.match(login, /id="toggle-password"/);
  assert.match(login, /role="alert"/);
  assert.doesNotMatch(login, /type="hidden"/);
  assert.match(client, /\/api\/ledger\/login/);
  assert.match(client, /\/api\/ledger\/session/);
  assert.match(client, /credentials:\s*'include'/);
  assert.match(client, /next === '\/ledger\/'/);
  assert.doesNotMatch(client, /location\.replace\(next\)/);
  assert.doesNotMatch(client, /innerHTML|localStorage|sessionStorage|setTimeout|supabase|service_role|LEDGER_KEY/i);
  assert.match(client, /textContent/);
  assert.match(client, /Sign-in failed\. Check your email and password\./);
  assert.match(client, /Sign-in is unavailable right now\./);
  assert.match(ledger, /window\.location\.replace\('\/'\)/);
  assert.match(ledger, /Cancelling returns to the Ledger home/);
  assert.doesNotMatch(ledger, /staffCancel:\(\)=>this\.setState\(\{route:'dashboard'/);
  assert.equal(vercel.redirects.some(r => r.source === '/' && r.destination === '/ledger/'), false);
  assert.ok(vercel.redirects.some(r => r.source === '/login' && r.destination === '/login/'));
  assert.deepEqual(middleware.config.matcher, ['/ledger', '/ledger/', '/ledger/index.html']);
  assert.equal(middleware.config.runtime, 'nodejs');
});

test('shell paths are only the console document', () => {
  assert.equal(gate.isLedgerShellPath('/ledger'), true);
  assert.equal(gate.isLedgerShellPath('/ledger/'), true);
  assert.equal(gate.isLedgerShellPath('/ledger/index.html'), true);
  assert.equal(gate.isLedgerShellPath('/ledger/ledjaa-db.js'), false);
  assert.equal(gate.isLedgerShellPath('/ledger/ledger-sync.js'), false);
  assert.equal(gate.isLedgerShellPath('/'), false);
  assert.equal(gate.isLedgerShellPath('/login/'), false);
  assert.equal(gate.isLedgerShellPath('/quik1/'), false);
  assert.equal(gate.safeConsolePath('https://evil.example'), '/ledger/');
  assert.equal(gate.safeConsolePath('//evil.example'), '/ledger/');
  assert.equal(gate.safeConsolePath('/ledger'), '/ledger/');
});

describe('console document gate', { concurrency: false }, () => {
test('the console document is withheld without a valid staff cookie', async () => {
  const saved = process.env.LEDGER_KEY;
  delete process.env.LEDGER_KEY;
  const closed = await gate.staffMayViewLedger('');
  assert.equal(closed.ok, false);
  assert.equal(closed.reason, 'unconfigured');
  process.env.LEDGER_KEY = saved;

  globalThis.fetch = async () => { throw new Error('no network in this case'); };
  const anon = await middleware.default(new Request('https://quik1ledger.com/ledger/'));
  assert.equal(anon.status, 302);
  const loc = new URL(anon.headers.get('location'));
  assert.equal(loc.pathname, '/login/');
  assert.equal(loc.searchParams.get('next'), '/ledger/');
  assert.equal(loc.searchParams.get('notice'), null);
  assert.equal(anon.headers.get('x-middleware-next'), null);

  const direct = await middleware.default(new Request('https://quik1ledger.com/ledger/index.html'));
  assert.equal(direct.status, 302);
  assert.equal(new URL(direct.headers.get('location')).pathname, '/login/');

  const junk = await middleware.default(new Request('https://quik1ledger.com/ledger/', {
    headers: { cookie: 'ledger_staff=not-a-session' }
  }));
  assert.equal(junk.status, 302);

  globalThis.fetch = async () => { throw new Error('database down'); };
  const down = await middleware.default(new Request('https://preview.vercel.app/ledger/'));
  assert.equal(down.status, 302);
  assert.equal(new URL(down.headers.get('location')).searchParams.get('notice'), null);

  const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig Haynes' });
  const dropped = await middleware.default(new Request('https://quik1ledger.com/ledger/', {
    headers: { cookie: 'ledger_staff=' + encodeURIComponent(token) }
  }));
  assert.equal(dropped.status, 302);
  assert.equal(new URL(dropped.headers.get('location')).searchParams.get('notice'), 'unavailable');
});

test('an active staff cookie may receive the console document', async () => {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    assert.match(u.pathname, /\/employees$/);
    assert.equal(u.searchParams.get('active'), 'eq.true');
    return http(200, [{ id: 'e1', name: 'Craig Moatshe', email: 'craig@ecoloan.co.za', role: 'admin', active: true }]);
  };
  const { token } = mintStaffSession(Date.now(), { email: 'craig@ecoloan.co.za', displayName: 'Craig Haynes' });
  const allowed = await gate.staffMayViewLedger('ledger_staff=' + encodeURIComponent(token));
  assert.equal(allowed.ok, true);

  const res = await middleware.default(new Request('https://quik1ledger.com/ledger/', {
    headers: { cookie: 'other=1; ledger_staff=' + encodeURIComponent(token) }
  }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.equal(res.headers.get('location'), null);

  globalThis.fetch = async () => http(200, []);
  const inactive = await gate.staffMayViewLedger('ledger_staff=' + encodeURIComponent(token));
  assert.equal(inactive.ok, false);
  assert.equal(inactive.reason, 'anonymous');

  const v1 = mintStaffSession(Date.now(), null);
  globalThis.fetch = async () => { throw new Error('v1 does not ask the directory'); };
  const legacy = await gate.staffMayViewLedger('ledger_staff=' + encodeURIComponent(v1.token));
  assert.equal(legacy.ok, true);
  assert.equal(legacy.reason, 'session');
});
});
