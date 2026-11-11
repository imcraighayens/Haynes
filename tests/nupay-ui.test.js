// NuPay on the live mock book: storage stays still, a re-rendered tab still accepts
// the first file, and the summary tiles stack to one column on a phone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { LEDGER_KEY, loadPlaywright, launchBrowser, withMockApi, clickText, pageWaitFor } from './_boot-helpers.js';

const pw = loadPlaywright();
const csv = fileURLToPath(new URL('./fixtures/nupay/fake_live_book_report.csv', import.meta.url));
const skip = pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)';

async function boot(page, origin) {
  await page.addInitScript(({ origin, key }) => {
    localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
    localStorage.setItem('ledjaa.theme.v3', 'dark');
  }, { origin, key: LEDGER_KEY });
  await page.goto(origin + '/ledger/', { waitUntil: 'load' });
  await pageWaitFor(page, () => !document.getElementById('ledger-gate') && /Reports/.test(document.body.innerText), null, { timeoutMs: 20000 });
  if (await page.getByText('Acknowledge all', { exact: true }).count()) await clickText(page, 'Acknowledge all');
}

async function openNuPay(page) {
  await clickText(page, 'Reports');
  await page.waitForSelector('[data-report-tab="nupay"]', { state: 'attached' });
  await page.locator('[data-report-tab="nupay"]').first().dispatchEvent('click');
  await page.waitForSelector('#nupay-tab-drop', { state: 'attached' });
}

test('upload, render, and export do not write storage, and the first file after a re-render still opens', { skip, timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
    try {
      await boot(page, api.origin);
      await page.waitForTimeout(1500);
      await openNuPay(page);
      await page.waitForTimeout(800);
      await page.evaluate(async () => {
        const raw = Storage.prototype.setItem;
        window.__storageWrites = [];
        Storage.prototype.setItem = function (key, value) {
          window.__storageWrites.push(key);
          return raw.call(this, key, value);
        };
        window.__ls = {};
        for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); window.__ls[key] = localStorage.getItem(key); }
        window.__ss = {};
        for (let i = 0; i < sessionStorage.length; i++) { const key = sessionStorage.key(i); window.__ss[key] = sessionStorage.getItem(key); }
        window.__idb = indexedDB.databases ? (await indexedDB.databases()).map(db => db.name + ':' + db.version) : [];
      });
      await page.locator('#nupay-tab-file').first().setInputFiles(csv);
      await pageWaitFor(page, () => {
        const scrim = document.getElementById('nupay-report-scrim');
        return !!(scrim && !scrim.hidden && /Matched/.test(scrim.innerText) && /Pending/.test(scrim.innerText) && /Unknown/.test(scrim.innerText));
      }, null, { timeoutMs: 8000 });
      await page.locator('#nupay-report-export').click();
      await pageWaitFor(page, () => /Exported \d+ rows/.test(document.body.innerText), null, { timeoutMs: 5000 });
      await page.waitForTimeout(600);
      const storage = await page.evaluate(async () => {
        const ls = [];
        const names = new Set(Object.keys(window.__ls));
        for (let i = 0; i < localStorage.length; i++) names.add(localStorage.key(i));
        for (const key of names) if (window.__ls[key] !== localStorage.getItem(key)) ls.push(key);
        const ss = [];
        const snames = new Set(Object.keys(window.__ss));
        for (let i = 0; i < sessionStorage.length; i++) snames.add(sessionStorage.key(i));
        for (const key of snames) if (window.__ss[key] !== sessionStorage.getItem(key)) ss.push(key);
        const idb = indexedDB.databases ? (await indexedDB.databases()).map(db => db.name + ':' + db.version) : [];
        return { writes: window.__storageWrites, ls, ss, idbSame: JSON.stringify(idb) === JSON.stringify(window.__idb) };
      });
      assert.deepEqual(storage.writes, []);
      assert.deepEqual(storage.ls, []);
      assert.deepEqual(storage.ss, []);
      assert.equal(storage.idbSame, true);

      await page.locator('#nupay-report-scrim button[aria-label="Close NuPay report"]').click();
      await clickText(page, 'Dashboard');
      await openNuPay(page);
      await page.locator('#nupay-tab-file').first().setInputFiles(csv);
      await pageWaitFor(page, () => {
        const scrim = document.getElementById('nupay-report-scrim');
        return !!(scrim && !scrim.hidden && /Matched/.test(scrim.innerText) && /Loan found/.test(scrim.innerText));
      }, null, { timeoutMs: 8000 });
    } finally {
      await browser.close();
    }
  });
});

test('summary tiles are one column from 360 through 639', { skip, timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
    try {
      await boot(page, api.origin);
      await openNuPay(page);
      await page.locator('#nupay-tab-file').first().setInputFiles(csv);
      await pageWaitFor(page, () => {
        const scrim = document.getElementById('nupay-report-scrim');
        return !!(scrim && !scrim.hidden && document.getElementById('nupay-report-summary'));
      }, null, { timeoutMs: 8000 });
      const columns = async () => page.evaluate(() => getComputedStyle(document.getElementById('nupay-report-summary')).gridTemplateColumns.split(' ').filter(Boolean).length);
      assert.equal(await columns(), 4);
      for (const width of [360, 390, 430, 639]) {
        await page.setViewportSize({ width, height: 800 });
        assert.equal(await columns(), 1, 'width ' + width);
      }
    } finally {
      await browser.close();
    }
  });
});
