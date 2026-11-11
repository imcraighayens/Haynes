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

test('upload, render, and export leave no NuPay data in storage, and the first file after a re-render still opens', { skip, timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
    try {
      await boot(page, api.origin);
      await page.waitForTimeout(1500);
      await openNuPay(page);
      await page.waitForTimeout(800);
      await page.locator('#nupay-tab-file').first().setInputFiles(csv);
      await pageWaitFor(page, () => {
        const scrim = document.getElementById('nupay-report-scrim');
        return !!(scrim && !scrim.hidden && /Matched/.test(scrim.innerText) && /Pending/.test(scrim.innerText) && /Unknown/.test(scrim.innerText));
      }, null, { timeoutMs: 8000 });
      await page.locator('#nupay-report-export').click();
      await pageWaitFor(page, () => /Exported \d+ rows/.test(document.body.innerText), null, { timeoutMs: 5000 });
      await page.waitForTimeout(600);
      const leaked = await page.evaluate(async () => {
        const parts = [];
        for (let i = 0; i < localStorage.length; i++) parts.push(localStorage.getItem(localStorage.key(i)));
        for (let i = 0; i < sessionStorage.length; i++) parts.push(sessionStorage.getItem(sessionStorage.key(i)));
        if (indexedDB.databases) {
          const dbs = await indexedDB.databases();
          for (const info of dbs) {
            parts.push(info.name || '');
            const rows = await new Promise(resolve => {
              const req = indexedDB.open(info.name);
              req.onerror = () => resolve('');
              req.onsuccess = () => {
                const db = req.result;
                const names = [...db.objectStoreNames];
                if (!names.length) { db.close(); resolve(''); return; }
                const tx = db.transaction(names, 'readonly');
                const chunks = [];
                let left = names.length;
                names.forEach(name => {
                  const get = tx.objectStore(name).getAll();
                  get.onsuccess = () => { chunks.push(JSON.stringify(get.result)); if (--left === 0) { db.close(); resolve(chunks.join('\n')); } };
                  get.onerror = () => { if (--left === 0) { db.close(); resolve(chunks.join('\n')); } };
                });
              };
            });
            parts.push(rows);
          }
        }
        return parts.join('\n');
      });
      for (const secret of ['90000999', '9001015800081', '620184739201', '0825550143', 'nobody.live@example.com', '2760.32', '690.08', '552.06', 'fake_live_book_report']) {
        assert.equal(leaked.includes(secret), false, secret);
      }

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

test('Esc, Close, and a scrim click return focus to the NuPay tab', { skip, timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const { browser, page } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
    try {
      await boot(page, api.origin);
      await openNuPay(page);
      const focusedTab = () => page.evaluate(() => {
        const el = document.activeElement;
        const scrim = document.getElementById('nupay-report-scrim');
        return {
          tab: el && el.getAttribute ? el.getAttribute('data-report-tab') : '',
          closed: !!(scrim && scrim.hidden)
        };
      });
      const openSheet = async () => {
        await page.locator('#nupay-tab-file').first().setInputFiles(csv);
        await pageWaitFor(page, () => {
          const scrim = document.getElementById('nupay-report-scrim');
          return !!(scrim && !scrim.hidden);
        }, null, { timeoutMs: 8000 });
      };
      await openSheet();
      await page.keyboard.press('Escape');
      let focus = await focusedTab();
      assert.equal(focus.closed, true);
      assert.equal(focus.tab, 'nupay');

      await openSheet();
      await page.locator('#nupay-report-scrim button[aria-label="Close NuPay report"]').click();
      focus = await focusedTab();
      assert.equal(focus.closed, true);
      assert.equal(focus.tab, 'nupay');

      await openSheet();
      await page.evaluate(() => document.getElementById('nupay-report-scrim').click());
      focus = await focusedTab();
      assert.equal(focus.closed, true);
      assert.equal(focus.tab, 'nupay');
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
