// Safe area: every Quik1 header must start below a simulated iOS status-bar inset.
// Playwright cannot set env(safe-area-inset-top), so the page exposes --q-safe-top
// (0px until a browser that supports env() assigns env(safe-area-inset-top, 0px)).
// node --test tests/quik1-safe-area.test.js
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
const INSET = 59;
const VIEW = { width: 390, height: 844 };

test('safe-area variables pad the top chrome and the dock keeps the bottom inset', () => {
  assert.match(quik, /--q-safe-top:\s*0px/);
  assert.match(quik, /--q-safe-bottom:\s*0px/);
  assert.match(quik, /@supports \(padding-top: env\(safe-area-inset-top\)\)/);
  assert.match(quik, /--q-safe-top:\s*env\(safe-area-inset-top, 0px\)/);
  assert.match(quik, /--q-safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
  for (const name of ['register', 'home', 'flow', 'offer', 'estimate']) {
    assert.match(quik, new RegExp('data-q-safe-header="' + name + '"'));
    const tag = quik.slice(quik.indexOf('data-q-safe-header="' + name + '"'), quik.indexOf('data-q-safe-header="' + name + '"') + 420);
    assert.match(tag, /var\(--q-safe-top, env\(safe-area-inset-top, 0px\)\)/);
  }
  assert.match(quik, /drawerHeadTop:'calc\(34px \+ var\(--q-safe-top, env\(safe-area-inset-top, 0px\)\)\)'/);
  const backs = quik.match(/<span style="display:block;white-space:nowrap;line-height:1;letter-spacing:0">Back<\/span>/g);
  assert.equal(backs && backs.length, 2, 'both Back labels are nowrap spans so iOS does not overlap the glyphs');
  assert.match(quik, /class="q-dock" style="position:absolute;left:18px;bottom:0;z-index:45;padding-bottom:env\(safe-area-inset-bottom\)/);
  assert.match(quik, /homePadBottom:'calc\(76px \+ env\(safe-area-inset-bottom\)\)'/);
});

function startStaticHost() {
  const dir = root;
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', woff2: 'font/woff2', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
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

async function openHome(page) {
  return page.evaluate(() => {
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
    if (!logic || typeof logic.setState !== 'function') return false;
    logic.setState({ screen: 'home', splashDone: true, customer: true, menuOpen: false, gridOpen: false });
    return true;
  });
}

test('register and home headers sit at or below a 59px top inset at 390x844', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  const browser = await pw.chromium.launch();
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
  try {
    await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
    await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
    // Applied after mount: the design runtime replaces the document, which drops an init-script style.
    await page.evaluate((px) => { document.documentElement.style.setProperty('--q-safe-top', px + 'px'); }, INSET);

    await page.evaluate(() => {
      const hit = [...document.querySelectorAll('button')].find((b) => /Register/.test(b.innerText) && b.getClientRects().length);
      if (hit) hit.click();
    });
    await pageWaitFor(page, () => /Tell us about you/.test(document.body.innerText), null, { timeoutMs: 10000 });

    const register = await page.evaluate(() => {
      const header = document.querySelector('[data-q-safe-header="register"]');
      const back = header.querySelector('button');
      const label = back.querySelector('span');
      const logo = header.querySelector('img');
      return {
        pad: parseFloat(getComputedStyle(header).paddingTop),
        backTop: back.getBoundingClientRect().top,
        logoTop: logo.getBoundingClientRect().top,
        label: label.textContent,
        nowrap: getComputedStyle(label).whiteSpace,
        safe: getComputedStyle(document.documentElement).getPropertyValue('--q-safe-top').trim()
      };
    });
    assert.equal(register.safe, INSET + 'px');
    assert.ok(register.pad >= INSET, 'register header padding ' + register.pad + ' is below the ' + INSET + 'px inset');
    assert.ok(register.backTop >= INSET, 'Back button top ' + register.backTop + ' overlaps the inset');
    assert.ok(register.logoTop >= INSET, 'logo top ' + register.logoTop + ' overlaps the inset');
    assert.equal(register.label, 'Back');
    assert.equal(register.nowrap, 'nowrap');

    assert.equal(await openHome(page), true);
    await pageWaitFor(page, () => /Home/.test(document.body.innerText) && /Borrow/.test(document.body.innerText), null, { timeoutMs: 10000 });
    const home = await page.evaluate((viewportHeight) => {
      const header = document.querySelector('[data-q-safe-header="home"]');
      const row = header.firstElementChild;
      const dock = [...document.querySelectorAll('.q-dock')].find((el) => el.getClientRects().length && /padding-bottom:\s*env\(safe-area-inset-bottom\)/.test(el.getAttribute('style') || ''));
      const box = dock ? dock.getBoundingClientRect() : null;
      return {
        pad: parseFloat(getComputedStyle(header).paddingTop),
        rowTop: row.getBoundingClientRect().top,
        dockStyle: dock ? dock.getAttribute('style') : '',
        dockBottom: box ? box.bottom : null,
        viewportHeight
      };
    }, VIEW.height);
    assert.ok(home.pad >= INSET, 'home header padding ' + home.pad + ' is below the ' + INSET + 'px inset');
    assert.ok(home.rowTop >= INSET, 'home header row top ' + home.rowTop + ' overlaps the inset');
    assert.match(home.dockStyle, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    assert.ok(Math.abs(home.dockBottom - home.viewportHeight) < 2, 'dock still sits on the physical bottom');
  } finally {
    await browser.close();
    await new Promise((resolve) => host.server.close(resolve));
  }
});
