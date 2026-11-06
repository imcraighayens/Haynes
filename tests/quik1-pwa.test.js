// Quik1 installable app: manifest, icons, safe area, service worker, and the design splash video.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'quik1/sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'quik1/manifest.webmanifest'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const ledger = fs.readFileSync(path.join(root, 'ledger/index.html'), 'utf8');
const video = '90741e73-54ba-4ee7-9480-fa0370bd38e4.mp4';

test('splash and login videos use the Claude Design file and playVideos stays muted', () => {
  const tags = [...quik.matchAll(/<video\b[^>]*>/g)].map(m => m[0]);
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.match(tag, new RegExp('src="' + video.replace(/\./g, '\\.') + '"'));
    assert.match(tag, /poster="c1d1957e-ecd6-4f39-8d7f-961aa5f07abd\.png"/);
    assert.match(tag, /muted="\{\{ true \}\}"/);
    assert.match(tag, /loop="\{\{ true \}\}"/);
    assert.match(tag, /sc-camel-plays-inline="\{\{ true \}\}"/);
    assert.match(tag, /sc-camel-auto-play="\{\{ true \}\}"/);
  }
  assert.ok(fs.existsSync(path.join(root, 'quik1', video)));
  assert.ok(fs.statSync(path.join(root, 'quik1', video)).size > 8_000_000);
  const play = quik.slice(quik.indexOf('playVideos(){'), quik.indexOf('playVideos(){') + 700);
  assert.match(play, /v\.muted=true/);
  assert.match(play, /playsinline/);
  assert.match(play, /webkit-playsinline/);
});

test('manifest is standalone and linked for both quik1.app root and /quik1/', () => {
  assert.equal(manifest.name, 'Quik1');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.theme_color, '#000000');
  assert.equal(manifest.background_color, '#000000');
  const sizes = new Set(manifest.icons.map(i => i.sizes + ':' + i.purpose));
  assert.ok(sizes.has('192x192:any'));
  assert.ok(sizes.has('512x512:any'));
  assert.ok([...sizes].some(s => s.startsWith('512x512:') && s.includes('maskable')));
  assert.ok(manifest.icons.some(i => i.src.endsWith('apple-touch-icon.png')));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\//, ''))), icon.src);
  }
  assert.match(quik, /width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover/);
  assert.match(quik, /viewport-fit=cover/);
  assert.match(quik, /name="theme-color" content="#000000"/);
  assert.match(quik, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(quik, /name="mobile-web-app-capable" content="yes"/);
  assert.match(quik, /name="apple-mobile-web-app-status-bar-style" content="black-translucent"/);
  assert.match(quik, /rel="apple-touch-icon" href="\/quik1\/apple-touch-icon.png"/);
  assert.match(quik, /atRoot \? '\/manifest\.webmanifest' : '\/quik1\/manifest\.webmanifest'/);
  assert.match(quik, /<base href="\/quik1\/">/);
  assert.match(quik, /100lvh/);
  assert.match(quik, /-webkit-fill-available/);
  assert.doesNotMatch(quik, /height:\s*100dvh\s*!important/);
  assert.doesNotMatch(quik, /100vh/);
  assert.match(quik, /env\(safe-area-inset-top\)/);
  assert.match(quik, /env\(safe-area-inset-bottom\)/);
  assert.match(quik, /body\{margin:0;background:#000000/);
  assert.doesNotMatch(quik, /body\{margin:0;background:#F2F0EA/);
});

test('mobile and standalone fill the screen and the dock sits on the physical bottom', () => {
  assert.match(quik, /class="q-page"/);
  assert.match(quik, /class="q-frame"/);
  assert.match(quik, /class="q-bleed"/);
  assert.match(quik, /class="q-dock"/);
  assert.match(quik, /q-standalone/);
  assert.match(quik, /display-mode: standalone/);
  assert.match(quik, /pointer: coarse/);
  assert.match(quik, /position:\s*fixed\s*!important/);
  assert.match(quik, /inset:\s*0\s*!important/);
  assert.match(quik, /const framed=!s\.desktopView&&!standalone&&!coarse&&vw>=1024/);
  assert.match(quik, /appAspect:framed\?'390 \/ 844':'auto'/);
  assert.doesNotMatch(quik, /bottom:calc\(40px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(quik, /class="q-dock" style="position:absolute;left:18px;bottom:0;z-index:45;padding-bottom:env\(safe-area-inset-bottom\)/);
  assert.match(quik, /homePadBottom:'calc\(76px \+ env\(safe-area-inset-bottom\)\)'/);
  assert.match(quik, /touch-action:\s*pan-x pan-y/);
  assert.match(quik, /overscroll-behavior:\s*none/);
  assert.match(quik, /overflow:\s*hidden/);
  assert.match(quik, /height:\s*-webkit-fill-available\s*!important/);
  assert.match(quik, /height:\s*100lvh\s*!important/);
  assert.match(quik, /min-height:\s*100lvh\s*!important/);
  assert.doesNotMatch(quik, /html, body \{\s*background: #0B0620;\s*position:\s*fixed/);
  assert.match(quik, /showDockMini:!!\(busy&&on\)/);
  assert.match(quik, /<sc-if value="\{\{ showDockMini \}\}">/);
  assert.match(quik, /gesturestart/);
  assert.match(quik, /e\.touches && e\.touches\.length > 1/);
  assert.match(quik, /placeholder="Ask Q1 anything" style="[^"]*font-size:16px/);
});

test('Safari hint is one-time, login-only, and hidden when already standalone', () => {
  assert.match(quik, /Tap Share, then Add to Home Screen to open Quik1 full screen/);
  assert.match(quik, /quik1\.iosHintDismissed/);
  assert.match(quik, /localStorage\.setItem\(HINT_KEY, '1'\)/);
  assert.match(quik, /Enter your PIN/);
  assert.match(quik, /display-mode: standalone/);
  assert.match(quik, /navigator\.standalone === true/);
  assert.match(quik, /CriOS\|FxiOS/);
});

test('service worker caches the shell and never the video or /api', () => {
  assert.match(sw, /function isApi/);
  assert.match(sw, /function isSplashVideo/);
  assert.match(sw, /pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /mp4\|webm\|mov\|m4v/);
  assert.match(sw, /if \(isApi\(abs\) \|\| isSplashVideo\(abs\)\) return/);
  assert.match(sw, /if \(isApi\(url\) \|\| isSplashVideo\(url\)/);
  assert.match(sw, /addEventListener\('fetch'/);
  const fetchIdx = sw.indexOf("addEventListener('fetch'");
  const installIdx = sw.indexOf("addEventListener('install'");
  assert.ok(installIdx > 0 && fetchIdx > installIdx);
  assert.doesNotMatch(sw, /cache\.put\([^)]*api/i);
});

test('quik1.app root rewrite does not retarget ledger or admin', () => {
  const rootRewrites = vercel.rewrites.filter(r => r.source === '/manifest.webmanifest' || r.source === '/sw.js');
  assert.equal(rootRewrites.length, 4);
  assert.ok(rootRewrites.every(r => r.destination.startsWith('/quik1/')));
  assert.ok(rootRewrites.every(r => (r.has || []).some(h => h.type === 'host' && String(h.value).endsWith('quik1.app'))));
  assert.ok(vercel.redirects.some(r => r.source === '/' && r.destination === '/ledger/'));
  assert.doesNotMatch(ledger, /manifest\.webmanifest/);
  assert.doesNotMatch(ledger, /serviceWorker\.register/);
  assert.doesNotMatch(ledger, /apple-mobile-web-app-capable/);
});
