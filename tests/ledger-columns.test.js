// Long references must stay inside their column on the loan list and the other
// Ledger sheets. Synthetic values only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LEDGER_KEY, loadPlaywright, withMockApi, pageWaitFor } from './_boot-helpers.js';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const LONG_REF = 'SYNREF00028W9SXXXXLONG';
const LONG_NAME = 'Synthetic Borrower';

test('loan list and the other sheets clip refs instead of overlapping the next column', () => {
  assert.match(html, /\.book-table\{[^}]*column-gap:12px/);
  assert.match(html, /\.book-line\{[^}]*grid-template-columns:subgrid/);
  assert.match(html, /\.cell-clip\{[^}]*text-overflow:ellipsis/);
  assert.match(html, /\.clip-row>\*\{[^}]*min-width:0/);
  const head = html.indexOf('class="book-line book-head"');
  const row = html.indexOf('class="book-line" sc-camel-on-click="{{ l.openClient }}"');
  assert.ok(head > 0 && row > head);
  const book = html.slice(head, row + 800);
  assert.match(book, /data-col="ref">REF NUMBER/);
  assert.match(book, /data-col="customer">CUSTOMER/);
  assert.match(book, /data-col="ref" title="\{\{ l\.ref \}\}"/);
  assert.match(book, /data-col="customer" title="\{\{ l\.customer \}\}"/);
  assert.match(html, /class="cell-clip" title="\{\{ c\.ref \}\}"/);
  assert.match(html, /class="cell-clip" title="\{\{ g\.ref \}\}"/);
  assert.doesNotMatch(html.slice(html.indexOf('data-screen-label="Logbook"'), html.indexOf('data-screen-label="Logbook"') + 2500), />#<\/div><div>REF<\/div>/);
});

const pw = loadPlaywright();

test('a long reference stays in its column at desktop and phone widths', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    api.fake.find('loans', 'l_test_901').ref = LONG_REF;
    api.fake.find('loans', 'l_test_901').status = 'issued';
    api.fake.find('clients', 'c_test_1').name = LONG_NAME;
    api.fake.find('loans', 'l_test_902').ref = 'SYNREF00029QXXXXLONG';
    api.fake.find('loans', 'l_test_902').status = 'overdue';
    api.fake.find('clients', 'c_test_2').name = 'Synthetic Borrower Two';
    const browser = await pw.chromium.launch();
    try {
      for (const width of [1440, 375]) {
        const page = await browser.newPage({ viewport: { width, height: width === 375 ? 1600 : 900 } });
        await page.addInitScript(({ origin, key, narrow }) => {
          localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
          localStorage.setItem('ledjaa.theme.v3', 'dark');
          if (narrow) localStorage.setItem('ledjaa.navCollapsed', '1');
        }, { origin: api.origin, key: LEDGER_KEY, narrow: width === 375 });
        await page.goto(api.origin + '/ledger/', { waitUntil: 'domcontentloaded' });
        await pageWaitFor(page, () => !document.getElementById('ledger-gate') && /Synthetic Borrower/.test(document.body.innerText), null, { timeoutMs: 20000 });
        if (await page.getByText('Acknowledge all', { exact: true }).count()) {
          await page.getByText('Acknowledge all', { exact: true }).first().dispatchEvent('click');
        }
        await page.locator('[title="Loans"]').first().dispatchEvent('click');
        await pageWaitFor(page, () => {
          const cell = document.querySelector('[data-col="ref"][title="' + 'SYNREF00028W9SXXXXLONG' + '"]');
          if (!cell) return false;
          return window.innerWidth < 700 || /REF NUMBER/.test(document.body.innerText);
        }, null, { timeoutMs: 8000 });
        const geom = await page.evaluate((ref) => {
          const cell = document.querySelector('[data-col="ref"][title="' + ref + '"]');
          const row = cell.closest('.book-line');
          const name = row.querySelector('[data-col="customer"]');
          const head = document.querySelector('.book-head [data-col="ref"]');
          const rb = cell.getBoundingClientRect();
          const nb = name.getBoundingClientRect();
          const hb = head.getBoundingClientRect();
          const rowBox = row.getBoundingClientRect();
          const intersects = !(rb.right <= nb.left + 0.5 || nb.right <= rb.left + 0.5 || rb.bottom <= nb.top + 0.5 || nb.bottom <= rb.top + 0.5);
          return {
            gap: nb.left - rb.right,
            overlap: rb.right > nb.left + 0.5,
            intersects,
            headerDelta: Math.abs(hb.left - rb.left),
            clips: cell.scrollWidth > cell.clientWidth + 1,
            inside: rb.right <= rowBox.right + 1 && nb.left >= rowBox.left - 1,
            title: cell.getAttribute('title')
          };
        }, LONG_REF);
        assert.equal(geom.intersects, false, width + ' ref and name overlap');
        if (width === 1440) {
          assert.equal(geom.overlap, false, width + ' columns overlap');
          assert.ok(geom.gap >= 8, width + ' gap ' + geom.gap);
          assert.ok(geom.headerDelta < 2, width + ' header delta ' + geom.headerDelta);
        }
        assert.equal(geom.clips, true, width + ' long ref is truncated');
        assert.equal(geom.inside, true);
        assert.equal(geom.title, LONG_REF);
        const closer = page.getByText('✕', { exact: true });
        if (await closer.count()) await closer.last().dispatchEvent('click');
        const shotDir = '/opt/cursor/artifacts';
        if (fs.existsSync(shotDir)) {
          await page.evaluate((ref) => {
            const cell = document.querySelector('[data-col="ref"][title="' + ref + '"]');
            if (cell) cell.scrollIntoView({ block: 'center', inline: 'start' });
          }, LONG_REF);
          const file = path.join(shotDir, width === 1440 ? 'ledger-ref-after-desktop.png' : 'ledger-ref-after-mobile.png');
          if (width === 1440) await page.locator('.book-table').screenshot({ path: file });
          else {
            const box = await page.locator('.book-table').boundingBox();
            await page.screenshot({ path: file, clip: { x: 0, y: Math.max(0, box.y - 4), width, height: Math.min(280, box.height + 8) } });
          }
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
