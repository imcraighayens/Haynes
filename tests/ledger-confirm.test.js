// Revoke and reset must ask first. Cancel sends nothing; Confirm sends the existing POST once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEDGER_KEY, loadPlaywright, withMockApi, pageWaitFor } from './_boot-helpers.js';
import { QUIK1_PIN_LENGTH } from '../shared/pin-length.js';

const PIN_HINT = QUIK1_PIN_LENGTH + ' digits';
const SAMPLE_PIN = '24680';

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

test('confirm and cancel stay disabled for a delayed request, then the dialog closes', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [];
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().includes('revoke-access')) calls.push(req.url());
    });
    await page.route('**/api/ledger/features', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ demoReset: false, borrowerPinLive: true })
    }));
    await page.route('**/api/ledger/quik1-invites/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INVITED) });
    });
    await page.route('**/api/ledger/quik1-invites/revoke-access', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise(r => setTimeout(r, 1200));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true, access: 'none' }) });
    });
    try {
      await boot(page, api.origin);
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-ZA');
      await openAccess(page);
      await page.getByText('Revoke invite', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => !!document.querySelector('[data-confirm-ok]'), null, { timeoutMs: 8000 });
      const before = await page.evaluate(() => {
        const ok = document.querySelector('[data-confirm-ok]');
        const cancel = document.querySelector('[data-confirm-cancel]');
        return ok.disabled || cancel.disabled;
      });
      assert.equal(before, false);
      await page.locator('[data-confirm-ok]').dispatchEvent('click');
      await page.waitForFunction(() => {
        const ok = document.querySelector('[data-confirm-ok]');
        const cancel = document.querySelector('[data-confirm-cancel]');
        if (!ok || !cancel) return false;
        return ok.disabled && cancel.disabled
          && ok.getAttribute('aria-disabled') === 'true' && cancel.getAttribute('aria-disabled') === 'true'
          && ok.getAttribute('aria-busy') === 'true' && cancel.getAttribute('aria-busy') === 'true';
      }, null, { timeout: 1000 });
      await page.locator('[data-confirm-ok]').dispatchEvent('click');
      await page.locator('[data-confirm-cancel]').dispatchEvent('click');
      assert.equal(await page.locator('[data-q1-confirm]').count(), 1);
      assert.equal(calls.length, 1);
      await pageWaitFor(page, () => !document.querySelector('[data-q1-confirm]'), null, { timeoutMs: 8000 });
      assert.equal(calls.length, 1);

      await page.locator('[title="Clients"]').first().dispatchEvent('click');
      await pageWaitFor(page, () => /on the book/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.locator('[data-screen-label="Clients"]').getByText('Test Client One', { exact: true }).first().dispatchEvent('click');
      await page.getByText('Open full workspace', { exact: true }).dispatchEvent('click');
      await pageWaitFor(page, () => /Back to clients/.test(document.body.innerText) && /Revoke invite/.test(document.body.innerText), null, { timeoutMs: 8000 });
      const posts = calls.length;
      await page.getByText('Revoke invite', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /Revoke Quik1 access\?/.test(document.body.innerText), null, { timeoutMs: 8000 });
      await page.locator('[data-confirm-cancel]').dispatchEvent('click');
      await pageWaitFor(page, () => !document.querySelector('[data-q1-confirm]'), null, { timeoutMs: 8000 });
      await page.waitForTimeout(400);
      assert.equal(calls.length, posts);
      await page.getByText('Revoke invite', { exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => !!document.querySelector('[data-confirm-ok]'), null, { timeoutMs: 8000 });
      await page.locator('[data-confirm-ok]').dispatchEvent('click');
      await pageWaitFor(page, () => !document.querySelector('[data-q1-confirm]'), null, { timeoutMs: 8000 });
      assert.equal(calls.length, posts + 1);
    } finally {
      await browser.close();
    }
  });
});

test('gate-off invite controls render disabled, including reset', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/ledger/features', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ demoReset: false })
    }));
    await page.route('**/api/ledger/quik1-invites/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PIN) });
    });
    try {
      await boot(page, api.origin);
      assert.equal(await page.evaluate(() => document.documentElement.lang), 'en-ZA');
      await pageWaitFor(page, () => [...document.querySelectorAll('button')].some(b => /Invites off until launch/.test(b.textContent) && b.disabled), null, { timeoutMs: 8000 });
      const held = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(b => /Invites off until launch/.test(b.textContent));
        return buttons.length > 0 && buttons.every(b => b.disabled && b.getAttribute('aria-disabled') === 'true' && b.getAttribute('aria-describedby') === 'q1-gate-note-global');
      });
      assert.equal(held, true);
      await page.locator('[title="Clients"]').first().dispatchEvent('click');
      await pageWaitFor(page, () => /Invites off until launch/.test(document.body.innerText), null, { timeoutMs: 8000 });
      const rows = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Invites off until launch');
        return buttons.length > 0 && buttons.every(b => b.disabled && b.getAttribute('aria-disabled') === 'true' && !!b.getAttribute('aria-describedby'));
      });
      assert.equal(rows, true);
      await openAccess(page);
      await pageWaitFor(page, () => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Reset device'), null, { timeoutMs: 8000 });
      const access = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')].filter(b => /Give Quik1 access|Reset device|Set login PIN/.test(b.textContent.trim()));
        const note = document.getElementById('q1-gate-note');
        const pin = [...document.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Set login PIN');
        return buttons.length > 0 && buttons.every(b => b.disabled && b.getAttribute('aria-disabled') === 'true' && !!b.getAttribute('aria-describedby'))
          && !!note && pin.length > 0 && pin.every(b => b.getAttribute('aria-describedby') === 'q1-gate-note' && note.id === 'q1-gate-note');
      });
      assert.equal(access, true);
      await page.getByText('Reset device', { exact: true }).first().dispatchEvent('click');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('[data-q1-confirm]').count(), 0);
      await page.locator('[title="Clients"]').first().dispatchEvent('click');
      await page.locator('[data-screen-label="Clients"]').getByText('Test Client One', { exact: true }).first().dispatchEvent('click');
      await page.getByText('Open full workspace', { exact: true }).dispatchEvent('click');
      await pageWaitFor(page, () => {
        const reset = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Reset device');
        const pin = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Set login PIN');
        return !!reset && reset.disabled && reset.getAttribute('aria-disabled') === 'true' && reset.getAttribute('aria-describedby') === 'q1-gate-note-global'
          && !!pin && pin.disabled && pin.getAttribute('aria-disabled') === 'true' && pin.getAttribute('aria-describedby') === 'q1-gate-note-global';
      }, null, { timeoutMs: 8000 });
      await page.getByText('Reset device', { exact: true }).first().dispatchEvent('click');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('[data-q1-confirm]').count(), 0);
      const opened = await page.evaluate(() => {
        const nodes = document.querySelectorAll('*');
        for (const el of nodes) {
          const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          if (!key) continue;
          let f = el[key];
          for (let i = 0; i < 40 && f; i++) {
            const inst = f.stateNode;
            const logic = inst && (inst.logic || inst);
            if (logic && typeof logic.openQuik1Invite === 'function' && logic.state && logic.state.clients && logic.state.clients[0]) {
              logic.openQuik1Invite(logic.state.clients[0].id);
              return true;
            }
            f = f.return;
          }
        }
        return false;
      });
      assert.equal(opened, true);
      await pageWaitFor(page, () => [...document.querySelectorAll('button')].some(b => b.getAttribute('aria-describedby') === 'q1-dialog-gate' && b.textContent.trim() === 'Set login PIN'), null, { timeoutMs: 8000 });
      const dialog = await page.evaluate(() => {
        const note = document.getElementById('q1-dialog-gate');
        const buttons = [...document.querySelectorAll('button')].filter(b => b.getAttribute('aria-describedby') === 'q1-dialog-gate');
        const pin = buttons.find(b => b.textContent.trim() === 'Set login PIN');
        return !!note && buttons.length >= 3 && buttons.every(b => b.disabled && b.getAttribute('aria-disabled') === 'true')
          && !!pin && pin.getAttribute('aria-describedby') === note.id;
      });
      assert.equal(dialog, true);
    } finally {
      await browser.close();
    }
  });
});

test('two clicks on Set login PIN send one request, then the button is ready again', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [];
    page.on('request', req => {
      if (req.method() === 'POST' && req.url().includes('/quik1-temp-pin')) calls.push(req.url());
    });
    await page.route('**/api/ledger/features', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ demoReset: false, borrowerPin: true, borrowerPinLive: true })
    }));
    await page.route('**/api/ledger/quik1-invites/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PIN) });
    });
    await page.route('**/api/ledger/quik1-temp-pin', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise(r => setTimeout(r, 1200));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, pinStatus: 'Active' })
      });
    });
    try {
      await boot(page, api.origin);
      await openAccess(page);
      await page.getByRole('button', { name: 'Set login PIN', exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, () => /signs the borrower out of every phone/.test(document.body.innerText)
        && /removes Face ID and passkeys/.test(document.body.innerText)
        && !/expires after 72 hours/.test(document.body.innerText), null, { timeoutMs: 8000 });
      const idle = await page.evaluate(() => {
        const button = document.querySelector('[data-temp-pin-submit]');
        return !!button && !button.disabled
          && button.getAttribute('aria-disabled') === 'false'
          && button.getAttribute('aria-busy') === 'false';
      });
      assert.equal(idle, true);
      await page.locator('[data-temp-pin-submit]').dispatchEvent('click');
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-temp-pin-submit]');
        return !!button && button.disabled
          && button.getAttribute('aria-disabled') === 'true'
          && button.getAttribute('aria-busy') === 'true';
      }, null, { timeout: 1000 });
      await page.locator('[data-temp-pin-submit]').dispatchEvent('click');
      await page.waitForFunction(() => {
        const button = document.querySelector('[data-temp-pin-submit]');
        return !!button && !button.disabled
          && button.getAttribute('aria-disabled') === 'false'
          && button.getAttribute('aria-busy') === 'false';
      }, null, { timeout: 8000 });
      assert.equal(calls.length, 1);
    } finally {
      await browser.close();
    }
  });
});

test('a login PIN left in the dialog is gone after close, Esc, and a successful set', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  await withMockApi(async api => {
    const browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/ledger/features', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ demoReset: false, borrowerPinLive: true })
    }));
    await page.route('**/api/ledger/quik1-invites/**', route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PIN) });
    });
    await page.route('**/api/ledger/quik1-temp-pin', route => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, pinStatus: 'Active' })
      });
    });
    const fields = () => page.evaluate((hint) => {
      const pin = document.querySelector('input[placeholder="' + hint + '"]');
      const confirm = document.querySelector('input[placeholder="Confirm"]');
      return { pin: pin ? pin.value : null, confirm: confirm ? confirm.value : null };
    }, PIN_HINT);
    const openDialog = async () => {
      await page.getByRole('button', { name: 'Set login PIN', exact: true }).first().dispatchEvent('click');
      await pageWaitFor(page, (hint) => !!document.querySelector('input[placeholder="' + hint + '"]'), PIN_HINT, { timeoutMs: 8000 });
    };
    const typePins = async () => {
      await page.locator('input[placeholder="' + PIN_HINT + '"]').fill(SAMPLE_PIN);
      await page.locator('input[placeholder="Confirm"]').fill(SAMPLE_PIN);
      await pageWaitFor(page, ({ hint, sample }) => {
        const pin = document.querySelector('input[placeholder="' + hint + '"]');
        const confirm = document.querySelector('input[placeholder="Confirm"]');
        return pin && pin.value === sample && confirm && confirm.value === sample;
      }, { hint: PIN_HINT, sample: SAMPLE_PIN }, { timeoutMs: 8000 });
    };
    try {
      await boot(page, api.origin);
      await openAccess(page);
      await openDialog();
      await typePins();
      await page.keyboard.press('Escape');
      await pageWaitFor(page, (hint) => !document.querySelector('input[placeholder="' + hint + '"]'), PIN_HINT, { timeoutMs: 8000 });
      await openDialog();
      assert.deepEqual(await fields(), { pin: '', confirm: '' });

      await typePins();
      await page.evaluate(() => {
        const title = [...document.querySelectorAll('div')].find(el => el.textContent.trim() === 'QUIK1 ACCESS');
        const close = title && title.parentElement && [...title.parentElement.children].find(el => el.textContent.trim() === '✕');
        if (close) close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await pageWaitFor(page, (hint) => !document.querySelector('input[placeholder="' + hint + '"]'), PIN_HINT, { timeoutMs: 8000 });
      await openDialog();
      assert.deepEqual(await fields(), { pin: '', confirm: '' });

      await typePins();
      await page.locator('[data-temp-pin-submit]').dispatchEvent('click');
      await pageWaitFor(page, (hint) => {
        const pin = document.querySelector('input[placeholder="' + hint + '"]');
        const confirm = document.querySelector('input[placeholder="Confirm"]');
        return pin && pin.value === '' && confirm && confirm.value === '' && /Login PIN set/.test(document.body.innerText);
      }, PIN_HINT, { timeoutMs: 8000 });
      await page.keyboard.press('Escape');
      await pageWaitFor(page, (hint) => !document.querySelector('input[placeholder="' + hint + '"]'), PIN_HINT, { timeoutMs: 8000 });
      await openDialog();
      assert.deepEqual(await fields(), { pin: '', confirm: '' });
    } finally {
      await browser.close();
    }
  });
});
