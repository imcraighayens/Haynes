// Layout fit for the V1 reskin: lists scroll under the pointer, the dashboard
// bento fits at 1280x800, and Ask Q1 stays on screen. Synthetic rows only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { LEDGER_KEY, loadPlaywright, withMockApi, pageWaitFor } from './_boot-helpers.js';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

function slice(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a) + end.length;
  assert.ok(a > 0 && b > a, start);
  return html.slice(a, b);
}
function sha(start, end) {
  return crypto.createHash('sha256').update(slice(start, end)).digest('hex');
}

test('protected blocks and the settings copy stay byte-identical', () => {
  assert.equal(sha("else db.insert('loans'", 'deleted_at:null});'), 'e472fb00eb0c1ae7aabd659f5f4492137bad802a244597518128a98a41e1bfca');
  assert.equal(sha('const matched = st.applications.filter', "declined — logged'); } };"), '31ede299c70ccb283b903454d357403b901220de40c42dd1359835a5a70718ce');
  assert.equal(sha('submitLoan:()=>{', 'inOn: !!st.issuedNote'), '8d4a0ed7cb8ba93d1d0cabd16ee72b74d36a9f22b2443890e6fbbd276da8e3e0');
  assert.equal(sha('data-screen-label="Issue loan"', 'data-screen-label="Add client"'), 'a76cd88b697085e5e42e1031fa3fa2e1516152fc7f6b2e97dc404122ce3b3bb5');
  assert.match(html, /Signed in · Johannesburg · 19 Jul 2026/);
  assert.match(html, /DATA &amp; MVP HANDOFF/);
  assert.match(html, /class="bento"/);
  assert.match(html, /showLegacyDash: st\.route==='markets'\|\|st\.route==='collections'/);
  assert.equal(html.includes('.book-scroll{overflow:visible}'), false);
  assert.equal(html.includes('max-height:none') && html.includes('.book-scroll{overflow:visible}'), false);
});

const pw = loadPlaywright();

function seedBook(api) {
  const month = new Date().toISOString().slice(0, 7) + '-15';
  const loans = api.fake.db.loans;
  const clients = api.fake.db.clients;
  const baseLoan = loans.find(l => l.id === 'l_test_901');
  const baseClient = clients.find(c => c.id === 'c_test_1');
  for (let i = 0; i < 14; i++) {
    clients.push({ ...baseClient, id: 'c_fit_' + i, ref: 'EC-F' + i, name: 'Fit Client ' + i });
    loans.push({
      ...baseLoan,
      id: 'l_fit_' + i,
      ref: 'ECL-F' + i,
      client_id: 'c_fit_' + i,
      status: i < 8 ? 'overdue' : 'issued',
      schedule: [month],
      instalments_paid: 0,
      paid_dates: []
    });
  }
  if (!Array.isArray(api.fake.db.applications)) api.fake.db.applications = [];
  for (let i = 0; i < 14; i++) {
    api.fake.db.applications.push({
      id: 'app_fit_' + i,
      name: 'Fit Applicant ' + i,
      phone: '08000000' + String(i).padStart(2, '0'),
      email: 'fit' + i + '@test.invalid',
      id_number: '0000000000000',
      amount: 1000 + i,
      term_months: 1,
      purpose: 'Fit',
      employer: 'Fit Co',
      job_title: 'Tester',
      net_income: 9000,
      bank: 'Test Bank',
      status: 'new',
      source: 'quik1',
      created_at: month + 'T08:00:00.000Z'
    });
  }
}

async function boot(page, origin) {
  await page.goto(origin + '/ledger/', { waitUntil: 'domcontentloaded' });
  await pageWaitFor(page, () => !document.getElementById('ledger-gate') && /book outstanding|dashboard/i.test(document.body.innerText), null, { timeoutMs: 20000 });
  const ack = page.getByText('Acknowledge all', { exact: true });
  if (await ack.count()) await ack.first().dispatchEvent('click');
}

async function clickTitle(page, title) {
  const loc = page.locator('[title="' + title + '"]').first();
  await loc.waitFor({ state: 'attached', timeout: 8000 });
  await loc.dispatchEvent('click');
}

const NAV_TITLES = ['Dashboard', 'Loans', 'Applications', 'Collections', 'Markets', 'Messages', 'Clients', 'Logbook', 'Admin', 'Petty cash', 'Notifications', 'Nupay'];
const APP_SCROLL = '[data-screen-label="Applications inbox"] > div[style*="overflow: auto"]';

async function assertNavReachable(page) {
  const menu = page.locator('[aria-label="Open menu"]');
  if (await menu.count() && await menu.first().isVisible()) {
    await menu.first().dispatchEvent('click');
    await page.waitForTimeout(250);
  }
  for (const title of NAV_TITLES) {
    let reached = false;
    for (let step = 0; step < 16; step++) {
      reached = await page.evaluate((title) => {
        const item = document.querySelector('[title="' + title + '"]');
        const scroller = document.querySelector('.nav-scroll');
        const ask = document.querySelector('[aria-label="Ask Q1"]');
        if (!item || !scroller || !ask) return false;
        const ib = item.getBoundingClientRect();
        const sb = scroller.getBoundingClientRect();
        const qb = ask.getBoundingClientRect();
        const inside = ib.top >= sb.top - 1 && ib.bottom <= sb.bottom + 1 && ib.height >= 40;
        const clear = ib.bottom <= qb.top + 1 || ib.top >= qb.bottom - 1;
        return inside && clear && qb.height >= 44;
      }, title);
      if (reached) break;
      await wheel(page, '.nav-scroll', 0, 180);
    }
    assert.equal(reached, true, title + ' is not reachable in the nav');
  }
  const overlap = await page.evaluate(() => {
    const ask = document.querySelector('[aria-label="Ask Q1"]').getBoundingClientRect();
    return [...document.querySelectorAll('.nav-item')].some(item => {
      const ib = item.getBoundingClientRect();
      if (ib.bottom < 0 || ib.top > innerHeight) return false;
      return ib.bottom > ask.top + 1 && ib.top < ask.bottom - 1;
    });
  });
  assert.equal(overlap, false, 'Ask Q1 overlaps a nav item');
}

async function wheel(page, selector, dx, dy) {
  const loc = page.locator(selector).first();
  const box = await loc.boundingBox();
  assert.ok(box && box.height > 20, selector + ' has no box');
  await page.mouse.move(box.x + Math.min(24, box.width / 2), box.y + Math.min(36, box.height / 2));
  await page.mouse.wheel(dx, dy);
  await page.waitForTimeout(180);
}

test('lists scroll with the wheel, the bento fits, and Ask Q1 is visible', { skip: pw ? false : 'playwright not resolvable', timeout: 300000 }, async () => {
  await withMockApi(async api => {
    seedBook(api);
    const browser = await pw.chromium.launch();
    try {
      const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await wide.addInitScript(({ origin, key }) => {
        localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
        localStorage.setItem('ledjaa.theme.v3', 'dark');
      }, { origin: api.origin, key: LEDGER_KEY });
      await boot(wide, api.origin);
      const fit = await wide.evaluate(() => {
        const bento = document.querySelector('.bento');
        const stage = document.querySelector('.ledger-stage');
        const q = document.querySelector('[aria-label="Ask Q1"]').getBoundingClientRect();
        const order = [...bento.children].map(el => el.className);
        return {
          doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          stage: stage.scrollHeight - stage.clientHeight,
          bento: bento.scrollHeight - bento.clientHeight,
          tiles: bento.children.length,
          order,
          qTop: q.top, qBottom: q.bottom, qh: q.height,
          legacy: document.querySelector('.home-grid'),
          news: /MARKET NEWS/.test(document.body.innerText),
          hero: /book outstanding/i.test(document.body.innerText)
        };
      });
      assert.equal(fit.tiles, 5);
      assert.ok(fit.order[0].includes('bento-hero'));
      assert.equal(fit.legacy, null);
      assert.equal(fit.news, false);
      assert.equal(fit.hero, true);
      assert.ok(fit.doc <= 1, 'document scrolls ' + fit.doc);
      assert.ok(fit.stage <= 1, 'stage scrolls ' + fit.stage);
      assert.ok(fit.bento <= 2, 'bento scrolls ' + fit.bento);
      assert.ok(fit.qTop >= 0 && fit.qBottom <= 800 && fit.qh >= 44, JSON.stringify(fit));
      await assertNavReachable(wide);
      await wide.locator('.bento-apps').first().dispatchEvent('click');
      await pageWaitFor(wide, () => /Approve →/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await wide.close();

      for (const width of [320, 375, 768, 1024, 1280, 1440]) {
        const height = width <= 375 ? 812 : width >= 1440 ? 800 : 680;
        const page = await browser.newPage({ viewport: { width, height } });
        await page.addInitScript(({ origin, key }) => {
          localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
          localStorage.setItem('ledjaa.theme.v3', 'light');
        }, { origin: api.origin, key: LEDGER_KEY });
        await boot(page, api.origin);
        if (width === 375) {
          const before = await page.locator('.bento').evaluate(el => el.scrollTop);
          const can = await page.locator('.bento').evaluate(el => el.scrollHeight > el.clientHeight + 8);
          assert.equal(can, true, 'dashboard stack does not scroll at 375');
          await wheel(page, '.bento', 0, 280);
          const after = await page.locator('.bento').evaluate(el => el.scrollTop);
          assert.ok(after > before, 'dashboard wheel at 375');
          const stacked = await page.evaluate(() => ['bento-hero', 'bento-apps', 'bento-over', 'bento-due', 'bento-chart'].map(cls => document.querySelector('.' + cls).getBoundingClientRect().top));
          for (let i = 1; i < stacked.length; i++) assert.ok(stacked[i] + 1 >= stacked[i - 1], '375 order ' + stacked.join(','));
          await assertNavReachable(page);
          const scrim = page.locator('.ledger-scrim');
          if (await scrim.count()) await scrim.first().dispatchEvent('click');
          await page.waitForTimeout(200);
        }

        await clickTitle(page, 'Loans');
        await pageWaitFor(page, () => !!document.querySelector('.book-scroll'), null, { timeoutMs: 8000 });
        if (width === 320) {
          const fit320 = await page.evaluate(() => {
            const btn = document.querySelector('[aria-label="New loan"]');
            const bb = btn ? btn.getBoundingClientRect() : null;
            const scroller = document.querySelector('.book-scroll');
            const sb = scroller ? scroller.getBoundingClientRect() : null;
            const card = [...document.querySelectorAll('.book-line:not(.book-head)')].find(row => {
              const b = row.getBoundingClientRect();
              if (!sb) return false;
              return b.top >= sb.top - 1 && b.bottom <= sb.bottom + 1 && b.left >= -1 && b.right <= window.innerWidth + 1 && b.height > 40 && b.width > 40;
            });
            return {
              btn: bb && { left: bb.left, right: bb.right, top: bb.top, bottom: bb.bottom, w: window.innerWidth, h: window.innerHeight },
              card: !!card
            };
          });
          assert.ok(fit320.btn && fit320.btn.left >= -1 && fit320.btn.right <= fit320.btn.w + 1 && fit320.btn.top >= -1 && fit320.btn.bottom <= fit320.btn.h + 1, 'New loan is off screen ' + JSON.stringify(fit320.btn));
          assert.equal(fit320.card, true, 'no whole loan card at 320');
        }
        const loanOverflow = await page.locator('.book-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 8);
        assert.equal(loanOverflow, true, width + ' loans do not overflow');
        const top0 = await page.locator('.book-scroll').evaluate(el => el.scrollTop);
        await wheel(page, '.book-scroll', 0, 300);
        const top1 = await page.locator('.book-scroll').evaluate(el => el.scrollTop);
        assert.ok(top1 > top0, width + ' loans wheel ' + top0 + '->' + top1);
        const overlap = await page.evaluate(() => {
          const pager = document.querySelector('.pager');
          const scroller = document.querySelector('.book-scroll');
          if (!pager || !scroller) return false;
          const pb = pager.getBoundingClientRect();
          const sb = scroller.getBoundingClientRect();
          if (sb.bottom > pb.top + 2) return true;
          return [...document.querySelectorAll('.book-line:not(.book-head)')].some(row => {
            const b = row.getBoundingClientRect();
            const top = Math.max(b.top, sb.top);
            const bottom = Math.min(b.bottom, sb.bottom);
            if (bottom <= top) return false;
            return bottom > pb.top + 2 && top < pb.bottom - 2;
          });
        });
        assert.equal(overlap, false, width + ' pager overlaps a loan row');
        if (width === 768) {
          const wideBook = await page.locator('.book-scroll').evaluate(el => ({ sw: el.scrollWidth, cw: el.clientWidth, left: el.scrollLeft }));
          assert.ok(wideBook.sw > wideBook.cw + 8, 'loans are not horizontally scrollable at 768 ' + JSON.stringify(wideBook));
          await wheel(page, '.book-scroll', 240, 0);
          const left = await page.locator('.book-scroll').evaluate(el => el.scrollLeft);
          assert.ok(left > wideBook.left, 'horizontal wheel at 768 ' + left);
        }
        await clickTitle(page, 'Applications');
        await pageWaitFor(page, () => /Approve →/.test(document.body.innerText), null, { timeoutMs: 8000 });
        await page.locator('div').filter({ hasText: /^✕$/ }).last().dispatchEvent('click');
        await pageWaitFor(page, (sel) => !!document.querySelector(sel) && !/Approve →/.test(document.body.innerText), APP_SCROLL, { timeoutMs: 8000 });
        const appCan = await page.locator(APP_SCROLL).evaluate(el => el.scrollHeight > el.clientHeight + 8);
        assert.equal(appCan, true, width + ' applications do not overflow');
        const a0 = await page.locator(APP_SCROLL).evaluate(el => el.scrollTop);
        await wheel(page, APP_SCROLL, 0, 280);
        const a1 = await page.locator(APP_SCROLL).evaluate(el => el.scrollTop);
        assert.ok(a1 > a0, width + ' applications wheel');

        await clickTitle(page, 'Clients');
        await pageWaitFor(page, () => !!document.querySelector('[data-screen-label="Clients"] .list-scroll'), null, { timeoutMs: 8000 });
        const cCan = await page.locator('[data-screen-label="Clients"] .list-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 8);
        assert.equal(cCan, true, width + ' clients do not overflow');
        const c0 = await page.locator('[data-screen-label="Clients"] .list-scroll').evaluate(el => el.scrollTop);
        await wheel(page, '[data-screen-label="Clients"] .list-scroll', 0, 280);
        const c1 = await page.locator('[data-screen-label="Clients"] .list-scroll').evaluate(el => el.scrollTop);
        assert.ok(c1 > c0, width + ' clients wheel');

        await clickTitle(page, 'Dashboard');
        await page.waitForTimeout(200);
        const over = page.locator('.bento-over').first();
        await over.dispatchEvent('click');
        await pageWaitFor(page, () => /COLLECTIONS|OVERDUE/.test(document.body.innerText) && !!document.querySelector('.book-scroll'), null, { timeoutMs: 8000 });
        const kCan = await page.locator('.book-scroll').evaluate(el => el.scrollHeight > el.clientHeight + 8);
        assert.equal(kCan, true, width + ' collections do not overflow');
        const k0 = await page.locator('.book-scroll').evaluate(el => el.scrollTop);
        await wheel(page, '.book-scroll', 0, 280);
        const k1 = await page.locator('.book-scroll').evaluate(el => el.scrollTop);
        assert.ok(k1 > k0, width + ' collections wheel');
        if (width <= 375) {
          const tabs = await page.evaluate(() => {
            const bar = document.querySelector('[aria-label="Loan status"]');
            const boxes = [...bar.querySelectorAll('[role="tab"]')].map(t => t.getBoundingClientRect());
            return { n: boxes.length, off: boxes.some(t => t.right > innerWidth + 1 || t.left < -1), swipe: bar.scrollWidth > bar.clientWidth + 8 };
          });
          assert.ok(tabs.n >= 4, 'status tabs ' + tabs.n);
          assert.equal(tabs.off, false, 'a status tab is off screen');
          assert.equal(tabs.swipe, false, 'status tabs still swipe');
        }
        if (width === 1280) {
          await clickTitle(page, 'Markets');
          await pageWaitFor(page, () => /MARKET NEWS/.test(document.body.innerText), null, { timeoutMs: 8000 });
          await clickTitle(page, 'Collections');
          await pageWaitFor(page, () => /EXPECTED RETURN/.test(document.body.innerText) && /ARRANGE/.test(document.body.innerText), null, { timeoutMs: 8000 });
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  });
});
