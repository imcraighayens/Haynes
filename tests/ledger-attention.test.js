// The attention popup follows the saved server book, not a stale browser snapshot.
// Synthetic loans only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LEDGER_KEY, loadPlaywright, withMockApi, pageWaitFor } from './_boot-helpers.js';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

test('the attention popup is wired to the server book and a per-staff acknowledgement', () => {
  assert.match(html, /src="\.\/attention\.js"/);
  assert.match(html, /\{\{ attnHeading \}\}/);
  assert.doesNotMatch(html, /\{\{ attnCount \}\} accounts need attention/);
  assert.match(html, /popupKeeps\(l\.serverStatus\)/);
  assert.match(html, /attentionAmount\(l, todayIso\)/);
  assert.match(html, /attentionNote\(l, todayIso\)/);
  assert.match(html, /POST','\/loan-status'/);
  assert.match(html, /Could not save the loan status/);
  assert.match(html, /commitLoanStatus\(mLoanRaw\.id/);
  assert.match(html, /commitLoanStatus\(l\.id, s, 'Changed from client workspace'\)/);
  assert.match(html, /rememberAttention\(\[\{loanId:l\.id/);
});

const pw = loadPlaywright();

function seed(api) {
  const loan = api.fake.db.loans.find(l => l.id === 'l_test_902');
  loan.status = 'overdue';
  loan.schedule = [];
  loan.paid_dates = [];
  loan.principal = 4050;
  loan.instalment_amount = 4140.47;
  loan.instalments_paid = 0;
  loan.status_at = '2026-11-05T08:00:00.000Z';
  const client = api.fake.db.clients.find(c => c.id === 'c_test_2');
  client.name = 'Synthetic Borrower';
  return loan;
}

async function openLedger(page, origin) {
  await page.addInitScript(({ origin, key }) => {
    localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
    localStorage.setItem('ledjaa.theme.v3', 'dark');
    localStorage.setItem('ledjaa.navCollapsed', '1');
    localStorage.setItem('evoltConsoleV4', JSON.stringify({
      clients: [{ id: 'c_stale', name: 'Stale Snapshot', ref: 'EC-000' }],
      loans: [{ id: 'l_stale', ref: 'SYN-STALE', clientId: 'c_stale', amount: 9999, status: 'overdue', due: '—', sched: [] }]
    }));
  }, { origin, key: LEDGER_KEY });
  await page.goto(origin + '/ledger/', { waitUntil: 'domcontentloaded' });
  await pageWaitFor(page, () => !document.getElementById('ledger-gate'), null, { timeoutMs: 20000 });
}

test('acknowledge, view and attend follow the saved loan, and a paid loan stays off the popup', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    seed(api);
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(20000);
    try {
      await openLedger(page, api.origin);
      await pageWaitFor(page, () => /1 account needs attention/.test(document.body.innerText) && /Overdue since 5 Nov 2026/.test(document.body.innerText), null, { timeoutMs: 20000 });
      const text = await page.locator('body').innerText();
      assert.match(text, /1 account needs attention/);
      assert.match(text, /Overdue since 5 Nov 2026/);
      assert.match(text, /R 4 140\.47/);
      assert.doesNotMatch(text, /Overdue since —/);
      assert.doesNotMatch(text, /1 accounts need attention/);
      assert.doesNotMatch(text, /ECL-902 · Overdue since 5 Nov 2026 · R 4 050/);
      assert.doesNotMatch(text, /SYN-STALE/);
      assert.doesNotMatch(text, /Stale Snapshot/);
      const closer = page.getByText('✕', { exact: true });
      if (await closer.count()) await closer.last().dispatchEvent('click');
      if (fs.existsSync('/opt/cursor/artifacts')) {
        const box = await page.evaluate(() => {
          const el = [...document.querySelectorAll('div')].find(n => /1 account needs attention/.test(n.textContent || '') && n.getBoundingClientRect().width > 200 && n.getBoundingClientRect().width < 700);
          const r = el.getBoundingClientRect();
          return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: Math.min(1280, r.width + 24), height: Math.min(800, r.height + 24) };
        });
        await page.screenshot({ path: '/opt/cursor/artifacts/ledger-attention-after.png', clip: box });
      }

      await page.evaluate(() => {
        const view = [...document.querySelectorAll('div')].find(el => (el.textContent || '').trim() === 'View' && (el.parentElement && el.parentElement.textContent || '').includes('Overdue since 5 Nov 2026'));
        view.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await pageWaitFor(page, () => /LOAN HISTORY/.test(document.body.innerText) && /ECL-902/.test(document.body.innerText), null, { timeoutMs: 8000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await pageWaitFor(page, () => /1 account needs attention/.test(document.body.innerText), null, { timeoutMs: 20000 });
      await page.evaluate(() => {
        const attend = [...document.querySelectorAll('div')].find(el => (el.textContent || '').trim() === 'Attend' && (el.parentElement && el.parentElement.textContent || '').includes('Overdue since 5 Nov 2026'));
        attend.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await pageWaitFor(page, () => !!document.querySelector('[data-screen-label="Client workspace"]') && /Synthetic Borrower/.test(document.body.innerText), null, { timeoutMs: 8000 });

      await page.route('**/api/ledger/loan-status', route => route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'The loan was not updated' })
      }));
      const clickPaid = () => page.evaluate(() => {
        const root = document.querySelector('[data-screen-label="Client workspace"]');
        const label = [...root.querySelectorAll('div')].find(el => (el.textContent || '').trim() === 'ECL-902');
        let node = label;
        while (node && node !== root) {
          const paid = [...node.querySelectorAll('div')].find(el => (el.textContent || '').trim() === 'PAID');
          if (paid && node.getBoundingClientRect().height < 180) {
            paid.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return true;
          }
          node = node.parentElement;
        }
        return false;
      });
      assert.equal(await clickPaid(), true);
      await pageWaitFor(page, () => /Nothing was changed/.test(document.body.innerText), null, { timeoutMs: 8000 });
      assert.equal(api.fake.db.loans.find(l => l.id === 'l_test_902').status, 'overdue');
      await page.unroute('**/api/ledger/loan-status');
      assert.equal(await clickPaid(), true);
      await pageWaitFor(page, () => /ECL-902 → PAID/.test(document.body.innerText), null, { timeoutMs: 8000 });
      const row = api.fake.db.loans.find(l => l.id === 'l_test_902');
      assert.equal(row.status, 'paid');
      assert.ok(row.updated_at);
      assert.equal(row.updated_by, 'staff');
      assert.ok(row.instalments_paid >= 1);
      assert.ok(api.fake.db.audit_log.some(entry => entry && entry.ref === 'ECL-902' && /PAID/.test(String(entry.type || ''))));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await pageWaitFor(page, () => !document.getElementById('ledger-gate') && (document.body.innerText || '').length > 80, null, { timeoutMs: 20000 });
      const again = await page.evaluate(async () => {
        const st = await window.__ledger.api('GET', '/state');
        const loan = (st.loans || []).find(l => l.id === 'l_test_902');
        return loan ? loan.status : '';
      });
      assert.equal(again, 'paid');
      await page.waitForTimeout(500);
      assert.doesNotMatch(await page.locator('body').innerText(), /needs attention/);
    } finally {
      await browser.close();
    }
  });
});
