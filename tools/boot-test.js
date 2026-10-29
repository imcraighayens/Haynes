// Boot test: serve one app folder on a random local port, open it in headless Chromium, wait,
// report what rendered, and save a screenshot. Zero project dependencies: Playwright is
// resolved from the global install (see tests/README.md).
//
//   node tools/boot-test.js <dir> <index file> <screenshot.png> [width] [height]
//   e.g. node tools/boot-test.js ledger index.html /tmp/ledger.png 1440 900
//
// Env: BOOT_WAIT_MS (default 6000) — how long to let the dc runtime compile and mount.
// Exit code 1 when the dc bundler reported an error, a page error was thrown, or the page
// stayed blank, so the script doubles as a CI gate.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not resolvable. Install it globally (npm i -g playwright && npx playwright install chromium) or set NODE_PATH.');
  process.exit(2);
}

const [, , dirArg, fileArg, outArg, wArg, hArg] = process.argv;
if (!dirArg || !fileArg || !outArg) {
  console.error('usage: node tools/boot-test.js <dir> <index file> <screenshot.png> [width] [height]');
  process.exit(2);
}
const dir = path.resolve(dirArg);
const waitMs = Number(process.env.BOOT_WAIT_MS) || 6000;
const types = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff',
  png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon'
};

// Mirrors how Vercel serves the folder: "/" -> the index file, anything else -> the file itself.
// Paths are decoded (the ledger fetches "Q1 Assistant Button.dc.html", which has spaces) and
// kept inside `dir`.
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? fileArg : urlPath.replace(/^\/+/, '');
  const file = path.resolve(dir, rel);
  if (!file.startsWith(dir + path.sep) && file !== dir) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found: ' + urlPath); }
  const ext = file.split('.').pop().toLowerCase();
  res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const logs = [];
  let browser;
  let failed = false;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: +wArg || 1440, height: +hArg || 900 } });
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
    page.on('pageerror', e => { failed = true; logs.push('pageerror: ' + String(e).slice(0, 300)); });
    page.on('requestfailed', r => logs.push('reqfail: ' + r.url().slice(-80)));

    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'load' });
    await page.waitForTimeout(waitMs);

    const info = await page.evaluate(() => ({
      title: document.title,
      bodyChars: document.body.innerText.length,
      text: document.body.innerText.slice(0, 400).replace(/\s+/g, ' '),
      hasErr: !!document.getElementById('__bundler_err'),
      errText: (document.getElementById('__bundler_err') || {}).textContent || ''
    }));
    await page.screenshot({ path: outArg, fullPage: false });
    if (info.hasErr || info.bodyChars === 0) failed = true;
    console.log(JSON.stringify({ ok: !failed, screenshot: path.resolve(outArg), info, logs: logs.slice(0, 15) }, null, 1));
  } catch (e) {
    failed = true;
    console.error('boot test crashed:', e && e.message ? e.message : e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    process.exit(failed ? 1 : 0);
  }
});
