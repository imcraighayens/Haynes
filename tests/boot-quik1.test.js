// node --test tests/boot-quik1.test.js
// Boots the design-frozen Quik1 customer app in headless Chromium against tools/mock-api.js and
// walks a loan application through the bridge: the phone submits → the API holds it as a new
// quik1 application for LEDGER → LEDGER's Q1 route approves it → the phone sees the decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_KEY, BOOT_TIMEOUT_MS, loadPlaywright, launchBrowser, withMockApi, pageWaitFor, isKnownPageError } from './_boot-helpers.js';

const pw = loadPlaywright();

test('Quik1 boots, submits an application LEDGER can see, and receives the decision', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page, pageErrors } = await launchBrowser(pw.chromium, { width: 440, height: 940 });
    try {
      await page.goto(api.origin + '/quik1/', { waitUntil: 'load' });
      await pageWaitFor(page, () => /Borrow from R500/.test(document.body.innerText), null, { timeoutMs: BOOT_TIMEOUT_MS });
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
