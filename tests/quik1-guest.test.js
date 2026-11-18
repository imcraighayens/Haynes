// Face ID is hidden unless this device has a platform authenticator and the
// server says biometric sign-in is on. Guest browse never calls account APIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright, pageWaitFor } from './_boot-helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
const flags = fs.readFileSync(path.join(root, 'api/_lib/quik1-flags.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261110143000_quik1_signin.sql'), 'utf8');
const pw = loadPlaywright();

test('biometric follows the PIN kill switch and the guest tour is gone', () => {
  assert.match(flags, /export function borrowerBiometricLive\(req\) \{\s*return borrowerPinLive\(req\);/);
  assert.equal(flags.includes('QUIK1_ALLOW_PRODUCTION_AUTH'), false);
  assert.match(quik, /isUserVerifyingPlatformAuthenticatorAvailable/);
  assert.match(quik, /showFaceId:!!s\.platformAuth&&!!s\.biometricLive&&s\.pinPhase==='sign'&&!s\.inviteCode/);
  assert.match(quik, /data-q-face="1"/);
  assert.match(quik, /data-q-forgot="1"/);
  assert.match(quik, /showForgotPin:!!s\.emailLive/);
  assert.match(quik, /Choose '\+PIN_LENGTH\+' numbers/);
  assert.equal(quik.includes('Browse the app'), false);
  assert.equal(quik.includes('Sample Borrower'), false);
  assert.equal(quik.includes('sample data'), false);
  assert.equal(quik.includes('seedLoan'), false);
  assert.equal(quik.includes('seedGrowth'), false);
  assert.equal(quik.includes('#invite='), false);
  assert.match(quik, /#verify=/);
  assert.match(quik, /#reset=/);
  assert.match(migration, /Do not run this from the app/);
  assert.match(migration, /revoke all on table public\.q1_webauthn_credentials from public, anon, authenticated/);
  assert.match(migration, /90-day retention mark/);
  assert.equal(migration.includes('id_number'), false);
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

function dismissSplash() {
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
      sn.logic.setState({ splashDone: true });
      return true;
    }
    if (node.child) stack.push(node.child);
    if (node.sibling) stack.push(node.sibling);
  }
  return false;
}

test('the Face ID button stays hidden when the platform authenticator is unavailable', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  const host = await startStaticHost();
    const browser = await pw.chromium.launch({
      executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
    await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
    assert.equal(await page.evaluate(dismissSplash), true);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-q-face]').count(), 0);
    assert.equal(await page.locator('[data-q-browse]').count(), 0);
  } finally {
    await browser.close();
    await new Promise((resolve) => host.server.close(resolve));
  }
});

test('the login screen has no guest tour and hides Forgot PIN until email is live', { skip: pw ? false : 'playwright not resolvable (npm i -g playwright && npx playwright install chromium)', timeout: 120000 }, async () => {
  const host = await startStaticHost();
  const browser = await pw.chromium.launch({
    executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(host.origin + '/quik1/', { waitUntil: 'domcontentloaded' });
    await pageWaitFor(page, () => /Enter your PIN/.test(document.body.innerText), null, { timeoutMs: 20000 });
    assert.equal(await page.evaluate(dismissSplash), true);
    await pageWaitFor(page, () => /Email me a link/.test(document.body.innerText), null, { timeoutMs: 8000 });
    const hidden = await page.evaluate(() => ({
      browse: document.querySelectorAll('[data-q-browse]').length,
      forgot: document.querySelectorAll('[data-q-forgot]').length,
      sample: /Sample Borrower|sample data|Browsing as guest/.test(document.body.innerText)
    }));
    assert.equal(hidden.browse, 0);
    assert.equal(hidden.forgot, 0);
    assert.equal(hidden.sample, false);
  } finally {
    await browser.close();
    await new Promise((resolve) => host.server.close(resolve));
  }
});
