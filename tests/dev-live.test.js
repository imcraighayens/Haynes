// node --test tests/dev-live.test.js
// The guards behind `npm run dev:live` (tools/dev-live.js + tools/mock-api.js --live): the local
// server pointed at a real Supabase project must not reset, text, notify or (by default) write.
// Network is never touched: globalThis.fetch is a recording stub standing in for Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLiveEnv, installReadOnlyGuard, PROD_SUPABASE_HOST } from '../tools/dev-live.js';
import { startMockApi } from '../tools/mock-api.js';

const STAGING = 'https://staging-ref.supabase.co';
const SERVICE_KEY = 'service-role-secret-NEVER-RETURN';
const LEDGER_KEY = 'ledger-test-key-0123456789abcdef';
const baseEnv = () => ({ SUPABASE_URL: STAGING, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });

test('prepareLiveEnv: refuses to start without the Supabase URL and service key', () => {
  const r = prepareLiveEnv({}, {});
  assert.equal(r.errors.length, 2);
  assert.match(r.errors.join(' '), /SUPABASE_URL/);
  assert.match(r.errors.join(' '), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(prepareLiveEnv({ SUPABASE_URL: 'not a url', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}).errors.length, 1);
});

test('prepareLiveEnv: refuses the production project unless --prod', () => {
  const env = { ...baseEnv(), SUPABASE_URL: `https://${PROD_SUPABASE_HOST}` };
  const r = prepareLiveEnv({ ...env }, {});
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /PRODUCTION/);
  const ok = prepareLiveEnv({ ...env }, { prod: true });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.production, true);
  assert.equal(prepareLiveEnv(baseEnv(), {}).production, false);
});

test('prepareLiveEnv: demo reset is always off, even with --allow-* flags', () => {
  const env = { ...baseEnv(), LEDGER_ALLOW_DEMO_RESET: 'true' };
  const r = prepareLiveEnv(env, { allowWrites: true, allowTwilio: true, allowWebhook: true, prod: true });
  assert.equal(env.LEDGER_ALLOW_DEMO_RESET, undefined);
  assert.ok(r.notes.some(n => /Reset demo data/.test(n)));
});

test('prepareLiveEnv: drops Twilio and the Q1 webhook unless allowed, without echoing values', () => {
  const secrets = { TWILIO_ACCOUNT_SID: 'AC-secret', TWILIO_AUTH_TOKEN: 'tw-secret', TWILIO_FROM: '+27000', Q1_WEBHOOK_URL: 'https://hook.example/secret' };
  const env = { ...baseEnv(), ...secrets };
  const r = prepareLiveEnv(env, {});
  for (const k of Object.keys(secrets)) assert.equal(env[k], undefined, k + ' dropped');
  const printed = JSON.stringify(r);
  for (const v of Object.values(secrets)) assert.ok(!printed.includes(v), 'no secret value in notes');

  const kept = { ...baseEnv(), ...secrets };
  prepareLiveEnv(kept, { allowTwilio: true, allowWebhook: true });
  for (const [k, v] of Object.entries(secrets)) assert.equal(kept[k], v, k + ' kept');
});

test('installReadOnlyGuard: only reads and the staff sign-in reach Supabase; other hosts pass', async () => {
  const seen = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(`${(init && init.method) || 'GET'} ${url}`); return new Response('[]', { status: 200 }); };
  const blocked = [];
  const uninstall = installReadOnlyGuard(STAGING + '/', (m, p) => blocked.push(`${m} ${p}`));
  try {
    assert.equal((await fetch(STAGING + '/rest/v1/loans?select=*')).status, 200);
    assert.equal((await fetch(STAGING + '/rest/v1/loans', { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(STAGING + '/auth/v1/token?grant_type=password', { method: 'POST', body: '{}' })).status, 200);
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const r = await fetch(STAGING + '/rest/v1/applications', { method, body: '{}' });
      assert.equal(r.status, 403, method + ' blocked');
      assert.equal((await r.json()).code, 'LOCAL_READ_ONLY');
    }
    assert.equal((await fetch(STAGING + '/rest/v1/rpc/anything', { method: 'POST' })).status, 403);
    assert.equal((await fetch(STAGING + '/auth/v1/signup', { method: 'POST' })).status, 403);
    assert.equal((await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' })).status, 200, 'non-Supabase host untouched');
    assert.ok(seen.every(s => !/^(POST|PATCH|PUT|DELETE) https:\/\/staging-ref\.supabase\.co\/rest\//.test(s)), 'no write left the machine');
    assert.equal(blocked.length, 6);
  } finally {
    uninstall();
    globalThis.fetch = prev;
  }
  assert.equal(globalThis.fetch, prev, 'uninstall restores fetch');
});

test('mock-api --live: real env kept, no /__mock, no demo reset, writes blocked, key never returned', async () => {
  const saved = { ...process.env };
  const prev = globalThis.fetch;
  const supabaseCalls = [];
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (s.startsWith(STAGING)) {
      supabaseCalls.push({ method: (init && init.method) || 'GET', url: s });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '*/0' } });
    }
    return prev(url, init);
  };
  Object.assign(process.env, baseEnv(), { LEDGER_KEY, LEDGER_ALLOW_DEMO_RESET: 'true', TWILIO_ACCOUNT_SID: 'AC-x', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+27' });
  let api;
  try {
    api = await startMockApi({ live: {} });
    assert.equal(process.env.SUPABASE_URL, STAGING, 'live mode does not swap in the fake database');
    assert.equal(process.env.LEDGER_KEY, LEDGER_KEY, 'live mode does not replace LEDGER_KEY with testkey');
    assert.equal(api.fake, null);
    assert.equal(process.env.TWILIO_AUTH_TOKEN, undefined);

    const bodies = [];
    const get = async (p, init) => { const r = await prev(api.origin + p, init); const t = await r.text(); bodies.push(t); return { status: r.status, text: t }; };

    assert.equal((await get('/__mock/db')).status, 404, 'inspection endpoints do not exist in live mode');
    assert.equal((await get('/quik1/')).status, 200, 'the app is still served');

    const features = await get('/api/ledger/features', { headers: { authorization: 'Bearer ' + LEDGER_KEY } });
    assert.equal(features.status, 200);
    assert.equal(JSON.parse(features.text).demoReset, false, 'Reset demo data hidden against a real project');

    const app = { id: 'ap_0123456789ab', submittedAt: Date.now(), status: 'Needs decision', source: 'app', name: 'Test Person', phone: '0820000000', amount: 1500, term: '1 mo', purpose: 'Groceries', income: 9000, surplus: 1200 };
    const sub = await get('/api/quik1/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(app) });
    assert.equal(sub.status, 403, 'blocked write is a 4xx so the Quik1 outbox drops it instead of retrying later');
    assert.match(JSON.parse(sub.text).error, /Read-only local mode/);
    assert.deepEqual(supabaseCalls.filter(c => c.method !== 'GET' && c.method !== 'HEAD'), [], 'no write reached Supabase');

    for (const b of bodies) assert.ok(!b.includes(SERVICE_KEY), 'service role key never in a response');
  } finally {
    if (api) await api.close();
    globalThis.fetch = prev;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('mock-api --live: refuses to start on a missing key or the production project', async () => {
  const saved = { ...process.env };
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = STAGING;
    await assert.rejects(startMockApi({ live: {} }), /refused to start[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
    Object.assign(process.env, { SUPABASE_URL: `https://${PROD_SUPABASE_HOST}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    await assert.rejects(startMockApi({ live: {} }), /PRODUCTION/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
