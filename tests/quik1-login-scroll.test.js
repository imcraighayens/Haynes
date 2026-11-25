// Login layout matches master, and every visible login control can be scrolled
// into view and clicked at phone sizes, with email sign-in off and on.
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

test('the login screen keeps master spacing and gates both email-link buttons', () => {
  assert.match(quik, /overflow-y:auto;scrollbar-width:none;position:relative;z-index:1;display:flex;flex-direction:column;gap:22px/);
  assert.match(quik, /width:96px;height:auto;display:block;margin-bottom:16px/);
  assert.match(quik, /font-size:36px;font-weight:500;line-height:1\.08;letter-spacing:-\.035em;text-wrap:balance">\{\{ loginHead \}\}/);
  assert.match(quik, /margin:8px 0 0;font-size:15px;line-height:1\.5;color:rgba\(255,255,255,\.65\);max-width:32ch/);
  assert.match(quik, /padding-bottom:128px;gap:14px;animation:q-up/);
  assert.match(quik, /padding-bottom:128px;gap:16px;animation:q-up/);
  assert.match(quik, /padding-bottom:28px;gap:16px;animation:q-up/);
  assert.match(quik, /font-size:14px;line-height:1\.45;color:#FF8A7A">\{\{ pinNote \}\}/);
  assert.match(quik, /height:52px;border-radius:14px;[^"]*font-size:19px/);
  assert.match(quik, /grid-template-columns:repeat\(3,1fr\);gap:8px/);
  assert.match(quik, /If this email is on your account, we send one link to this phone\. It expires and works once\./);
  assert.match(quik, /We match these to your loan file, then email a link\. The ID and cellphone alone do not sign you in\./);
  assert.match(quik, /pinPhase==='idpin'\s*\?\s*'Your SA ID, then your PIN\.'/);
  assert.match(quik, /showMethods:!!s\.emailSignIn&&s\.screen==='login'&&s\.pinPhase==='sign'&&!s\.inviteCode/);
  assert.match(quik, /showUseId:s\.screen==='login'&&s\.pinPhase==='sign'&&!s\.inviteCode/);
  assert.match(quik, />Use ID number</);
  assert.equal(quik.includes('overflow:hidden;scrollbar-width:none;position:relative;z-index:1;display:flex;flex-direction:column;gap:10px'), false);
});

function startHost(emailSignIn) {
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/api/quik1/webauthn') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ enabled: false, ready: false, emailSignIn }));
    }
    if (urlPath.startsWith('/api/quik1/signin/')) {
      // Hold the link request so a click cannot change phase under the next control.
      return;
    }
    if (urlPath.startsWith('/api/')) {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Sign in required' }));
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
  logic.setState({
    screen: 'login', splashDone: true, guest: false, inviteCode: '',
    otp: '', pinNote: '', liId: '', signEmail: '', liPhone: '', pinBusy: false,
    deviceRef: '', accountRefInput: '', emailSignIn: arg.emailSignIn, pinPhase: arg.pinPhase
  });
  return true;
}

function controlCount() {
  const head = document.querySelector('h1');
  let scroller = head;
  while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
  return [...scroller.querySelectorAll('button,input')].filter((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  }).length;
}

function reachControl(index) {
  const head = document.querySelector('h1');
  let scroller = head;
  while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
  const nodes = [...scroller.querySelectorAll('button,input')].filter((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  });
  const node = nodes[index];
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
  const box = node.getBoundingClientRect();
  const x = Math.min(window.innerWidth - 2, Math.max(2, box.left + Math.min(box.width / 2, 28)));
  const y = Math.min(window.innerHeight - 2, Math.max(2, box.top + box.height / 2));
  const hit = document.elementFromPoint(x, y);
  const clickable = !!(hit && (hit === node || node.contains(hit)));
  const label = (node.innerText || node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
  if (clickable) node.click();
  const shown = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
  return { label: label || '(spacer)', top: box.top, bottom: box.bottom, height: box.height, shown, clickable };
}

const skip = pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)';

test('login controls scroll into view and click at 320x568 and 375x812', { skip, timeout: 300000 }, async () => {
  const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  const viewports = [{ width: 320, height: 568 }, { width: 375, height: 812 }];
  const results = [];
  for (const emailSignIn of [false, true]) {
    const host = await startHost(emailSignIn);
    const browser = await pw.chromium.launch({
      executablePath: chrome,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({ viewport });
        const clicked = [];
        try {
          await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
          await page.waitForResponse((res) => res.url().includes('/api/quik1/webauthn'), { timeout: 20000 });
          await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
          assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase: 'sign' }), true);
          await page.getByRole('button', { name: 'Use ID number', exact: true }).waitFor({ state: 'visible' });
          assert.equal(await page.locator('[data-q-email]').count(), emailSignIn ? 1 : 0);
          assert.equal(await page.locator('[data-q-idphone]').count(), emailSignIn ? 1 : 0);
          const layout = await page.evaluate(() => {
            const head = document.querySelector('h1');
            let scroller = head;
            while (scroller && getComputedStyle(scroller).overflowY !== 'auto') scroller = scroller.parentElement;
            const img = scroller.querySelector('img[alt="Quik1"]');
            const sub = head.nextElementSibling;
            const key = [...scroller.querySelectorAll('button')].find((b) => b.textContent.trim() === '5');
            return {
              overflow: getComputedStyle(scroller).overflowY,
              gap: getComputedStyle(scroller).gap,
              logo: getComputedStyle(img).width,
              head: getComputedStyle(head).fontSize,
              subMargin: getComputedStyle(sub).marginTop,
              subSize: getComputedStyle(sub).fontSize,
              subLh: getComputedStyle(sub).lineHeight,
              subMax: sub.getAttribute('style') || '',
              key: getComputedStyle(key).height,
              grid: getComputedStyle(key.parentElement).gap
            };
          });
          assert.equal(layout.overflow, 'auto');
          assert.equal(layout.gap, '22px');
          assert.equal(layout.logo, '96px');
          assert.equal(layout.head, '36px');
          assert.equal(layout.subMargin, '8px');
          assert.equal(layout.subSize, '15px');
          assert.equal(layout.subLh, '22.5px');
          assert.match(layout.subMax, /32ch/);
          assert.equal(layout.key, '52px');
          assert.equal(layout.grid, '8px');

          if (!emailSignIn) {
            await page.getByRole('button', { name: 'Use ID number', exact: true }).click();
            await pageWaitFor(page, () => /Use ID number/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 5000 });
            await page.getByRole('button', { name: 'Back', exact: true }).click();
            await pageWaitFor(page, () => /Enter your PIN/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 5000 });
            await page.evaluate(() => {
              const key = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '1');
              key.click();
            });
            await pageWaitFor(page, () => [...document.querySelectorAll('div')].some((node) => node.childNodes.length === 1 && node.textContent === '1'), null, { timeoutMs: 5000 });
            await page.getByRole('button', { name: 'Browse the app', exact: true }).click();
            await pageWaitFor(page, () => /Browsing as guest/.test(document.body.innerText), null, { timeoutMs: 5000 });
            assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase: 'sign' }), true);
            await page.getByRole('button', { name: /Register/ }).click();
            await pageWaitFor(page, () => /Tell us about you/.test(document.body.innerText), null, { timeoutMs: 5000 });
            assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase: 'sign' }), true);
          } else {
            await page.locator('[data-q-email]').click();
            await pageWaitFor(page, () => /Email a link/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 5000 });
            await page.getByRole('button', { name: 'Use your PIN', exact: true }).click();
            await pageWaitFor(page, () => /Enter your PIN/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 5000 });
            await page.locator('[data-q-idphone]').click();
            await pageWaitFor(page, () => /ID and cellphone/.test((document.querySelector('h1') || {}).textContent || ''), null, { timeoutMs: 5000 });
            assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase: 'sign' }), true);
          }

          const phases = {
            sign: 'Enter your PIN',
            idpin: 'Use ID number',
            choose: 'Choose a PIN',
            confirm: 'Confirm your PIN',
            current: 'Enter your current PIN',
            change: 'Choose a new PIN',
            change2: 'Confirm your new PIN',
            email: 'Check your email',
            staff: 'Contact your loan officer',
            unlinked: "This phone isn't linked yet"
          };
          if (emailSignIn) {
            phases.emailin = 'Email a link';
            phases.idphone = 'ID and cellphone';
          }
          for (const [pinPhase, title] of Object.entries(phases)) {
            assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase }), true);
            await pageWaitFor(page, (text) => {
              const head = document.querySelector('h1');
              return !!(head && head.textContent.includes(text));
            }, title, { timeoutMs: 5000 });
            const total = await page.evaluate(controlCount);
            assert.ok(total > 0, pinPhase);
            for (let i = 0; i < total; i++) {
              assert.equal(await page.evaluate(showPhase, { emailSignIn, pinPhase }), true);
              await pageWaitFor(page, (text) => {
                const head = document.querySelector('h1');
                return !!(head && head.textContent.includes(text));
              }, title, { timeoutMs: 5000 });
              const info = await page.evaluate(reachControl, i);
              assert.ok(info.shown >= Math.min(info.height, 24) - 1, pinPhase + ' ' + info.label + ' is not in the ' + viewport.width + 'x' + viewport.height + ' viewport');
              assert.ok(info.clickable, pinPhase + ' ' + info.label + ' is covered at ' + viewport.width + 'x' + viewport.height);
              clicked.push({ emailSignIn, viewport: viewport.width + 'x' + viewport.height, pinPhase, label: info.label });
            }
          }
          const mine = clicked.filter((row) => row.emailSignIn === emailSignIn && row.viewport === viewport.width + 'x' + viewport.height);
          if (viewport.width === 320) {
            const byPhase = {};
            for (const row of mine) (byPhase[row.pinPhase] ||= []).push(row.label);
            console.log('SCROLL_320 ' + JSON.stringify({ emailSignIn, byPhase }));
          }
          results.push({
            emailSignIn,
            viewport: viewport.width + 'x' + viewport.height,
            controls: mine.length
          });
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
  }
  const narrow = results.find((row) => row.viewport === '320x568' && row.emailSignIn === false);
  assert.ok(narrow && narrow.controls > 0);
  console.log('LOGIN_SCROLL ' + JSON.stringify(results));
});
