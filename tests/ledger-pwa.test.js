// Ledger installable staff app: manifest, icons, and a service worker that
// stores only the static offline page. Quik1's root aliases stay on borrower hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BORROWER_HOSTS } from '../api/_lib/hosts.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = fs.readFileSync(path.join(root, 'ledger/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'ledger/sw.js'), 'utf8');
const offline = fs.readFileSync(path.join(root, 'ledger/offline.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ledger/manifest.webmanifest'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const quikSw = fs.readFileSync(path.join(root, 'quik1/sw.js'), 'utf8');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', file);
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR', file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('manifest is standalone, scoped to /ledger/, and uses the Ledger colours', () => {
  assert.equal(manifest.name, 'EcoLoans Ledger');
  assert.equal(manifest.short_name, 'Ledger');
  assert.equal(manifest.id, '/ledger/');
  assert.equal(manifest.start_url, '/ledger/');
  assert.equal(manifest.scope, '/ledger/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#07080c');
  assert.equal(manifest.background_color, '#07080c');
  assert.equal(manifest.prefer_related_applications, undefined);
  const sizes = new Set(manifest.icons.map(i => i.sizes + ':' + i.purpose));
  assert.ok(sizes.has('192x192:any'));
  assert.ok(sizes.has('512x512:any'));
  assert.ok(sizes.has('512x512:maskable'));
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/ledger\//, icon.src);
    assert.equal(icon.type, 'image/png');
    const file = path.join(root, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), icon.src);
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(file), { w, h }, icon.src);
  }
});

test('ledger/index.html links the manifest, icons, and worker without touching the sidebar', () => {
  assert.match(ledger, /rel="manifest" href="\/ledger\/manifest\.webmanifest"/);
  assert.match(ledger, /rel="apple-touch-icon" href="\/ledger\/apple-touch-icon\.png"/);
  assert.match(ledger, /name="theme-color" content="#07080c"/);
  assert.match(ledger, /name="apple-mobile-web-app-title" content="Ledger"/);
  assert.match(ledger, /serviceWorker\.register\('\/ledger\/sw\.js', \{ scope: '\/ledger\/' \}\)/);
  assert.doesNotMatch(ledger, /\/quik1\/sw\.js/);
  assert.doesNotMatch(ledger, /\/quik1\/manifest\.webmanifest/);
  const nav = "[['dashboard','DASHBOARD'],['loans','LOANS'],['applications','APPLICATIONS'],['messages','MESSAGES'],['clients','CLIENTS'],['logbook','LOGBOOK'],['ledger','ADMIN'],['petty','PETTY CASH'],['notifications','NOTIFICATIONS'],['nupay','NUPAY']]";
  assert.ok(ledger.includes(nav), 'the restored sidebar items stay put');
});

test('service worker caches only the offline page and never api, auth, or book data', () => {
  assert.match(sw, /const CACHE = 'ledger-offline-v1'/);
  assert.match(sw, /const OFFLINE_FILE = 'offline\.html'/);
  assert.match(sw, /function isApi/);
  assert.match(sw, /pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /req\.headers\.has\('authorization'\) \|\| req\.headers\.has\('cookie'\)/);
  assert.match(sw, /credentials: 'omit'/);
  assert.match(sw, /if \(isApi\(url\)\) return/);
  assert.match(sw, /req\.mode !== 'navigate'/);
  assert.match(sw, /return await fetch\(req\)/);
  assert.match(sw, /addEventListener\('fetch'/);
  assert.ok(sw.indexOf("addEventListener('install'") < sw.indexOf("addEventListener('fetch'"));
  const puts = sw.match(/cache\.put\(/g) || [];
  assert.equal(puts.length, 1, 'the only cache write is the offline page');
  assert.match(sw, /cache\.put\(url, new Response\(html/);
  assert.doesNotMatch(sw, /cache\.put\(\s*req/);
  assert.doesNotMatch(sw, /cache\.addAll/);
  assert.doesNotMatch(sw, /caches\.delete\(k\)/);
  assert.match(sw, /key\.startsWith\('ledger-offline-'\)/);
  assert.match(offline, /You're offline/);
  assert.match(offline, /The app cache stores only this page/);
  assert.doesNotMatch(offline, /Nothing from the book is stored/);
  assert.doesNotMatch(offline, /\/api\//);
  assert.doesNotMatch(offline, /serviceWorker/);
  assert.doesNotMatch(offline, /localStorage/);
  assert.equal(quikSw.includes('ledger-offline'), false);
});

test('vercel serves the ledger manifest and worker types and does not retarget Quik1', () => {
  const manifestHeader = vercel.headers.find(h => h.source === '/ledger/manifest.webmanifest');
  const workerHeader = vercel.headers.find(h => h.source === '/ledger/sw.js');
  assert.ok(manifestHeader, 'manifest content type');
  assert.ok(workerHeader, 'worker content type');
  const manifestTypes = Object.fromEntries(manifestHeader.headers.map(h => [h.key, h.value]));
  const workerTypes = Object.fromEntries(workerHeader.headers.map(h => [h.key, h.value]));
  assert.equal(manifestTypes['Content-Type'], 'application/manifest+json');
  assert.equal(manifestTypes['Cache-Control'], 'no-cache');
  assert.equal(workerTypes['Content-Type'], 'application/javascript; charset=utf-8');
  assert.equal(workerTypes['Cache-Control'], 'no-cache');
  const rootRewrites = vercel.rewrites.filter(r => r.source === '/manifest.webmanifest' || r.source === '/sw.js');
  assert.equal(rootRewrites.length, BORROWER_HOSTS.length * 2);
  assert.ok(rootRewrites.every(r => r.destination.startsWith('/quik1/')));
  assert.equal(vercel.rewrites.some(r => String(r.destination).includes('/ledger/sw.js')), false);
  assert.equal(vercel.rewrites.some(r => String(r.destination).includes('/ledger/manifest.webmanifest')), false);
  const quikManifest = vercel.headers.find(h => h.source === '/quik1/manifest.webmanifest');
  assert.equal(quikManifest.headers.find(h => h.key === 'Content-Type').value, 'application/manifest+json');
});
