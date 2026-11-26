// Short phones scale the login and sign-up screens. 390x844 is unchanged.
// Hit tests run at rest: nothing is scrolled into view first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, pageWaitFor } from './_boot-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pw = loadPlaywright();

const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 375, height: 667 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 430, height: 932 }
];

const screens = [
  { name: 'known-pin', state: { screen: 'login', loginMode: 'pin', pinPhase: 'sign', otpMode: true }, keys: true },
  { name: 'id-pin', state: { screen: 'login', loginMode: 'pin', pinPhase: 'idpin', otpMode: false }, keys: true },
  { name: 'new-pin', state: { screen: 'login', loginMode: 'pin', pinPhase: 'choose', otpMode: true }, keys: true },
  { name: 'sign-in', state: { screen: 'login', loginMode: 'id', pinPhase: 'sign', otpMode: false }, signin: true },
  { name: 'signup-1', state: { screen: 'signup', su: { step: 1, employment: 'Permanent', payday: '25th' } }, signup: 1 },
  { name: 'signup-2', state: { screen: 'signup', su: { step: 2, employment: 'Permanent', payday: '25th' } }, signup: 2 },
  { name: 'signup-3', state: { screen: 'signup', su: { step: 3, employment: 'Permanent', payday: '25th' } }, signup: 3 }
];

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

function showScreen(state) {
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
  logic.setState(Object.assign({
    splashDone: true, guest: false, inviteCode: '', otp: '', pinNote: '',
    smsChallenge: false, aiOpen: false, menuOpen: false, loginIntro: false
  }, state));
  return true;
}

function atRest() {
  const frame = document.querySelector('.q-frame') || document.documentElement;
  const nodes = [...document.querySelectorAll('.q-keys button, .q-signin button, .q-signin input, .q-signup button, .q-signup input, .q-su-cta button')];
  const bad = [];
  let minTap = 999;
  for (const el of nodes) {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || parseFloat(style.opacity) < 0.05) continue;
    if (box.width < 4 || box.height < 4) continue;
    const label = ((el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName) + '').replace(/\s+/g, ' ').trim().slice(0, 36);
    const form = el.closest('[data-q-signup-scroll]');
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const formBox = form ? form.getBoundingClientRect() : null;
    const inVisibleForm = !!(formBox && y >= formBox.top + 1 && y <= formBox.bottom - 1 && x >= formBox.left && x <= formBox.right);
    const onScreen = y >= 1 && y <= window.innerHeight - 1 && x >= 1 && x <= window.innerWidth - 1;
    if (!onScreen || (form && !inVisibleForm)) {
      if (!form) bad.push(label + ' offscreen');
      continue;
    }
    const hit = document.elementFromPoint(x, y);
    if (!(hit && (hit === el || el.contains(hit)))) {
      bad.push(label + ' missed');
      continue;
    }
    const floor = window.innerHeight <= 820 || el.closest('.q-keys');
    if ((el.tagName === 'BUTTON' || el.tagName === 'INPUT') && box.height < minTap) minTap = box.height;
    if (floor && (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && box.height < 44) bad.push(label + ' ' + Math.round(box.height) + 'px');
  }
  const scroll = document.querySelector('[data-q-signup-scroll]');
  const cta = document.querySelector('.q-su-cta button');
  let ctaHit = true;
  if (cta) {
    const box = cta.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    ctaHit = !!(hit && (hit === cta || cta.contains(hit))) && box.bottom <= window.innerHeight + 0.5 && box.top >= 0;
  }
  const key = document.querySelector('.q-keys button');
  return {
    bad: bad.slice(0, 8),
    overflowX: frame.scrollWidth > frame.clientWidth + 1,
    formOverflow: scroll ? Math.round(scroll.scrollHeight - scroll.clientHeight) : 0,
    ctaHit,
    keyH: key ? Math.round(key.getBoundingClientRect().height) : 0,
    minTap: minTap === 999 ? 0 : Math.round(minTap)
  };
}

const skip = pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)';

test('login and sign-up controls are tappable at rest on phone sizes', { skip, timeout: 240000 }, async () => {
  const host = await startHost();
  const browser = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const shortfalls = [];
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
      try {
        await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
        await pageWaitFor(page, () => !!document.querySelector('#dc-root'), null, { timeoutMs: 20000 });
        for (const screen of screens) {
          assert.equal(await page.evaluate(showScreen, screen.state), true, screen.name);
          await page.waitForTimeout(500);
          const result = await page.evaluate(atRest);
          assert.equal(result.overflowX, false, screen.name + ' scrolls sideways at ' + viewport.width);
          assert.deepEqual(result.bad, [], screen.name + ' at ' + viewport.width + 'x' + viewport.height + ' ' + JSON.stringify(result.bad));
          if (screen.signup) {
            assert.equal(result.ctaHit, true, 'Continue is covered on step ' + screen.signup);
            if (result.formOverflow > 2) {
              shortfalls.push({ step: screen.signup, viewport: viewport.width + 'x' + viewport.height, px: result.formOverflow });
            }
          }
          if (screen.keys && viewport.width === 320 && viewport.height === 568) {
            assert.ok(result.keyH >= 44, 'key ' + result.keyH);
            console.log('KEY_320 ' + result.keyH);
          }
          if (viewport.width === 390 && viewport.height === 844 && screen.keys) {
            assert.equal(result.keyH, 52, '390 key size changed');
          }
        }
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
  if (shortfalls.length) console.log('SIGNUP_SCROLL ' + JSON.stringify(shortfalls));
});
