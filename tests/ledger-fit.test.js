// Desktop views stay inside the viewport. Long lists scroll inside their own panel,
// so the last row and its action stay reachable. The approve, submit, and
// application_id blocks stay byte-for-byte with master.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { LEDGER_KEY, BOOT_TIMEOUT_MS, loadPlaywright, launchBrowser, withMockApi, pageWaitFor, isKnownPageError } from './_boot-helpers.js';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

function hashBetween(start, end) {
  const i = html.indexOf(start);
  const j = html.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'missing block ' + start.slice(0, 40));
  return createHash('sha256').update(html.slice(i, j + end.length)).digest('hex');
}

test('protected application and loan blocks match master af5844a', () => {
  assert.equal(hashBetween(
    "        else db.insert('loans', {id:l.id, ...patch, application_id:null",
    '          created_at:new Date().toISOString(), deleted_at:null});'
  ), 'e8b577458d264eb67c03592de9d2386204c1e68dee628a40b0f1d10771f0a288');
  assert.equal(hashBetween(
    "        const matched = st.applications.filter(a=>(st.appFilter==='all'||a.status===st.appFilter)",
    "              this.toast('Application from '+av.name+' declined — logged'); } };"
  ), '3561cd21e8df75d387ecd40328523df9628d03ca1b1c07595b0172def555db97');
  assert.equal(hashBetween(
    "      submitLoan:()=>{ const c=clientById(st.nf.client);",
    "        this.setState({issuedNote:{ref, name:c.name, clientId:c.id, amount:this.fmt(amt), ret:this.fmt(Math.round(amt*1.35)), due:st.nf.due||'19 Aug 2026'}}); },"
  ), 'bca5f11796a151345bcbd3c23a096b1f94d2f0601cc1ffde1804ca2b4fe7b7ed');
});

const pw = loadPlaywright();

test('list views keep the last row and its action inside a panel, not the page', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  const saved = process.env.LEDGER_STAFF_TEST_LOGINS;
  process.env.LEDGER_STAFF_TEST_LOGINS = JSON.stringify({
    'admin@test.invalid': { password: 'test-only-staff', name: 'Test Admin' }
  });
  try {
    await withMockApi(async api => {
      const { browser, page, pageErrors } = await launchBrowser(pw.chromium, { width: 1440, height: 900 });
      try {
        await page.addInitScript(({ origin, key }) => {
          localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
          localStorage.setItem('ledjaa.theme.v3', 'light');
        }, { origin: api.origin, key: LEDGER_KEY });
        await page.goto(api.origin + '/ledger/', { waitUntil: 'load' });
        await pageWaitFor(page, () => !document.getElementById('ledger-gate') && /Dashboard/.test(document.body.innerText), null, { timeoutMs: BOOT_TIMEOUT_MS });
        await page.evaluate(() => {
          const ack = [...document.querySelectorAll('div')].find(n => n.childNodes.length === 1 && n.textContent === 'Acknowledge all');
          if (ack) ack.click();
          const close = [...document.querySelectorAll('div')].find(n => n.childNodes.length === 1 && n.textContent === '✕');
          if (close) close.click();
        });

        const views = [
          ['Loans', '.book-line:not(.book-head)'],
          ['Applications', '[data-screen-label="Applications inbox"] .clip-row'],
          ['Clients', '[data-screen-label="Clients"] .clip-row']
        ];
        for (const [title, selector] of views) {
          await page.locator('.nav-item[title="' + title + '"]').dispatchEvent('click');
          await page.waitForTimeout(400);
          const fit = await page.evaluate((sel) => {
            const pageFits = document.documentElement.scrollHeight <= document.documentElement.clientHeight + 2
              && document.body.scrollHeight <= document.body.clientHeight + 2;
            const main = document.querySelector('.ledger-main');
            const mainFits = !main || main.scrollHeight <= main.clientHeight + 2;
            const rows = [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length);
            const last = rows[rows.length - 1];
            if (!last) return { title: sel, pageFits, mainFits, reachable: false, reason: 'no row' };
            let scroller = last.parentElement;
            while (scroller && scroller !== document.body) {
              const oy = getComputedStyle(scroller).overflowY;
              if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 2) break;
              scroller = scroller.parentElement;
            }
            if (scroller && scroller !== document.body) scroller.scrollTop = scroller.scrollHeight;
            const action = last.querySelector('button, .row-act, [role="button"]') || last;
            const r = action.getBoundingClientRect();
            const box = (scroller && scroller !== document.body) ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
            const reachable = r.height > 0 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2 && r.top >= -1 && r.bottom <= window.innerHeight + 2;
            return { pageFits, mainFits, reachable, rows: rows.length };
          }, selector);
          assert.equal(fit.pageFits, true, title + ' scrolls the page');
          assert.equal(fit.mainFits, true, title + ' scrolls the main pane');
          assert.equal(fit.reachable, true, title + ' last row is not reachable ' + JSON.stringify(fit));
        }
        assert.deepEqual(pageErrors.filter(e => !isKnownPageError(e)), []);
      } finally {
        await browser.close();
      }
    });
  } finally {
    if (saved == null) delete process.env.LEDGER_STAFF_TEST_LOGINS;
    else process.env.LEDGER_STAFF_TEST_LOGINS = saved;
  }
});
