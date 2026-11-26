// Short phones scroll the login column. Headings and "New here? Sign up" stay
// reachable, and sign-up plus the estimate scroll clear of the dock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, pageWaitFor } from './_boot-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
const pw = loadPlaywright();

test('the login column scrolls and keeps the design spacing', () => {
  assert.match(quik, /class="q-login" style="[^"]*overflow-y:auto/);
  assert.equal(/class="q-login" style="[^"]*overflow:hidden/.test(quik), false);
  assert.match(quik, /width:96px;height:auto;display:block;margin-bottom:16px/);
  assert.match(quik, /font-size:36px;font-weight:500;line-height:1\.08;letter-spacing:-\.035em;text-wrap:balance">\{\{ loginHead \}\}/);
  assert.match(quik, /Are you short before payday/);
  assert.match(quik, /label:'Face ID'/);
  assert.match(quik, /label:'PIN'/);
  assert.match(quik, /label:'Sign in'/);
  assert.match(quik, /label:'Sign up'/);
  assert.match(quik, /Invite code/);
  assert.equal(quik.includes('>Email me a link<'), false);
});

function startHost() {
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ enabled: false, ready: false, emailSignIn: false }));
    }
    if (urlPath.includes('..')) { res.writeHead(403); return res.end('forbidden'); }
    let rel = urlPath === '/' ? 'quik1/index.html' : urlPath.replace(/^\//, '');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(root, rel);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    const ext = file.split('.').pop().toLowerCase();
    res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: 'http://127.0.0.1:' + server.address().port }));
  });
}

function showPhase(arg) {
  const root = document.getElementById('dc-root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  const stack = [root[key]];
  const seen = new Set();
  let logic = null;
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const sn = node.stateNode;
    if (sn && sn.logic && sn.logic.state && 'screen' in sn.logic.state) logic = sn.logic;
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  if (!logic) return false;
  clearInterval(logic._splash);
  clearInterval(logic._menuIconT);
  clearTimeout(logic._botT);
  clearInterval(logic._hovT);
  const base = {
    splashDone: true, guest: false, inviteCode: '', otp: '', pinNote: '',
    liId: '', liPhone: '', pinBusy: false, smsChallenge: false, loginIntro: false,
    screen: arg.screen || 'login', loginMode: arg.loginMode || 'pin', pinPhase: arg.pinPhase || 'sign',
    otpMode: arg.pinPhase !== 'idpin'
  };
  if (arg.screen === 'signup') {
    base.su = { step: arg.step || 1, employment: 'Permanent', payday: '25th', name: 'Test Person' };
    base.suTried = false;
  }
  if (arg.screen === 'estimate') base.screen = 'estimate';
  logic.setState(base);
  return true;
}

function place(label) {
  const dock = document.querySelector('.q-dock');
  const dockTop = dock ? dock.getBoundingClientRect().top : window.innerHeight;
  const nodes = [...document.querySelectorAll('h1,h2,button,input')];
  const node = nodes.find((el) => {
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
    return text === label || text.startsWith(label);
  });
  if (!node) return { missing: true, label };
  const scroller = node.closest('.q-login, [data-q-signup-scroll], [data-q-safe-header="estimate"]') || document.scrollingElement;
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  const box = node.getBoundingClientRect();
  const x = Math.min(window.innerWidth - 2, Math.max(2, box.left + Math.min(24, box.width / 2)));
  const y = Math.min(dockTop - 2, Math.max(2, box.top + box.height / 2));
  const hit = document.elementFromPoint(x, y);
  const clickable = !!(hit && (hit === node || node.contains(hit) || (node.closest && node.closest('button') === hit.closest && hit.closest('button'))));
  const fully = box.top >= -1 && box.bottom <= dockTop + 1 && box.bottom <= window.innerHeight + 1;
  return {
    label,
    top: box.top,
    bottom: box.bottom,
    dockTop,
    fully,
    clickable,
    overflow: scroller ? getComputedStyle(scroller).overflowY : ''
  };
}

const skip = pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)';

test('login controls scroll into view and click at 320x568 and 375x812', { skip, timeout: 180000 }, async () => {
  const host = await startHost();
  const browser = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
      try {
        await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
        await pageWaitFor(page, () => !!document.querySelector('#dc-root'), null, { timeoutMs: 20000 });
        assert.equal(await page.evaluate(showPhase, { screen: 'login', pinPhase: 'sign', loginMode: 'pin' }), true);
        await pageWaitFor(page, () => /Enter your PIN/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 8000 });
        const knownHead = await page.evaluate(place, 'Enter your PIN.');
        assert.equal(knownHead.fully, true, JSON.stringify(knownHead));
        assert.equal(knownHead.overflow === 'auto' || knownHead.overflow === 'scroll' || knownHead.overflow === 'visible', true, knownHead.overflow);

        assert.equal(await page.evaluate(showPhase, { screen: 'login', pinPhase: 'idpin', loginMode: 'pin' }), true);
        await pageWaitFor(page, () => /Use ID number/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 8000 });
        const newHead = await page.evaluate(place, 'Use ID number.');
        assert.equal(newHead.fully, true, JSON.stringify(newHead));
        const signUp = await page.evaluate(place, 'New here?');
        assert.equal(signUp.missing, undefined, JSON.stringify(signUp));
        assert.equal(signUp.clickable, true, JSON.stringify(signUp));
        assert.ok(signUp.bottom <= signUp.dockTop + 1, JSON.stringify(signUp));
        await page.getByRole('button', { name: /New here/ }).click();
        await pageWaitFor(page, () => /Tell us about you/.test(document.body.innerText), null, { timeoutMs: 8000 });

        for (const step of [1, 2, 3]) {
          assert.equal(await page.evaluate(showPhase, { screen: 'signup', step }), true);
          const title = step === 1 ? 'Tell us about you' : step === 2 ? 'Your work and pay' : 'Pick a PIN';
          await pageWaitFor(page, (text) => document.body.innerText.includes(text), title, { timeoutMs: 8000 });
          const cta = await page.evaluate(place, step < 3 ? 'Continue' : 'Submit for approval');
          assert.equal(cta.clickable, true, 'step ' + step + ' ' + JSON.stringify(cta));
          assert.ok(cta.bottom <= cta.dockTop + 1, 'step ' + step + ' cta under dock ' + JSON.stringify(cta));
          if (step === 2) {
            const weekly = await page.evaluate(place, 'Weekly');
            assert.equal(weekly.clickable, true, JSON.stringify(weekly));
            assert.ok(weekly.bottom <= weekly.dockTop + 1, JSON.stringify(weekly));
          }
        }

        assert.equal(await page.evaluate(showPhase, { screen: 'estimate' }), true);
        await pageWaitFor(page, () => /Three questions/.test(document.body.innerText), null, { timeoutMs: 8000 });
        const back = await page.evaluate(place, 'Back');
        assert.equal(back.clickable, true, JSON.stringify(back));
        const earn = await page.evaluate(place, 'Permanent job');
        assert.equal(earn.clickable, true, JSON.stringify(earn));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => {
      host.server.close(resolve);
      if (host.server.closeAllConnections) host.server.closeAllConnections();
    });
  }
});
