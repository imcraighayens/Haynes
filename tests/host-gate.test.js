// Host split: one allow-list in api/_lib/hosts.js, enforced by vercel.json and by wrap().
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STAFF_HOSTS, BORROWER_HOSTS, OPEN_HOSTS, STAFF_PATHS, BORROWER_PATHS, STAFF_PAGES, BORROWER_PAGES, apiRole, apiSideAllowed } from '../api/_lib/hosts.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const denied = vercel.rewrites.filter(r => r.destination === '/api/denied');

function hostValues(rule, key) {
  return (rule[key] || []).filter(h => h.type === 'host').map(h => h.value);
}

test('vercel.json repeats the allow-list and does not send every host to Ledger', () => {
  for (const host of STAFF_HOSTS) assert.equal(BORROWER_HOSTS.includes(host), false, host);
  for (const host of OPEN_HOSTS) {
    assert.equal(STAFF_HOSTS.includes(host), false);
    assert.equal(BORROWER_HOSTS.includes(host), false);
  }
  assert.equal(vercel.redirects.some(r => r.source === '/' && r.destination === '/ledger/'), false);

  // Static files are served before rewrites, so the cross-host pages must be redirects.
  // After deploy, without following the redirect:
  //   curl -sI https://quik1.app/ledger/            -> 307, location: /api/denied, not 200
  //   curl -sI https://quik1ledger.com/quik1/       -> 307, location: /api/denied, not 200
  //   curl -sI https://quik1ledger.com/ledger/      -> 200
  //   curl -sI https://quik1.app/quik1/             -> 200
  const pageDeny = vercel.redirects.filter(r => r.destination === '/api/denied');
  const staffPageDeny = pageDeny.filter(r => r.missing);
  assert.deepEqual(staffPageDeny.map(r => r.source).sort(), [...STAFF_PAGES].sort());
  for (const rule of staffPageDeny) {
    assert.equal(rule.permanent, false);
    assert.deepEqual(hostValues(rule, 'missing').sort(), [...STAFF_HOSTS, ...OPEN_HOSTS].sort());
  }
  const borrowerPageDeny = pageDeny.filter(r => r.has);
  const pagesByHost = new Map();
  for (const rule of borrowerPageDeny) {
    const host = hostValues(rule, 'has')[0];
    pagesByHost.set(host, [...(pagesByHost.get(host) || []), rule.source]);
  }
  assert.deepEqual([...pagesByHost.keys()].sort(), [...STAFF_HOSTS].sort());
  for (const sources of pagesByHost.values()) assert.deepEqual(sources.sort(), [...BORROWER_PAGES].sort());

  const borrowerRoot = vercel.rewrites.filter(r => r.source === '/' && r.destination === '/quik1/index.html');
  assert.deepEqual(borrowerRoot.map(r => hostValues(r, 'has')[0]).sort(), [...BORROWER_HOSTS].sort());

  const staffRoot = vercel.rewrites.filter(r => r.source === '/' && r.destination === '/ledger/index.html');
  assert.deepEqual(staffRoot.map(r => hostValues(r, 'has')[0]).sort(), [...STAFF_HOSTS, ...OPEN_HOSTS].sort());

  const staffDeny = denied.filter(r => !r.has);
  assert.deepEqual(staffDeny.map(r => r.source).sort(), [...STAFF_PATHS].sort());
  for (const rule of staffDeny) {
    assert.deepEqual(hostValues(rule, 'missing').sort(), [...STAFF_HOSTS, ...OPEN_HOSTS].sort());
  }

  const borrowerDeny = denied.filter(r => r.has);
  const byHost = new Map();
  for (const rule of borrowerDeny) {
    const host = hostValues(rule, 'has')[0];
    byHost.set(host, [...(byHost.get(host) || []), rule.source]);
  }
  assert.deepEqual([...byHost.keys()].sort(), [...STAFF_HOSTS].sort());
  for (const sources of byHost.values()) assert.deepEqual(sources.sort(), [...BORROWER_PATHS].sort());
});

test('api role refuses a borrower host on staff routes and a staff host on borrower routes', () => {
  assert.equal(apiRole('', ''), 'open');
  assert.equal(apiRole('', 'localhost:3000'), 'open');
  assert.equal(apiRole('quik1.app', 'quik1.app'), 'borrower');
  assert.equal(apiRole('www.quik1.app', ''), 'borrower');
  assert.equal(apiRole('quik1ledger.com', ''), 'staff');
  assert.equal(apiRole('www.quik1ledger.com', 'ecoloans-six.vercel.app'), 'staff');
  assert.equal(apiRole('quik1.app', 'quik1ledger.com'), 'conflict');
  assert.equal(apiSideAllowed('borrower', 'ledger'), false);
  assert.equal(apiSideAllowed('borrower', 'q1'), false);
  assert.equal(apiSideAllowed('borrower', 'q1-assistant'), false);
  assert.equal(apiSideAllowed('borrower', 'quik1'), true);
  assert.equal(apiSideAllowed('staff', 'quik1'), false);
  assert.equal(apiSideAllowed('staff', 'ledger'), true);
  assert.equal(apiSideAllowed('open', 'ledger'), true);
  assert.equal(apiSideAllowed('open', 'quik1'), true);
  assert.equal(apiSideAllowed('other', 'ledger'), false);
  assert.equal(apiSideAllowed('other', 'quik1'), true);
  assert.equal(apiSideAllowed('conflict', 'ecoloans'), false);
  assert.equal(apiSideAllowed('staff', 'ecoloans'), true);
});

test('handlers honour the host guard', async () => {
  globalThis.fetch = async () => { throw new Error('no network'); };
  process.env.SUPABASE_URL = 'https://db.test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret-NEVER-RETURN';
  process.env.LEDGER_KEY = 'ledger-test-key-0123456789abcdef';
  const quik1 = (await import('../api/quik1.js')).default;
  const ledger = (await import('../api/ledger.js')).default;
  const ecoloans = (await import('../api/ecoloans.js')).default;
  function res() {
    const out = { statusCode: 0, headers: {}, body: '', headersSent: false, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
    return out;
  }
  async function hit(handler, host, url) {
    const r = res();
    await handler({ method: 'POST', url, headers: { host, authorization: 'Bearer ' + process.env.LEDGER_KEY }, body: { name: 'A', phone: '0820000000', amount: 100 } }, r);
    return r.statusCode;
  }
  assert.equal(await hit(ledger, 'quik1.app', '/api/ledger/state'), 404);
  assert.equal(await hit(ledger, 'www.quik1.app', '/api/ledger/login'), 404);
  assert.equal(await hit(quik1, 'quik1ledger.com', '/api/quik1/signups'), 404);
  assert.equal(await hit(quik1, 'www.quik1ledger.com', '/api/quik1/applications'), 404);
  assert.equal(await hit(quik1, 'ecoloans-six.vercel.app', '/api/quik1/signups'), 404);
  const marketing = await hit(ecoloans, 'quik1ledger.com', '/api/ecoloans/applications');
  assert.notEqual(marketing, 404);
});
