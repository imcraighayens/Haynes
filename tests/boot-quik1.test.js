// node --test tests/boot-quik1.test.js
// Boots the design-frozen Quik1 customer app in headless Chromium against tools/mock-api.js and
// walks a loan application through the bridge: the phone submits → the API holds it as a new
// quik1 application for LEDGER → LEDGER's Q1 route approves it → the phone sees the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { LEDGER_KEY, BOOT_TIMEOUT_MS, loadPlaywright, launchBrowser, withMockApi, pageWaitFor, isKnownPageError } from './_boot-helpers.js';

const pw = loadPlaywright();

test('Quik1 boots, submits an application LEDGER can see, and receives the decision', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page, pageErrors } = await launchBrowser(pw.chromium, { width: 440, height: 940 });
    try {
      await page.goto(api.origin + '/quik1/', { waitUntil: 'load' });
      await pageWaitFor(page, () => /Use your first four digits to sign in/.test(document.body.innerText), null, { timeoutMs: BOOT_TIMEOUT_MS });
      const boot = await page.evaluate(() => ({
        bundlerErr: !!document.getElementById('__bundler_err'),
        link: window.Quik1Link && ['getState', 'subscribe', 'submitApplication', 'submitRequest', 'submitSignup', 'decide', 'decideSignup', 'confirmRepayment', 'repaymentFor', 'decisionFor', 'reset'].every(k => typeof window.Quik1Link[k] === 'function')
      }));
      assert.equal(boot.bundlerErr, false);
      assert.equal(boot.link, true, 'window.Quik1Link has the full public API');
      assert.deepEqual(pageErrors.filter(e => !isKnownPageError(e)), []);

      // ---- phone → API: the app's own submit call shape -----------------------------------------
      const app = { name: 'Test Person', phone: '0820000000', amount: 1500, term: '1 mo', purpose: 'Groceries', income: 9000, surplus: 1200 };
      const id = await page.evaluate(a => window.Quik1Link.submitApplication(a), app);
      assert.match(id, /^ap_[0-9a-f]{12}$/, 'client-generated id, returned synchronously');
      const local = await page.evaluate(id => window.Quik1Link.getState().applications.find(a => a.id === id), id);
      assert.equal(local.status, 'Needs decision');
      assert.equal(local.term, '1 mo');

      const row = await api.waitFor(f => f.find('applications', id), { timeoutMs: 5000, label: 'application row in the database' });
      assert.equal(row.status, 'new');
      assert.equal(row.source, 'quik1');
      assert.equal(row.name, 'Test Person');
      assert.equal(row.amount, 1500);
      assert.equal(row.term_months, 1);
      assert.equal(row.net_income, 9000);
      assert.equal(row.meta.surplus, 1200);
      assert.match(row.ref, /^AP-\d+$/);

      // ---- what LEDGER's Q1 poll sees (same route, same key the console uses) ----------------
      const listRes = await fetch(api.origin + '/api/q1/applications?status=new', { headers: { Authorization: 'Bearer ' + LEDGER_KEY } });
      assert.equal(listRes.status, 200);
      const list = await listRes.json();
      const seen = list.find(a => a.id === id);
      assert.ok(seen, 'the application is in LEDGER\'s new-applications feed');
      assert.equal(seen.term, 1); assert.equal(seen.income, 9000); assert.ok(seen.submitted);
      assert.equal((await fetch(api.origin + '/api/q1/applications?status=new')).status, 401, 'the Q1 route needs the staff key');

      // ---- LEDGER approves (qkPush shape) → phone sees the verdict within 10 s ----------------
      const patch = await fetch(api.origin + '/api/q1/applications/' + id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + LEDGER_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'approved' }) });
      assert.equal(patch.status, 200);
      const decided = await patch.json();
      assert.equal(decided.status, 'approved');
      assert.equal(decided.decision.verdict, 'approved');
      assert.equal(api.fake.find('applications', id).decided_by, 'ledger');

      await pageWaitFor(page, id => { const d = window.Quik1Link.getState().decisions[id]; return !!(d && d.verdict === 'approved'); }, id, { timeoutMs: 10000 });
      const state = await page.evaluate(id => { const s = window.Quik1Link.getState(); return { d: s.decisions[id], a: s.applications.find(x => x.id === id) }; }, id);
      assert.equal(state.d.verdict, 'approved');
      assert.equal(state.d.amount, 1500);
      assert.equal(state.d.by, 'Ecoloans');
      assert.equal(typeof state.d.at, 'number');
      assert.equal(state.a.status, 'Approved');
      assert.ok(api.requests.some(r => r.method === 'GET' && r.url === '/api/quik1/applications/' + id && r.status === 200), 'the phone polled its own application by id');
      assert.ok(api.requests.every(r => r.status !== 429), 'polling stays under the public rate limit');
      assert.deepEqual(pageErrors.filter(e => !isKnownPageError(e)), []);
    } finally {
      await browser.close();
    }
  });
});

// quik1.app serves this HTML at "/" (address bar stays /) while the files live in /quik1/.
function startRootHost() {
  const dir = path.resolve(new URL('../quik1/', import.meta.url).pathname);
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    // Production quik1.app keeps the address bar at "/" and only has files under /quik1/.
    // A request for /script.js must 404 here, or the test would hide a bad base URL.
    // The installable app aliases its manifest and service worker to the site root on quik1.app.
    if (urlPath === '/sw.js' || urlPath === '/manifest.webmanifest') {
      const name = urlPath.slice(1);
      const ext = name.split('.').pop().toLowerCase();
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(path.join(dir, name)).pipe(res);
    }
    if (urlPath === '/' || urlPath === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return fs.createReadStream(path.join(dir, 'index.html')).pipe(res);
    }
    if (!urlPath.startsWith('/quik1/')) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + urlPath); }
    let rel = urlPath.slice('/quik1/'.length);
    if (rel === '' || rel === 'index.html') rel = 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + urlPath); }
    const ext = file.split('.').pop().toLowerCase();
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}

test('Quik1 compiles when the host serves the HTML at /', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  const host = await startRootHost();
  const { browser, page, pageErrors, notFound } = await launchBrowser(pw.chromium, { width: 440, height: 940 });
  const requested = [];
  page.on('request', r => requested.push(r.url()));
  try {
    await page.goto(host.origin + '/', { waitUntil: 'load' });
    await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText) && /Use your first four digits to sign in/.test(document.body.innerText), null, { timeoutMs: BOOT_TIMEOUT_MS });
    const text = await page.evaluate(() => document.body.innerText);
    assert.equal(/\{\{/.test(text), false, 'no raw template markers');
    assert.equal(/Thandi Mokoena/.test(text), false, 'sample profile is not the signed-out screen');
    assert.equal(pageErrors.filter(e => !isKnownPageError(e)).length, 0);
    const assets = requested.filter(u => /\.(js|png|woff2|webp|mp4)(\?|$)/.test(u));
    assert.ok(assets.length > 0, 'the page requested scripts and images');
    const rootShell = new Set(['/sw.js']);
    assert.ok(assets.every(u => {
      const p = new URL(u).pathname;
      return p.startsWith('/quik1/') || rootShell.has(p);
    }), 'scripts, fonts, images and the splash video load from /quik1/');
    const real404 = notFound.filter(u => !u.includes('.image-slots.state.json'));
    assert.deepEqual(real404, [], 'no 404s for scripts, fonts or images');
  } finally {
    await browser.close();
    await new Promise(r => host.server.close(r));
  }
});
