// Staff-console security: no on-screen unlock hint, server-side manager PIN for
// destructive loan actions, demo reset hidden unless explicitly allowed, and no
// provider key inputs. Fixtures below are test values, not production secrets.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { demoResetAllowed, verifyManagerPin } from '../api/_lib/auth.js';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const FIXTURE_PIN = 'fixture-manager-pin';
const FIXTURE_PIN_HASH = createHash('sha256').update(FIXTURE_PIN, 'utf8').digest('hex');

describe('shipped ledger HTML', () => {
  const lockStart = html.indexOf('data-screen-label="Ledger passcode"');
  const lockEnd = html.indexOf('data-screen-label="Ledger"');
  const lock = html.slice(lockStart, lockEnd);

  test('lock screen has no passcode hint and unlock goes to the server', () => {
    assert.ok(lockStart > 0 && lockEnd > lockStart);
    assert.equal(lock.includes('PROTOTYPE CODE'), false);
    assert.equal(/\d{6}/.test(lock), false);
    assert.match(html, /sync\.unlock\(pin\)/);
    assert.doesNotMatch(html, /pc\s*===/);
    assert.doesNotMatch(html, /===\s*['"]\d{4,8}['"]/);
    assert.doesNotMatch(html, /!==\s*['"]\d+['"]/);
  });

  test('reset demo is gated and destructive actions call the server', () => {
    assert.match(html, /<sc-if value="\{\{ showResetDemo \}\}"/);
    assert.match(html, /quik1ledger\.com/);
    assert.match(html, /ecoloans-six\.vercel\.app/);
    assert.match(html, /if\(!this\.demoResetAllowed\(\)\) return/);
    assert.match(html, /action:'delete_loan'/);
    assert.match(html, /action:'replace_book'/);
    assert.match(html, /\/manager-pin/);
  });

  test('staff HTML has no OpenAI, Anthropic, or Twilio key inputs', () => {
    assert.doesNotMatch(html, /OPENAI API KEY|ANTHROPIC API KEY|sk-ant-|aiKey|api\.openai\.com|api\.anthropic\.com|x-api-key|Account SID/i);
    assert.doesNotMatch(html, /<(input|textarea)\b[^>]*(openai|anthropic|twilio|account sid|auth token)/i);
    assert.match(html, /staffApi\('POST', '\/ai'/);
    assert.match(html, /\/twilio/);
    assert.match(html, /Not configured/);
  });
});

describe('demo reset flag', () => {
  const savedFlag = process.env.LEDGER_ALLOW_DEMO_RESET;
  const savedNode = process.env.NODE_ENV;
  const req = (host) => ({ headers: { host } });
  test('hidden unless the flag is explicitly true and the host is not production', () => {
    try {
      delete process.env.LEDGER_ALLOW_DEMO_RESET;
      process.env.NODE_ENV = 'development';
      assert.equal(demoResetAllowed(req('localhost')), false);
      process.env.LEDGER_ALLOW_DEMO_RESET = 'false';
      assert.equal(demoResetAllowed(req('localhost')), false);
      process.env.LEDGER_ALLOW_DEMO_RESET = 'true';
      assert.equal(demoResetAllowed(req('localhost')), true);
      assert.equal(demoResetAllowed(req('127.0.0.1:3000')), true);
      assert.equal(demoResetAllowed(req('quik1ledger.com')), false);
      assert.equal(demoResetAllowed(req('www.quik1ledger.com')), false);
      assert.equal(demoResetAllowed(req('ecoloans-six.vercel.app')), false);
      process.env.NODE_ENV = 'production';
      assert.equal(demoResetAllowed(req('localhost')), false);
    } finally {
      if (savedFlag == null) delete process.env.LEDGER_ALLOW_DEMO_RESET; else process.env.LEDGER_ALLOW_DEMO_RESET = savedFlag;
      if (savedNode == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNode;
    }
  });
});

function statusOf(fn) {
  try { fn(); return 0; } catch (e) { return e.status || 0; }
}
describe('manager PIN compare', () => {
  const saved = process.env.LEDGER_MANAGER_PIN;
  test('missing, wrong, and hashed secrets never accept a destructive check', () => {
    try {
      delete process.env.LEDGER_MANAGER_PIN;
      assert.equal(statusOf(() => verifyManagerPin(FIXTURE_PIN)), 503);
      process.env.LEDGER_MANAGER_PIN = FIXTURE_PIN;
      assert.equal(verifyManagerPin(FIXTURE_PIN), true);
      assert.equal(statusOf(() => verifyManagerPin('')), 401);
      assert.equal(statusOf(() => verifyManagerPin('nope')), 401);
      process.env.LEDGER_MANAGER_PIN = 'sha256:' + FIXTURE_PIN_HASH;
      assert.equal(verifyManagerPin(FIXTURE_PIN), true);
      assert.equal(statusOf(() => verifyManagerPin('nope')), 401);
    } finally {
      if (saved == null) delete process.env.LEDGER_MANAGER_PIN; else process.env.LEDGER_MANAGER_PIN = saved;
    }
  });
});

const ENV = {
  SUPABASE_URL: 'https://db.test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-NEVER-RETURN',
  LEDGER_KEY: 'ledger-test-key-0123456789abcdef'
};
const handler = (await import('../api/ledger.js')).default;

function makeRes() {
  const res = { statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; } };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}
async function call({ method = 'GET', path = [], headers = {}, body, auth = true }) {
  const req = { method, query: { path }, url: '/api/ledger/' + path.join('/'), headers: { ...(auth ? { authorization: 'Bearer ' + ENV.LEDGER_KEY } : {}), ...headers }, body };
  const res = makeRes();
  await handler(req, res);
  return res;
}
let fetches = [];
function stubFetch(route) {
  fetches = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const rec = { url: u, table: u.pathname.split('/').pop(), method: init.method || 'GET', headers: init.headers || {}, body: init.body };
    fetches.push(rec);
    const out = (await route(rec)) || { status: 200, body: [] };
    const text = out.body === undefined ? '' : (typeof out.body === 'string' ? out.body : JSON.stringify(out.body));
    return { ok: out.status < 400, status: out.status, headers: new Headers(out.headers || {}), text: async () => text, json: async () => JSON.parse(text || 'null') };
  };
}

describe('ledger destructive routes', () => {
  beforeEach(() => {
    for (const k of Object.keys(ENV)) process.env[k] = ENV[k];
    delete process.env.LEDGER_MANAGER_PIN;
    delete process.env.LEDGER_ALLOW_DEMO_RESET;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM;
    stubFetch(() => ({ status: 200, body: [{ id: 'l1', deleted_at: null }] }));
  });

  test('loan delete and book replace are rejected without a server-validated manager PIN', async () => {
    process.env.LEDGER_MANAGER_PIN = FIXTURE_PIN;
    const missing = await call({ method: 'POST', path: ['destructive'], body: { action: 'delete_loan', id: 'l1' } });
    assert.equal(missing.statusCode, 401);
    assert.equal(fetches.length, 0);
    assert.equal(JSON.stringify(missing.json()).includes(FIXTURE_PIN), false);

    const wrong = await call({ method: 'POST', path: ['destructive'], body: { action: 'delete_loan', id: 'l1', pin: 'nope' } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(fetches.length, 0);

    const wipe = await call({ method: 'POST', path: ['destructive'], body: { action: 'replace_book', rows: [{ id: 'l9', ref: 'ECL-9', principal: 10 }] } });
    assert.equal(wipe.statusCode, 401);
    assert.equal(fetches.length, 0);

    const viaSync = await call({ method: 'POST', path: ['sync'], body: { ops: [
      { table: 'loans', op: 'soft_delete', id: 'l1' },
      { table: 'loans', op: 'replace_book', rows: [{ id: 'l9', ref: 'ECL-9', principal: 10 }] }
    ] } });
    assert.equal(viaSync.statusCode, 200);
    assert.equal(viaSync.json().ok, false);
    assert.equal(viaSync.json().results[0].count, 0);
    assert.match(viaSync.json().results[0].error, /Unauthorized/);
    assert.equal(viaSync.json().results[1].count, 0);
    assert.match(viaSync.json().results[1].error, /Unauthorized/);
    assert.equal(fetches.length, 0, 'neither destructive op reached the database');
    assert.equal(JSON.stringify(viaSync.json()).includes(FIXTURE_PIN), false);

    delete process.env.LEDGER_MANAGER_PIN;
    const unconfigured = await call({ method: 'POST', path: ['destructive'], body: { action: 'delete_loan', id: 'l1', pin: FIXTURE_PIN } });
    assert.equal(unconfigured.statusCode, 503);
    assert.equal(fetches.length, 0);
  });

  test('a fixture manager PIN allows delete and replace, and a hash at rest works', async () => {
    process.env.LEDGER_MANAGER_PIN = 'sha256:' + FIXTURE_PIN_HASH;
    stubFetch(r => {
      if (r.method === 'GET') return { status: 200, body: [{ id: 'l1', deleted_at: null }, { id: 'l2', deleted_at: '2026-01-01T00:00:00Z' }] };
      if (r.method === 'PATCH') return { status: 200, body: [{ id: 'l1', deleted_at: '2026-11-05T00:00:00Z' }] };
      return { status: 200, body: r.body ? JSON.parse(r.body) : [] };
    });
    const del = await call({ method: 'POST', path: ['destructive'], body: { action: 'delete_loan', id: 'l1', pin: FIXTURE_PIN } });
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().ok, true);
    assert.equal(fetches.some(f => f.method === 'PATCH'), true);
    assert.equal(JSON.stringify(del.json()).includes(FIXTURE_PIN), false);
    assert.equal(JSON.stringify(fetches).includes(FIXTURE_PIN), false);

    fetches = [];
    const replaced = await call({ method: 'POST', path: ['destructive'], body: { action: 'replace_book', pin: FIXTURE_PIN, rows: [{ id: 'l9', ref: 'ECL-9', client_id: 'c1', principal: 50, status: 'issued' }] } });
    assert.equal(replaced.statusCode, 200);
    assert.equal(fetches.filter(f => f.method === 'PATCH').length, 1, 'only the live loan is archived');
    assert.equal(fetches.some(f => f.method === 'POST'), true);
    const posted = JSON.parse(fetches.find(f => f.method === 'POST').body);
    assert.equal(posted[0].id, 'l9');
    assert.equal(posted[0].deleted_at, null);
    assert.equal(JSON.stringify(replaced.json()).includes(FIXTURE_PIN_HASH), false);
  });

  test('demo reset, AI, and Twilio stay server-side and omit secrets', async () => {
    const savedNode = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    process.env.LEDGER_ALLOW_DEMO_RESET = 'true';
    const local = await call({ path: ['features'], headers: { host: 'localhost:3000' } });
    assert.equal(local.json().demoReset, true);
    const prod = await call({ path: ['features'], headers: { host: 'quik1ledger.com' } });
    assert.equal(prod.json().demoReset, false);
    const vercel = await call({ path: ['features'], headers: { host: 'ecoloans-six.vercel.app' } });
    assert.equal(vercel.json().demoReset, false);
    process.env.NODE_ENV = 'production';
    const nodeProd = await call({ path: ['features'], headers: { host: 'localhost' } });
    assert.equal(nodeProd.json().demoReset, false);
    if (savedNode == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNode;

    const aiOff = await call({ path: ['ai'] });
    assert.equal(aiOff.json().configured, false);
    assert.equal(fetches.length, 0);
    const aiPost = await call({ method: 'POST', path: ['ai'], body: { prompt: 'hi', key: 'sk-attacker', apiKey: 'sk-attacker' } });
    assert.equal(aiPost.statusCode, 503);
    assert.equal(aiPost.json().error, 'Not configured');
    assert.equal(fetches.length, 0);
    assert.equal(JSON.stringify(aiPost.json()).includes('sk-attacker'), false);

    const twOff = await call({ method: 'POST', path: ['twilio'], body: { action: 'sms', to: '+15555550100', accountSid: 'ACfromclient', authToken: 'client-token' } });
    assert.equal(twOff.statusCode, 503);
    assert.equal(twOff.json().error, 'Not configured');
    assert.equal(fetches.length, 0);

    const fixtureKey = 'fixture-anthropic-key';
    process.env.ANTHROPIC_API_KEY = fixtureKey;
    stubFetch(() => ({ status: 200, body: { content: [{ text: 'ok' }] } }));
    const aiOn = await call({ method: 'POST', path: ['ai'], body: { prompt: 'read this', key: 'sk-attacker' } });
    assert.equal(aiOn.statusCode, 200);
    assert.equal(aiOn.json().text, 'ok');
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].url.hostname, 'api.anthropic.com');
    assert.equal(fetches[0].headers['x-api-key'], fixtureKey);
    assert.equal(String(fetches[0].body).includes('sk-attacker'), false);
    assert.equal(JSON.stringify(aiOn.json()).includes(fixtureKey), false);

    process.env.TWILIO_ACCOUNT_SID = 'ACfixture';
    process.env.TWILIO_AUTH_TOKEN = 'fixture-twilio-token';
    process.env.TWILIO_FROM = '+15555550199';
    fetches = [];
    stubFetch(() => ({ status: 201, body: { sid: 'SMfixture' } }));
    const sms = await call({ method: 'POST', path: ['twilio'], body: { action: 'sms', to: '+15555550100', body: 'hello', authToken: 'client-token' } });
    assert.equal(sms.statusCode, 200);
    assert.equal(fetches.length, 1);
    assert.match(fetches[0].url.href, /api\.twilio\.com/);
    assert.match(fetches[0].url.href, /ACfixture/);
    const auth = String(fetches[0].headers.Authorization || fetches[0].headers.authorization || '');
    assert.match(auth, /^Basic /);
    assert.equal(Buffer.from(auth.slice(6), 'base64').toString('utf8'), 'ACfixture:fixture-twilio-token');
    assert.equal(String(fetches[0].body).includes('client-token'), false);
    assert.equal(JSON.stringify(sms.json()).includes('fixture-twilio-token'), false);
    const noDest = await call({ method: 'POST', path: ['twilio'], body: { action: 'sms' } });
    assert.equal(noDest.statusCode, 400);
    assert.equal(noDest.json().error, 'Not configured');
  });
});
