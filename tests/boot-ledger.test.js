// node --test tests/boot-ledger.test.js
// Boots the design-frozen LEDGER console in headless Chromium against tools/mock-api.js (the real
// api/ handlers over the in-memory fake PostgREST seeded from tests/fixtures/state.json) and
// checks the whole bridge: cloud rows reach the screen, console writes reach the database, and
// regulatory settings columns are never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_KEY, BOOT_TIMEOUT_MS, loadPlaywright, launchBrowser, withMockApi, bodyText, pageWaitFor, clickText, isKnownPageError } from './_boot-helpers.js';

const pw = loadPlaywright();
const FIXTURE_REFS = ['ECL-901', 'ECL-902', 'ECL-903', 'ECL-904', 'ECL-905'];
const FIXTURE_NAMES = ['Test Client One', 'Test Client Two', 'Test Client Three'];

test('LEDGER boots on cloud data and mirrors console writes to the API', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page, pageErrors, notFound } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
    try {
      // The console reads ledjaa.supabase synchronously in its constructor and ledger-sync.js
      // pre-fetches with it, so the key must be in localStorage before any script runs.
      await page.addInitScript(({ origin, key }) => {
        try {
          if (!localStorage.getItem('ledjaa.supabase')) {
            localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
          }
        } catch (e) { /* storage unavailable: the app boots local-only and the asserts below fail loudly */ }
      }, { origin: api.origin, key: LEDGER_KEY });

      await page.goto(api.origin + '/ledger/', { waitUntil: 'load' });
      await pageWaitFor(page, () => !!(window.__ledgerDb && window.__ledgerDb.sync && window.__ledgerDb.sync.status !== 'loading') && /ECL-\d{3}/.test(document.body.innerText), null, { timeoutMs: BOOT_TIMEOUT_MS });

      // ---- boot: shim contract, adapter state, no bundler/page errors -------------------------
      const boot = await page.evaluate(() => ({
        bundlerErr: !!document.getElementById('__bundler_err'),
        shim: !!(window.__ledger && typeof window.__ledger.api === 'function' && window.__ledger.state && typeof window.__ledger.state.then === 'function'),
        shimError: window.__ledger && window.__ledger.error,
        sync: window.__ledgerDb && window.__ledgerDb.sync,
        users: window.__ledgerDb.table('users').map(u => u.id),
        loans: window.__ledgerDb.rows('loans').map(l => l.id).sort(),
        q1: JSON.parse(localStorage.getItem('q1.apps') || '[]').find(a => /quik1/i.test(a.name))
      }));
      assert.equal(boot.bundlerErr, false, 'no __bundler_err');
      assert.equal(boot.shim, true, 'ledger-sync.js exposes window.__ledger {api, state}');
      assert.equal(boot.shimError, null, 'state pre-fetch succeeded');
      assert.equal(boot.sync.source, 'cloud');
      assert.equal(boot.sync.status, 'ready', 'adapter is synced (its vocabulary for "nothing pending" is ready)');
      assert.equal(boot.sync.pending, 0);
      assert.deepEqual(boot.users, ['e1']);
      assert.deepEqual(boot.loans, ['l_test_901', 'l_test_902', 'l_test_903', 'l_test_904', 'l_test_905']);
      assert.equal(boot.q1.url, api.origin + '/api/q1', 'q1.apps Quik1 entry points at the bridge');
      assert.equal(boot.q1.key, LEDGER_KEY);
      assert.ok(boot.q1.on && boot.q1.actions);

      const unexpected = pageErrors.filter(e => !isKnownPageError(e));
      assert.deepEqual(unexpected, [], 'no uncaught page errors beyond the known template-parse warnings');
      const real404 = notFound.filter(u => !/%7B%7B|\{\{/.test(u)); // "{{ reelSrc }}" iframe placeholder before compile
      assert.deepEqual(real404, [], 'no 404s for real resources');
      assert.ok(api.requests.some(r => r.method === 'GET' && r.url === '/api/ledger/state' && r.status === 200), 'GET /api/ledger/state was called with the key');

      // ---- the fixture is on screen: dashboard shows the clients, the loan book every ref ------
      const dash = await bodyText(page);
      assert.ok(dash.includes('Test Admin'), 'admin employee from the DB is the signed-in profile');
      for (const n of ['Test Client One', 'Test Client Two']) assert.ok(dash.includes(n), 'dashboard shows ' + n);
      assert.ok(/ECL-90\d/.test(dash), 'dashboard shows a fixture loan ref');

      // The overdue-attention gate pins the loan filter; acknowledge it, open the book, show ALL.
      // Without a search term the book lists only this month's instalments, so search for "ECL".
      if (await page.getByText('Acknowledge all', { exact: true }).count()) await clickText(page, 'Acknowledge all');
      await clickText(page, 'Loans');
      await pageWaitFor(page, () => /LOAN BOOK/.test(document.body.innerText), null, { timeoutMs: 5000 });
      await clickText(page, 'ALL');
      await page.getByPlaceholder('Search…').first().fill('ECL');
      await pageWaitFor(page, () => document.body.innerText.includes('ECL-901'), null, { timeoutMs: 5000 });
      const book = await bodyText(page);
      for (const ref of FIXTURE_REFS) assert.ok(book.includes(ref), 'loan book lists ' + ref);
      for (const n of FIXTURE_NAMES) assert.ok(book.includes(n), 'loan book lists ' + n);
      assert.ok(!book.includes('Test Client Archived'), 'soft-deleted client never shows');
      assert.ok(!/Prince|Thabo|Lerato|Moatshe/.test(book), 'no demo/seed data leaks into the hosted console');

      // ---- a console write: logbook entry → audit_log insert within 5 s -----------------------
      const entry = { ref: 'ECL-901', customer: 'Test Client One', amount: 2000, type: 'PAYMENT RECEIVED', date: '29 OCT 2026', by: 'Test Admin', comment: 'boot-test entry ' + Date.now() };
      await page.evaluate(e => {
        const sv = JSON.parse(localStorage.getItem('evoltConsoleV4'));
        localStorage.setItem('evoltConsoleV4', JSON.stringify({ ...sv, logbook: [e, ...(sv.logbook || [])] }));
      }, entry);
      const audit = await api.waitFor(f => f.table('audit_log').find(r => r.comment === entry.comment), { timeoutMs: 5000, label: 'audit_log insert' });
      assert.equal(audit.type, 'PAYMENT RECEIVED');
      assert.equal(audit.ref, 'ECL-901');
      assert.equal(audit.by, 'Test Admin');
      assert.match(audit.id, /^al_[0-9a-f]{16}/, 'mirror-derived stable id');
      const auditWrite = api.log.find(w => w.table === 'audit_log' && w.method === 'POST');
      assert.ok(auditWrite && auditWrite.resolution === 'ignore', 'audit_log goes in as insert-or-ignore, never an update');
      assert.equal(api.log.filter(w => w.table === 'audit_log' && w.method !== 'POST').length, 0, 'audit_log is never PATCHed');

      // ---- a settings write: org tagline → settings upsert; NCR/fee columns untouched ----------
      const before = JSON.parse(JSON.stringify(api.fake.find('settings', 'org')));
      await page.evaluate(() => {
        const o = JSON.parse(localStorage.getItem('evoltOrg') || '{}');
        localStorage.setItem('evoltOrg', JSON.stringify({ ...o, name: o.name || 'Test Lender', tagline: 'Renamed by boot test' }));
      });
      const settings = await api.waitFor(f => { const s = f.find('settings', 'org'); return s && s.tagline === 'Renamed by boot test' ? s : null; }, { timeoutMs: 5000, label: 'settings upsert' });
      assert.equal(settings.ncr_reg_no, 'NCRCP0000', 'ncr_reg_no never overwritten');
      assert.equal(settings.company_reg_no, before.company_reg_no);
      assert.equal(settings.default_collection_fee, before.default_collection_fee);
      assert.equal(settings.protection_fee, before.protection_fee);
      assert.equal(settings.org_name, before.org_name);
      const settingsWrites = api.log.filter(w => w.table === 'settings');
      assert.ok(settingsWrites.length >= 1 && settingsWrites.every(w => w.rows.every(r => !('ncr_reg_no' in r) && !('protection_fee' in r))), 'the bridge never sends NCR/fee columns');

      // ---- an adapter write: db.update → loans upsert with live columns -----------------------
      const after = await page.evaluate(async () => {
        const db = window.__ledgerDb;
        db.update('loans', 'l_test_901', { purpose: 'Updated by boot test', status: 'issued' });
        await db.flush();
        return db.sync;
      });
      assert.equal(after.status, 'ready');
      assert.equal(after.pending, 0);
      assert.equal(after.lastError, null);
      assert.equal(api.fake.find('loans', 'l_test_901').purpose, 'Updated by boot test');
      assert.equal(api.fake.table('loans').length, 5, 'no loan was created or hard-deleted');
      assert.equal(api.log.filter(w => w.method === 'DELETE').length, 0, 'nothing is ever deleted');
      const loanWrite = api.log.filter(w => w.table === 'loans').pop();
      assert.ok(loanWrite.rows[0].instalment_amount !== undefined && !('instalment' in loanWrite.rows[0]) && !('due_date' in loanWrite.rows[0]), 'live column names only');
    } finally {
      await browser.close();
    }
  });
});
