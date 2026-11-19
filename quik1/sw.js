/* Quik1 app shell. Caches the page and its static files so the installed app can open offline.
   Never caches /api (including auth) and never precaches or stores the splash video. */
const CACHE = 'quik1-shell-v1';

function scopeBase() {
  return new URL('./', self.registration.scope);
}

function isApi(url) {
  return url.origin === self.location.origin && (url.pathname === '/api' || url.pathname.startsWith('/api/'));
}

function isSplashVideo(url) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function precache() {
  const cache = await caches.open(CACHE);
  const page = scopeBase();
  const res = await fetch(page.href, { cache: 'reload' });
  if (!res.ok) return;
  const html = await res.text();
  await cache.put(page.href, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  const baseHref = (html.match(/<base\s+[^>]*href=["']([^"']+)["']/i) || [])[1];
  const base = new URL(baseHref || './', page);
  const found = new Set();
  const tagRe = /<(?:script|link|img|image|video|source)\b[^>]*>/gi;
  const attrRe = /(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi;
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let tag;
  while ((tag = tagRe.exec(html))) {
    let attr;
    const chunk = tag[0];
    while ((attr = attrRe.exec(chunk))) consider(attr[1], base, found);
  }
  let css;
  while ((css = urlRe.exec(html))) consider(css[1], base, found);
  const resources = html.match(/window\.__resources\s*=\s*(\{[^}]+\})/);
  if (resources) {
    try {
      const map = JSON.parse(resources[1]);
      for (const val of Object.values(map)) consider(String(val), base, found);
    } catch (e) { /* the shell still caches the tagged scripts */ }
  }
  try {
    const manifestUrl = new URL('manifest.webmanifest', page);
    const man = await fetch(manifestUrl.href, { cache: 'reload' });
    if (man.ok && !isApi(manifestUrl)) {
      await cache.put(manifestUrl.href, man.clone());
      const json = await man.json();
      for (const icon of json.icons || []) {
        try { consider(icon.src, manifestUrl, found); } catch (e) { /* skip a bad icon url */ }
      }
    }
  } catch (e) { /* manifest is optional for the offline shell */ }
  await Promise.all([...found].map(async (href) => {
    try {
      const r = await fetch(href, { cache: 'reload' });
      if (r.ok) await cache.put(href, r);
    } catch (e) { /* one missing font should not block install */ }
  }));
}

function consider(raw, base, found) {
  if (!raw || raw.startsWith('data:') || raw.startsWith('#') || raw.includes('{{')) return;
  let abs;
  try { abs = new URL(raw, base); } catch (e) { return; }
  if (abs.origin !== self.location.origin) return;
  if (isApi(abs) || isSplashVideo(abs)) return;
  if (abs.pathname === '/sw.js' || abs.pathname.endsWith('/sw.js')) return;
  if (!/\.(js|css|png|webp|jpe?g|svg|ico|woff2?|webmanifest)$/i.test(abs.pathname)) return;
  found.add(abs.href);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  // Leave API, auth, and the background video on the network. Do not write them to Cache Storage.
  if (isApi(url) || isSplashVideo(url) || url.pathname.endsWith('/sw.js')) return;
  event.respondWith(fromCacheOrNetwork(req, url));
});

async function fromCacheOrNetwork(req, url) {
  const cache = await caches.open(CACHE);
  if (req.mode === 'navigate') {
    try {
      const fresh = await fetch(req);
      const page = scopeBase();
      const indexPath = new URL('index.html', page).pathname;
      if (fresh.ok && fresh.type === 'basic' && (url.pathname === page.pathname || url.pathname === indexPath)) {
        cache.put(page.href, fresh.clone());
      }
      return fresh;
    } catch (e) {
      return (await cache.match(req)) || (await cache.match(scopeBase().href)) || Response.error();
    }
  }
  const hit = await cache.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh.ok && fresh.type === 'basic' && !isApi(url) && !isSplashVideo(url)) cache.put(req, fresh.clone());
  return fresh;
}
