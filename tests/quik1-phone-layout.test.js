// Phone layout: the Ask Q1 orb clears the home dock, the iOS hint clears the
// PIN wordmark and stays off the splash, and the chat sheet stays under the header.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, pageWaitFor } from './_boot-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'quik1/sw.js'), 'utf8');
const pw = loadPlaywright();
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PHONES = [
  { name: '320x800', width: 320, height: 800, top: 47, bottom: 34 },
  { name: '360x800', width: 360, height: 800, top: 47, bottom: 34 },
  { name: '375x812', width: 375, height: 812, top: 47, bottom: 34 },
  { name: '390x844', width: 390, height: 844, top: 47, bottom: 34 },
  { name: '430x932', width: 430, height: 932, top: 59, bottom: 34 }
];
const SHOTS = ['360x800', '375x812', '390x844', '430x932'];
const shotDir = '/opt/cursor/artifacts/quik1-phone';

function hintScript() {
  const start = quik.indexOf("var HINT_KEY = 'quik1.iosHintDismissed'");
  const end = quik.indexOf("if ('serviceWorker' in navigator)", start);
  return quik.slice(start, end);
}

test('phone layout keeps the shell contract and gates the hint on app state', () => {
  assert.match(sw, /const CACHE = 'quik1-shell-v3'/);
  assert.doesNotMatch(sw, /quik1-shell-v1/);
  assert.match(quik, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover/);
  assert.match(quik, /name="theme-color" content="#000000"/);
  assert.match(quik, /background: #000000/);
  assert.match(quik, /100lvh/);
  assert.match(quik, /class="q-dock q-home-dock" style="position:absolute;left:18px;bottom:0;z-index:45;padding-bottom:env\(safe-area-inset-bottom\)/);
  assert.match(quik, /data-q-safe-header="home"[^>]*var\(--q-safe-top/);
  assert.match(quik, /showDockMini:!!\(busy&&on\)/);
  assert.match(quik, /90741e73-54ba-4ee7-9480-fa0370bd38e4\.mp4/);
  assert.match(quik, /\.q-home-dock \{ max-width: calc\(100% - 104px\); \}/);
  assert.match(quik, /top:calc\(108px \+ var\(--q-safe-top, 0px\)\)/);
  assert.match(quik, /class="q-chat"/);
  assert.match(quik, /publishChrome\(\)/);
  assert.match(quik, /data-q-pin/);
  const hint = hintScript();
  assert.match(hint, /data-q-pin/);
  assert.doesNotMatch(hint, /innerText/);
  assert.doesNotMatch(hint, /Enter your PIN/);
  assert.match(quik, /class="q-pin-logo"/);
  assert.match(quik, /var\(--q-ios-hint, 0px\)/);
});

function startStaticHost() {
  const dir = root;
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end('{}');
    }
    const urlPath = decodeURIComponent(url.pathname);
    if (urlPath.includes('..')) { res.writeHead(403); return res.end('forbidden'); }
    let rel = urlPath === '/' ? 'quik1/index.html' : urlPath.replace(/^\//, '');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
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

async function saveShot(page, name) {
  if (!fs.existsSync('/opt/cursor/artifacts')) return;
  fs.mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: path.join(shotDir, name) });
}

async function withPhone(origin, size, fn) {
  const browser = await pw.chromium.launch();
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: true,
    hasTouch: true,
    userAgent: IOS
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: size.top, left: 0, bottom: size.bottom, right: 0 }
  });
  await page.goto(origin + '/quik1/', { waitUntil: 'load' });
  try {
    return await fn(page, session);
  } finally {
    await browser.close();
  }
}

async function setLogic(page, patch) {
  return page.evaluate((next) => {
    const host = document.getElementById('dc-root');
    const key = Object.keys(host).find((k) => k.startsWith('__reactContainer'));
    const stack = [host[key]];
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
    logic.setState(next);
    return true;
  }, patch);
}

function overlaps(a, b) {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

test('the Ask Q1 orb does not overlap the home dock from 320 to 430', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  try {
    await withPhone(host.origin, PHONES[0], async (page, session) => {
      await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
      assert.equal(await setLogic(page, { screen: 'home', splashDone: true, customer: true, aiOpen: false, quickOpen: false, gridOpen: false, menuOpen: false }), true);
      await pageWaitFor(page, () => !!document.querySelector('.q-home-dock') && !!document.querySelector('button[aria-label="Ask Q1"]'), null, { timeoutMs: 10000 });
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: '.q-home-dock, .q-home-dock * { transition: none !important; }' });
      const wide = {};
      for (const size of PHONES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.top, left: 0, bottom: size.bottom, right: 0 } });
        await page.waitForTimeout(50);
        const box = await page.evaluate(() => {
          const home = document.querySelector('.q-home-dock > div');
          const ask = document.querySelector('button[aria-label="Ask Q1"]').parentElement;
          const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
          return { home: r(home), ask: r(ask) };
        });
        assert.ok(box.home.right <= box.ask.left + 0.5, size.name + ' dock ' + box.home.right + ' overlaps orb ' + box.ask.left);
        assert.ok(box.ask.left - box.home.right >= 4, size.name + ' gap is ' + (box.ask.left - box.home.right));
        assert.ok(Math.abs(box.home.left - 18) < 1.5, size.name + ' dock left moved to ' + box.home.left);
        assert.ok(Math.abs((size.width - box.ask.right) - 18) < 1.5, size.name + ' orb right inset is ' + (size.width - box.ask.right));
        assert.ok(Math.abs(box.ask.width - 60) < 1.5, size.name + ' orb width is ' + box.ask.width);
        if (size.width >= 375) wide[size.name] = box.home.width;
        if (SHOTS.includes(size.name)) await saveShot(page, 'after-home-' + size.name + '.png');
      }
      const widths = Object.values(wide);
      for (const w of widths) assert.ok(Math.abs(w - widths[0]) < 1.5, '375 and wider home pills differ: ' + JSON.stringify(wide));
    });
  } finally {
    await new Promise((resolve) => host.server.close(resolve));
  }
});

test('the iOS hint stays off the splash and never covers the PIN logo', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  try {
    for (const size of PHONES.filter((s) => s.name === '360x800' || s.name === '375x812')) {
      await withPhone(host.origin, size, async (page) => {
        await pageWaitFor(page, () => {
          const splash = [...document.querySelectorAll('img[alt="Quik1"]')].some((img) => img.getBoundingClientRect().width > 140);
          return splash && /Enter your PIN/.test(document.body.innerText);
        }, null, { timeoutMs: 20000 });
        const duringSplash = await page.evaluate(() => ({
          hidden: document.getElementById('quik1-ios-hint').hidden,
          pin: document.documentElement.getAttribute('data-q-pin'),
          text: /Enter your PIN/.test(document.body.innerText)
        }));
        assert.equal(duringSplash.text, true);
        assert.equal(duringSplash.pin, null);
        assert.equal(duringSplash.hidden, true);
        await saveShot(page, 'after-splash-' + size.name + '.png');
      });
    }

    await withPhone(host.origin, PHONES[1], async (page, session) => {
      await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
      assert.equal(await setLogic(page, { screen: 'login', splashDone: true, pinPhase: 'sign', customer: false, aiOpen: false }), true);
      await pageWaitFor(page, () => document.documentElement.getAttribute('data-q-pin') === '1' && document.getElementById('quik1-ios-hint').hidden === false, null, { timeoutMs: 10000 });
      await page.evaluate(() => document.fonts.ready);
      for (const size of PHONES.filter((s) => s.width >= 360)) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.top, left: 0, bottom: size.bottom, right: 0 } });
        await page.waitForTimeout(120);
        const box = await page.evaluate(() => {
          const hint = document.getElementById('quik1-ios-hint');
          const logo = document.querySelector('.q-pin-logo');
          const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
          const cs = getComputedStyle(hint);
          return {
            hint: r(hint),
            logo: r(logo),
            hidden: hint.hidden,
            font: parseFloat(cs.fontSize),
            text: hint.innerText,
            clipped: hint.scrollHeight > hint.clientHeight + 2,
            safe: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--q-safe-top')) || 0
          };
        });
        assert.equal(box.hidden, false, size.name);
        assert.ok(!overlaps(box.hint, box.logo), size.name + ' hint ' + JSON.stringify(box.hint) + ' logo ' + JSON.stringify(box.logo));
        assert.ok(box.hint.top + 0.5 >= box.safe, size.name + ' hint top ' + box.hint.top + ' is inside the ' + box.safe + 'px safe area');
        assert.ok(box.font >= 13, size.name + ' hint font ' + box.font);
        assert.ok(box.hint.height >= 48, size.name + ' hint is only ' + box.hint.height + 'px tall');
        assert.match(box.text, /Add to Home Screen/);
        assert.equal(box.clipped, false, size.name + ' hint text is clipped');
        assert.ok(box.logo.top >= box.hint.bottom - 0.5, size.name + ' logo starts inside the hint');
        await saveShot(page, 'after-pin-' + size.name + '.png');
      }
    });
  } finally {
    await new Promise((resolve) => host.server.close(resolve));
  }
});

test('the open chat sheet stays below the header, including a --q-kb lift', { skip: pw ? false : 'playwright not resolvable', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  try {
    await withPhone(host.origin, PHONES[2], async (page, session) => {
      await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
      assert.equal(await setLogic(page, {
        screen: 'home', splashDone: true, customer: true, aiOpen: true, quickOpen: false, gridOpen: false, menuOpen: false,
        aiChat: [
          { from: 'bot', text: 'I am Q1, the Quik1 assistant. Ask me about your account.' },
          { from: 'me', text: 'What do I owe?' },
          { from: 'bot', text: 'You owe R 1 200.' }
        ]
      }), true);
      await pageWaitFor(page, () => !!document.querySelector('[data-q-chat]') && /Online/.test(document.body.innerText), null, { timeoutMs: 10000 });
      await page.evaluate(() => {
        document.documentElement.classList.add('q-kb');
        document.documentElement.style.setProperty('--q-kb', '280px');
        const style = document.createElement('style');
        style.textContent = 'html.q-kb .q-chat, html.q-kb .q-ask { bottom: var(--q-kb, 0px) !important; }';
        document.head.appendChild(style);
        const field = document.querySelector('[data-q-chat] input');
        if (field) field.focus();
      });
      for (const size of PHONES.filter((s) => s.width >= 360)) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await session.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: size.top, left: 0, bottom: size.bottom, right: 0 } });
        await page.waitForTimeout(80);
        const box = await page.evaluate(() => {
          const header = document.querySelector('[data-q-safe-header="home"]');
          const panel = document.querySelector('[data-q-chat]');
          const online = [...document.querySelectorAll('span')].find((el) => el.textContent === 'Online');
          const bubble = [...panel.querySelectorAll('div')].find((el) => /Ask me about your account/.test(el.textContent || '') && el.getBoundingClientRect().height > 20 && el.getBoundingClientRect().height < 120);
          const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
          return { header: r(header), panel: r(panel), online: r(online), bubble: bubble ? r(bubble) : null };
        });
        assert.ok(box.panel.top + 0.5 >= box.header.bottom, size.name + ' panel ' + box.panel.top + ' is above header ' + box.header.bottom);
        assert.ok(box.online.top + 0.5 >= box.header.bottom, size.name + ' title ' + box.online.top + ' tucks under header ' + box.header.bottom);
        assert.ok(box.bubble && box.bubble.top + 0.5 >= box.header.bottom, size.name + ' bubble ' + JSON.stringify(box.bubble) + ' tucks under header ' + box.header.bottom);
        await saveShot(page, 'after-chat-' + size.name + '.png');
      }
    });
  } finally {
    await new Promise((resolve) => host.server.close(resolve));
  }
});
