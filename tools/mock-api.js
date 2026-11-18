// mock-api.js — one local server that serves the repo root statically (like Vercel does) AND
// runs the real handlers from api/ against the in-memory fake PostgREST (tools/fake-postgrest.js),
// seeded from tests/fixtures/state.json. Used by the Playwright boot tests and handy for manual
// end-to-end runs without a Supabase project:
//
//   node tools/mock-api.js [--port 8787] [--fixture tests/fixtures/state.json] [--key testkey]
//
// Then open http://127.0.0.1:8787/ledger/ (paste the key under Settings → Supabase, or let the
// boot test pre-seed it) and http://127.0.0.1:8787/quik1/.
//
// Test-only inspection endpoints (never part of api/):
//   GET  /__mock/db            the whole fake database
//   GET  /__mock/db/:table     one table
//   GET  /__mock/log           every write the handlers made (method, table, rows/patch)
//   POST /__mock/reset         reload the fixture and clear the log
//
// Local dev on port 5410 (see README "Run it on your laptop"):
//
//   npm run dev        this server with the fake database (no .env needed)
//   npm run dev:live   --live: the same server against the REAL Supabase project in .env, with
//                      the guards in tools/dev-live.js (read-only by default, no demo reset, no
//                      Twilio/webhook, production project refused without --prod). The
//                      /__mock/* endpoints do not exist in live mode.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createFakePostgrest, install } from './fake-postgrest.js';
import { prepareLiveEnv, installReadOnlyGuard } from './dev-live.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE_SUPABASE_URL = 'http://fake-postgrest.local';
const TYPES = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', woff2: 'font/woff2', woff: 'font/woff',
  png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json', mp4: 'video/mp4'
};
const ROUTES = { ledger: 'api/ledger.js', q1: 'api/q1.js', quik1: 'api/quik1.js', ecoloans: 'api/ecoloans.js' };

export function loadFixture(file) {
  const p = path.resolve(ROOT, file || 'tests/fixtures/state.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete j._note;
  return j;
}

// `live` (an object of tools/dev-live.js flags, or null) switches from the fake database to the
// real project already in process.env. Live mode never sets SUPABASE_* or LEDGER_KEY itself.
export async function startMockApi({ port = 0, host = '127.0.0.1', fixture, key = 'testkey', quiet = true, live = null } = {}) {
  const log = msg => { if (!quiet) console.log('[mock-api]', msg); };
  let fake = null, seed = null, uninstall = () => {}, liveInfo = null;
  const blockedWrites = new AsyncLocalStorage(); // per API request: did the read-only guard refuse a write?
  if (live) {
    liveInfo = prepareLiveEnv(process.env, live);
    if (liveInfo.errors.length) throw new Error('dev:live refused to start:\n  - ' + liveInfo.errors.join('\n  - '));
    if (!live.allowWrites) uninstall = installReadOnlyGuard(process.env.SUPABASE_URL, (m, p) => {
      const store = blockedWrites.getStore(); if (store) store.blocked = true;
      log(`BLOCKED (read-only) ${m} ${p}`);
    });
    key = process.env.LEDGER_KEY || null;
  } else {
    seed = typeof fixture === 'object' && fixture ? fixture : loadFixture(fixture);
    fake = createFakePostgrest(seed);
    uninstall = install(fake, FAKE_SUPABASE_URL);
    // The handlers read their env at request time, so set it before the first call.
    process.env.SUPABASE_URL = FAKE_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fake-service-role-key';
    process.env.LEDGER_KEY = key;
  }
  const handlers = {};
  for (const [name, file] of Object.entries(ROUTES)) handlers[name] = (await import(pathToFileURL(path.join(ROOT, file)).href)).default;
  const requests = []; // { method, url, status } for every API call, newest last

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://' + (req.headers.host || host));
      const parts = url.pathname.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });

      if (parts[0] === '__mock' && !live) return mockRoute(req, res, parts.slice(1), fake, seed, requests);

      if (parts[0] === 'api') {
        const route = handlers[parts[1]];
        if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'Not found' })); }
        // Vercel hands catch-all segments to the function as req.query.path (plus the query string).
        req.query = { path: parts.slice(2) };
        for (const [k, v] of url.searchParams) if (k !== 'path') req.query[k] = v;
        const rec = { method: req.method, url: url.pathname + url.search, status: 0, at: Date.now() };
        requests.push(rec);
        res.on('finish', () => { rec.status = res.statusCode; log(`${req.method} ${rec.url} → ${res.statusCode}`); });
        if (!live || live.allowWrites) return route(req, res);
        // A refused write surfaces from the handler as 502 "Database error". Quik1's outbox retries
        // 5xx forever, so a read-only test submission would land in the real book the next time
        // the server runs with --allow-writes. Answer 403 instead: the outbox drops 4xx for good.
        const store = { blocked: false };
        const end = res.end.bind(res);
        res.end = (...a) => {
          if (store.blocked && res.statusCode >= 500 && !res.headersSent) {
            res.statusCode = 403;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            return end(JSON.stringify({ error: 'Read-only local mode: nothing was saved. Restart dev:live with --allow-writes to save.' }));
          }
          return end(...a);
        };
        return blockedWrites.run(store, () => route(req, res));
      }

      // Static files, with vercel.json's two redirects and directory indexes.
      if (url.pathname === '/') { res.writeHead(307, { location: '/ledger/' }); return res.end(); }
      if (url.pathname === '/app') { res.writeHead(307, { location: '/quik1/' }); return res.end(); }
      let rel = parts.join('/');
      let file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(307, { location: url.pathname + '/' + url.search }); return res.end(); }
        file = path.join(file, 'index.html');
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found: ' + url.pathname); }
      const ext = file.split('.').pop().toLowerCase();
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock server error: ' + String((e && e.message) || e) }));
    }
  });

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const addr = server.address();
  const origin = `http://${host}:${addr.port}`;
  log('listening on ' + origin);

  return {
    server, origin, port: addr.port, key, fake, requests, live: liveInfo,
    get db() { return fake && fake.db; },
    get log() { return fake && fake.log; },
    // Polls a predicate against the fake until it holds or the deadline passes.
    async waitFor(pred, { timeoutMs = 5000, everyMs = 100, label = 'condition' } = {}) {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const v = pred(fake);
        if (v) return v;
        if (Date.now() > end) throw new Error('timed out waiting for ' + label);
        await new Promise(r => setTimeout(r, everyMs));
      }
    },
    reset() { if (fake) fake.reset(); requests.length = 0; },
    async close() { uninstall(); await new Promise(r => server.close(r)); }
  };
}

function mockRoute(req, res, parts, fake, seed, requests) {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (parts[0] === 'db' && req.method === 'GET') return send(200, parts[1] ? fake.table(parts[1]) : fake.db);
  if (parts[0] === 'log' && req.method === 'GET') return send(200, fake.log);
  if (parts[0] === 'requests' && req.method === 'GET') return send(200, requests);
  if (parts[0] === 'reset' && req.method === 'POST') { fake.reset(); requests.length = 0; return send(200, { ok: true }); }
  return send(404, { error: 'unknown mock route' });
}

// CLI entry: node tools/mock-api.js [--port N] [--fixture file] [--key secret]
//            node tools/mock-api.js --live [--port N] [--env-file .env] [--allow-writes] [--allow-twilio] [--allow-webhook] [--prod]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt; };
  const flag = name => args.includes('--' + name);
  let live = null;
  if (flag('live')) {
    const envFile = path.resolve(ROOT, opt('env-file', '.env'));
    if (!fs.existsSync(envFile)) { console.error(`dev:live needs ${path.relative(ROOT, envFile) || envFile}: copy .env.example to .env and fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.`); process.exit(1); }
    process.loadEnvFile(envFile);
    live = { allowWrites: flag('allow-writes'), allowTwilio: flag('allow-twilio'), allowWebhook: flag('allow-webhook'), prod: flag('prod') };
  }
  startMockApi({ port: Number(opt('port', 8787)), fixture: opt('fixture'), key: opt('key', 'testkey'), quiet: false, live })
    .then(api => {
      const local = `http://localhost:${api.port}`;
      if (live) {
        const bar = '!'.repeat(72);
        console.log(`\n${bar}\n  LIVE DATA: ${api.live.host}${api.live.production ? '  <-- PRODUCTION' : ''}`);
        console.log(live.allowWrites
          ? '  WRITES ON: anything you submit is a real row in the book and cannot be hard-deleted.'
          : '  READ-ONLY: database writes are blocked here (restart with --allow-writes to change that).');
        api.live.notes.forEach(n => console.log('  ' + n));
        console.log(`${bar}\n`);
        console.log(`Quik1: ${local}/quik1/   Admin: ${local}/ledger/`);
      } else {
        console.log(`Fake data (tests/fixtures/state.json). Nothing leaves this machine.`);
        console.log(`Quik1: ${local}/quik1/   Admin: ${local}/ledger/   (LEDGER_KEY=${api.key})`);
        console.log(`inspect: ${local}/__mock/db  ${local}/__mock/log`);
      }
      const stop = () => api.close().then(() => process.exit(0));
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
    })
    .catch(e => {
      if (e && e.code === 'EADDRINUSE') console.error(`Port ${opt('port', 8787)} is already in use. Stop the other server or pass --port.`);
      else console.error(String(e && e.message || e));
      process.exit(1);
    });
}
