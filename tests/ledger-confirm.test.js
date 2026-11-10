// Revoke and reset must ask first. Cancel sends nothing; Confirm sends the existing POST once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_KEY, loadPlaywright, withMockApi, pageWaitFor } from './_boot-helpers.js';

const pw = loadPlaywright();

const INVITED = {
  ready: true, access: 'invited', hasPin: false, accessLabel: 'Invited',
  expiresAt: '2026-11-20T00:00:00.000Z', inviteId: 'qi_open',
  invites: [{ id: 'qi_open', state: 'open', expiresAt: '2026-11-20T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' }]
};
const PIN = {
  ready: true, access: 'pin', hasPin: true, accessLabel: 'PIN set',
  expiresAt: null, inviteId: null,
  invites: [{ id: 'qi_pin', state: 'redeemed', expiresAt: null, createdAt: '2026-11-01T00:00:00.000Z' }]
};

async function boot(page, origin) {
  await page.addInitScript(({ origin, key }) => {
    localStorage.setItem('ledjaa.theme.v3', 'dark');
    localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: origin + '/api/ledger', key, table: 'ledger_book', bookId: 'main', connected: false }));
    const d = new Date();
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    sessionStorage.setItem('ledjaaBriefSeen', d.getDate() + ' ' + MN[d.getMonth()] + ' ' + d.getFullYear());
  }, { origin, key: LEDGER_KEY });
  await page.goto(origin + '/ledger/', { waitUntil: 'domcontentloaded' });
  await pageWaitFor(page, () => !document.getElementById('ledger-gate') && /Test Client/.test(document.body.innerText), null, { timeoutMs: 20000 });
  const ack = page.getByText('Acknowledge all', { exact: true });
  if (await ack.count()) await ack.first().dispatchEvent('click');
}

async function openAccess(page) {
  await page.locator('[title="Access"]').first().dispatchEvent('click');
  await pageWaitFor(page, () => /Invite/.test(document.body.innerText), null, { timeoutMs: 8000 });
}

test('cancel sends no revoke or reset, and confirm sends each post once', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [];
    page.on('request', req => {
      if (req.method() !== 'POST') return;
      if (/quik1-invites\/revoke-access|quik1-devices\/reset/.test(req.url())) calls.push(req.url());
    });
    await page.route('**/api/ledger/features', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ demoReset: false, borrowerPinLive: true })
    }));
    let invite = INVITED;
    await page.route('**/api/ledger/quik1-invites/**', route => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invite) });
    });
    try {
      await boot(page, api.origin);
      await openAccess(page);
      await page.getByText('Revoke invite', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /Revoke Quik1 access\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.getByText('Cancel', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => !/Revoke Quik1 access\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.waitForTimeout(300);
      assert.equal(calls.length, 0);

      await page.getByText('Revoke invite', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /Revoke Quik1 access\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.locator('[data-confirm-ok]').dispatchEvent('click');
      await page.locator('[data-confirm-ok]').dispatchEvent('click').catch(() => {});
      await pageWaitFor(page, () => !/Revoke Quik1 access\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      assert.equal(calls.filter(u => u.includes('revoke-access')).length, 1);

      invite = PIN;
      await page.reload({ waitUntil: 'domcontentloaded' });
      await pageWaitFor(page, () => !document.getElementById('ledger-gate'), null, { timeoutMs: 20000 });
      const ack = page.getByText('Acknowledge all', { exact: true });
      if (await ack.count()) await ack.first().dispatchEvent('click');
      await openAccess(page);
      await page.getByText('Reset device', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /Reset this client's device\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.locator('[data-q1-confirm]').dispatchEvent('click');
      await pageWaitFor(page, () => !/Reset this client's device\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      assert.equal(calls.filter(u => u.includes('quik1-devices/reset')).length, 0);

      await page.getByText('Reset device', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /Reset this client's device\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.locator('[data-confirm-ok]').dispatchEvent('click');
      await pageWaitFor(page, () => !/Reset this client's device\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      assert.equal(calls.filter(u => u.includes('quik1-devices/reset')).length, 1);
    } finally {
      await browser.close();
    }
  });
});
