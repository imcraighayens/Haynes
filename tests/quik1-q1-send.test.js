// Ask Q1 shows a yellow send button beside the field. It stays disabled until
// there is text, Enter sends, and the composer sits above the safe area and keyboard.
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

test('Ask Q1 composer markup is a yellow send control above the safe area', () => {
  const send = quik.indexOf('data-q-ai-send="1"');
  assert.ok(send > 0);
  const tag = quik.slice(send, send + 700);
  assert.match(tag, /aria-label="Send"/);
  assert.match(tag, /background:#FDD10D/);
  assert.match(tag, /stroke:#0B0620/);
  assert.doesNotMatch(tag, /\{\{ botFace \}\}/);
  const sheet = quik.indexOf('data-q-ai-sheet="1"');
  const sheetTag = quik.slice(sheet, sheet + 500);
  assert.match(sheetTag, /var\(--q-safe-bottom, env\(safe-area-inset-bottom, 0px\)\)/);
  assert.match(sheetTag, /var\(--q-keyboard, 0px\)/);
  assert.match(quik, /onAiKey:e=>\{\s*if\(e\.key!=='Enter'\) return;/);
  assert.match(quik, /aiSendOff:!\(String\(s\.aiDraft\|\|''\)\.trim\(\)\)/);
  assert.match(quik, /data-q-quick-send="1"/);
});

function startStaticHost() {
  const types = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', woff2: 'font/woff2', webmanifest: 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
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

function openAskQ1() {
  const root = document.getElementById('dc-root');
  const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  const stack = [root[key]];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    const sn = node.stateNode;
    if (sn && sn.logic && sn.logic.state && 'screen' in sn.logic.state) {
      sn.logic.setState({ splashDone: true, screen: 'home', customer: true, aiOpen: true, quickOpen: false, menuOpen: false, gridOpen: false, aiDraft: '' });
      return true;
    }
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  return false;
}

async function sendButton(page) {
  const btn = page.locator('[data-q-ai-send]');
  await btn.waitFor({ state: 'visible' });
  return btn.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      pe: cs.pointerEvents,
      opacity: Number(cs.opacity),
      bottom: r.bottom,
      top: r.top,
      height: r.height,
      aria: el.getAttribute('aria-disabled')
    };
  });
}

test('Ask Q1 send stays visible, disabled when empty, and above the inset on phone sizes', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  const browser = await pw.chromium.launch();
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
      await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
      assert.equal(await page.evaluate(openAskQ1), true);
      await pageWaitFor(page, () => /Online/.test(document.body.innerText), null, { timeoutMs: 10000 });

      const empty = await sendButton(page);
      assert.equal(empty.bg, 'rgb(253, 209, 13)', viewport.width + ' send colour');
      assert.equal(empty.pe, 'none', viewport.width + ' empty send is disabled');
      assert.ok(empty.opacity < 0.5, viewport.width + ' empty send is dimmed');
      assert.ok(empty.bottom <= viewport.height - 14, viewport.width + ' send is on screen');

      await page.evaluate(() => {
        document.documentElement.style.setProperty('--q-safe-bottom', '34px');
        document.documentElement.style.setProperty('--q-keyboard', '0px');
      });
      await page.waitForTimeout(50);
      const inset = await sendButton(page);
      assert.ok(inset.bottom <= viewport.height - 34, viewport.width + ' send overlaps a 34px bottom inset (' + inset.bottom + ')');

      await page.evaluate(() => {
        document.documentElement.style.setProperty('--q-keyboard', '280px');
      });
      await page.waitForTimeout(50);
      const raised = await sendButton(page);
      assert.ok(raised.bottom <= viewport.height - 280, viewport.width + ' send sits under a 280px keyboard (' + raised.bottom + ')');
      assert.ok(raised.top >= 0, viewport.width + ' send stays in the viewport');

      await page.evaluate(() => document.documentElement.style.setProperty('--q-keyboard', '0px'));
      const input = page.locator('[data-q-ai-sheet] input');
      await input.fill('When is my debit?');
      await input.press('Enter');
      await pageWaitFor(page, () => /When is my debit\?/.test(document.body.innerText), null, { timeoutMs: 5000 });
      const sent = await sendButton(page);
      assert.equal(sent.pe, 'none', 'draft clears after Enter, so send disables again');
      await page.close();
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => host.server.close(resolve));
  }
});
