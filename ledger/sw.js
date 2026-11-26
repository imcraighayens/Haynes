/* EcoLoans Ledger installability worker. Scope is /ledger/ only.
   Cache Storage holds one document: /ledger/offline.html, a static page with
   no book, client, or loan data. HTML navigations are network-first and are
   never written to the cache. /api/*, auth, and any request that carries a
   cookie or Authorization header are not intercepted and are never cached.
   Quik1 lives under /quik1/ and is outside this scope. */
const CACHE = 'ledger-offline-v1';
const OFFLINE_FILE = 'offline.html';

function scopeUrl() {
  return new URL('./', self.registration.scope);
}

function offlineUrl() {
  return new URL(OFFLINE_FILE, scopeUrl()).href;
}

function isApi(url) {
  return url.origin === self.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
}

function inScope(url) {
  const scope = scopeUrl();
  return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const url = offlineUrl();
    const res = await fetch(new Request(url, { cache: 'reload', credentials: 'omit' }));
    if (!res.ok || res.type !== 'basic') throw new Error('ledger offline shell unavailable');
    if (res.headers.has('set-cookie')) throw new Error('ledger offline shell must not set a cookie');
    const html = await res.text();
    await cache.put(url, new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('ledger-offline-') && key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // The browser sends these itself. Do not read, rewrite, or store them.
  if (isApi(url)) return;
  if (req.headers.has('authorization') || req.headers.has('cookie')) return;
  if (req.mode !== 'navigate' || !inScope(url)) return;
  event.respondWith(networkFirstHtml(req));
});

async function networkFirstHtml(req) {
  try {
    return await fetch(req);
  } catch (e) {
    try {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(offlineUrl());
      if (hit) return hit;
    } catch (err) { /* the inline fallback below still answers */ }
    return new Response('<!DOCTYPE html><meta charset="utf-8"><title>Ledger offline</title><p>You\'re offline. EcoLoans Ledger needs a connection to show live data.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
