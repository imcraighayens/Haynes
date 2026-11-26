// Email and ID-plus-cellphone sign-in. Responses do not say whether an account exists.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { setEmailSender } from '../../api/_lib/email.js';
import { setSmsSender } from '../../api/_lib/sms.js';
import { SMS_NEUTRAL, SMS_REFUSED, SMS_UNAVAILABLE } from '../../api/_lib/signin.js';
import { idHmac, phoneHmac, luhnOk, normaliseSaId, stampClientIdentity } from '../../api/_lib/sa-id.js';
import { pinNotAcceptedMessage, legacyPinMessage, resetVerifyCalls, verifyCallCount, verifyPin } from '../../api/_lib/pin.js';
import { authIpHash, hashInviteCode } from '../../api/_lib/borrower.js';
import { SIGNIN_PAD_MS } from '../../api/_lib/signin.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const CLIENT_A = 'c_sign_a';
const PIN_OK = '2468';
const HMAC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const EMAIL = 'ada@example.com';
const PHONE = '825550199';

function syntheticId() {
  const body = '910722482008';
  for (let check = 0; check <= 9; check++) {
    const id = body + String(check);
    if (luhnOk(id)) return id;
  }
  throw new Error('no synthetic id');
}
const SA_ID = syntheticId();

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;
process.env.QUIK1_SESSION_SECRET = SECRET;
process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;

const seed = {
  clients: [
    {
      id: CLIENT_A, ref: 'EC-901', name: 'Book Client A', email: EMAIL,
      phone: '0000000000', id_hmac: idHmac(SA_ID), phone_hmac: phoneHmac(PHONE),
      deleted_at: null
    }
  ],
  loans: [],
  q1_borrowers: [],
  q1_invites: [],
  q1_sessions: [],
  q1_devices: [],
  q1_otp_challenges: [],
  q1_auth_attempts: [],
  audit_log: []
};

const fake = createFakePostgrest(seed);
const quik1 = (await import('../../api/quik1.js')).default;
const ledger = (await import('../../api/ledger.js')).default;
const sent = [];

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}

let ipSeq = 0;
async function call(handler, { method = 'GET', path = [], headers = {}, body } = {}) {
  const req = {
    method,
    query: { path },
    url: '/api/' + path.join('/'),
    headers: {
      host: handler === ledger ? 'localhost' : 'quik1.test',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.' + (++ipSeq % 200),
      ...headers
    },
    body
  };
  const res = makeRes();
  const started = Date.now();
  await handler(req, res);
  res.ms = Date.now() - started;
  return res;
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw || ''];
  return list.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
}

function cookieNames(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw || ''];
  return list.map(c => String(c).split('=')[0]).filter(Boolean).sort();
}

function pendingCookie(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw || '')];
  const hit = list.find(c => String(c).startsWith('q1_pending='));
  return hit ? String(hit).split(';')[0] : '';
}

async function pinAccount() {
  const created = await call(ledger, {
    method: 'POST', path: ['quik1-invites'], headers: { authorization: 'Bearer ' + STAFF }, body: { clientId: CLIENT_A }
  });
  assert.equal(created.statusCode, 201, created.body);
  const redeemed = await call(quik1, {
    method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  return redeemed.json().accountRef;
}

function liveSms() {
  setSmsSender({
    enabled: true,
    async send() { return { sent: true }; }
  });
}

let restore = () => {};
describe('borrower sign-in methods', { concurrency: false }, () => {
  beforeEach(() => {
    publicLimiter.reset();
    authLimiter.reset();
    sent.length = 0;
    setEmailSender({
      enabled: true,
      async send(to, subject, text) {
        sent.push({ to, subject, text });
        return { sent: true };
      }
    });
    process.env.QUIK1_BORROWER_PIN = '1';
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    process.env.QUIK1_EMAIL_FROM = 'quik1@example.com';
    process.env.QUIK1_EMAIL_API_URL = 'https://email.example.test/send';
    process.env.QUIK1_EMAIL_API_KEY = 'test-email-key';
    delete process.env.VERCEL_ENV;
    delete process.env.QUIK1_SIGNIN_HOURLY_CAP;
    delete process.env.QUIK1_ID_PHONE_HOURLY_CAP;
    fake.reset();
    fake.db.clients[0].id_hmac = idHmac(SA_ID);
    fake.db.clients[0].phone_hmac = phoneHmac(PHONE);
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => { setEmailSender(null); setSmsSender(null); restore(); restore = () => {}; });

  test('email sign-in does not say whether the address exists', async () => {
    await pinAccount();
    const known = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: '  ADA@example.com ' } });
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: 'nobody@example.com' } });
    assert.equal(known.statusCode, 200, known.body);
    assert.equal(unknown.statusCode, 200, unknown.body);
    assert.deepEqual(known.json(), unknown.json());
    assert.deepEqual(cookieNames(known), cookieNames(unknown));
    assert.equal(JSON.stringify(known.json()).includes(EMAIL), false);
    assert.equal(JSON.stringify(known.json()).includes('nobody@example.com'), false);
    assert.equal(cookieHeader(known).includes('q1_session='), false);
    assert.equal(cookieHeader(unknown).includes('q1_session='), false);
    assert.ok(Math.abs(known.ms - unknown.ms) < 250);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, EMAIL);
    assert.equal(sent[0].text.includes(SA_ID), false);
  });

  test('ID and cellphone never open a session until the SMS code is used', async () => {
    await pinAccount();
    const codes = [];
    setSmsSender({
      enabled: true,
      async send(to, text) {
        codes.push({ to, text });
        return { sent: true };
      }
    });
    const before = fake.db.q1_sessions.length;
    const known = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE } });
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: '829990101' } });
    assert.equal(known.statusCode, 200, known.body);
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(known.json().message, SMS_NEUTRAL);
    assert.deepEqual(cookieNames(known), cookieNames(unknown));
    assert.equal(known.body.includes(SA_ID), false);
    assert.equal(known.body.includes(PHONE), false);
    assert.equal(cookieHeader(known).includes('q1_session='), false);
    assert.equal(fake.db.q1_sessions.length, before);
    assert.equal(fake.db.q1_auth_attempts.some(row => row.kind === 'id_phone'), true);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(SA_ID), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(PHONE), false);
    assert.equal(codes.length, 1);
    assert.equal(known.body.includes(codes[0].text), false);
    const code = codes[0].text.match(/\d{4}/)[0];
    assert.equal(JSON.stringify(fake.db.q1_otp_challenges).includes(code), false);
    const opened = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(known) },
      body: { code }
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.match(opened.json().accountRef, /^qb_/);
    assert.match(cookieHeader(opened), /q1_session=/);
    assert.equal(opened.body.includes(code), false);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const again = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(known) },
      body: { code }
    });
    assert.equal(again.statusCode, 401);
    assert.equal(again.json().error, SMS_REFUSED);
  });

  test('SMS verify is throttled per phone, and the code is a keyed HMAC that expires once', async () => {
    await pinAccount();
    const codes = [];
    setSmsSender({
      enabled: true,
      async send(to, text) {
        codes.push({ to, text });
        return { sent: true };
      }
    });
    const a = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.61' },
      body: { idNumber: SA_ID, phone: PHONE }
    });
    const b = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { 'x-forwarded-for': '198.51.100.62' },
      body: { phone: '829990101' }
    });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    assert.equal(codes.length, 1);
    const code = codes[0].text.match(/\d{4}/)[0];
    const row = fake.db.q1_otp_challenges.find(item => !item.consumed_at);
    const keyed = createHmac('sha256', SECRET).update('q1-sms-code|' + code).digest('hex');
    const unsalted = createHash('sha256').update('q1-sms-code|' + code).digest('hex');
    assert.equal(row.token_hash, keyed);
    assert.notEqual(row.token_hash, unsalted);
    assert.equal(JSON.stringify(row).includes(code), false);
    assert.equal(a.body.includes(code), false);
    const badA = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(a), 'x-forwarded-for': '198.51.100.61' },
      body: { code: '0000' }
    });
    const badB = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(b), 'x-forwarded-for': '198.51.100.62' },
      body: { code: '0000' }
    });
    assert.equal(badA.statusCode, 401, badA.body);
    assert.equal(badB.statusCode, 401, badB.body);
    assert.notEqual(badB.statusCode, 429);
    const blockedA = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(a), 'x-forwarded-for': '198.51.100.61' },
      body: { code }
    });
    assert.equal(blockedA.statusCode, 429, blockedA.body);
    assert.equal(blockedA.body.includes(code), false);
    fake.db.q1_auth_attempts.forEach(item => { item.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    row.expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(a), 'x-forwarded-for': '198.51.100.63' },
      body: { code }
    });
    assert.equal(expired.statusCode, 401, expired.body);
    assert.equal(row.consumed_at, null);
    row.expires_at = new Date(Date.now() + 8 * 60 * 1000).toISOString();
    fake.db.q1_auth_attempts.forEach(item => { item.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const opened = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(a), 'x-forwarded-for': '198.51.100.64' },
      body: { code }
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.equal(opened.body.includes(code), false);
    fake.db.q1_auth_attempts.forEach(item => { item.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const reused = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(a), 'x-forwarded-for': '198.51.100.65' },
      body: { code }
    });
    assert.equal(reused.statusCode, 401, reused.body);
    assert.equal(cookieHeader(reused).includes('q1_session='), false);
  });

  test('a configured Twilio transport sends To, From and Body with Basic auth and does not echo the code', async () => {
    await pinAccount();
    setSmsSender(null);
    const lines = [];
    const orig = {};
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
      orig[method] = console[method];
      console[method] = (...args) => {
        lines.push(args.map(item => {
          try { return typeof item === 'string' ? item : JSON.stringify(item); }
          catch { return String(item); }
        }).join(' '));
      };
    }
    const calls = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.twilio.com')) {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ sid: 'SMfixture' }), { status: 201 });
      }
      return previous(url, init);
    };
    process.env.QUIK1_SMS_PROVIDER = 'twilio';
    process.env.QUIK1_SMS_ACCOUNT_SID = 'ACfixture';
    process.env.QUIK1_SMS_AUTH_TOKEN = 'fixture-sms-token';
    process.env.QUIK1_SMS_FROM = '+15555550100';
    try {
      const sent = await call(quik1, {
        method: 'POST', path: ['signin', 'sms'],
        headers: { 'x-forwarded-for': '198.51.100.66' },
        body: { phone: PHONE }
      });
      for (let i = 0; i < 5 && calls.length === 0; i++) {
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(sent.statusCode, 200, sent.body);
      assert.equal(calls.length, 1);
      const hit = calls[0];
      assert.equal(hit.url, 'https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json');
      const auth = String(hit.init.headers.Authorization || '');
      assert.match(auth, /^Basic /);
      assert.equal(Buffer.from(auth.slice(6), 'base64').toString('utf8'), 'ACfixture:fixture-sms-token');
      const form = new URLSearchParams(String(hit.init.body));
      assert.equal(form.get('To'), '+27825550199');
      assert.equal(form.get('From'), '+15555550100');
      const body = form.get('Body') || '';
      const code = body.match(/\d{4}/)[0];
      assert.match(body, /works once/);
      assert.equal(sent.body.includes(code), false);
      assert.equal(sent.body.includes('fixture-sms-token'), false);
      assert.equal(sent.body.includes('ACfixture'), false);
      assert.equal(lines.some(line => line.includes(code) || line.includes('fixture-sms-token')), false);
      const stored = JSON.stringify(fake.db.q1_otp_challenges);
      assert.equal(stored.includes(code), false);
      const keyed = createHmac('sha256', SECRET).update('q1-sms-code|' + code).digest('hex');
      assert.equal(stored.includes(keyed), true);
    } finally {
      globalThis.fetch = previous;
      for (const method of Object.keys(orig)) console[method] = orig[method];
      delete process.env.QUIK1_SMS_PROVIDER;
      delete process.env.QUIK1_SMS_ACCOUNT_SID;
      delete process.env.QUIK1_SMS_AUTH_TOKEN;
      delete process.env.QUIK1_SMS_FROM;
      setSmsSender(null);
    }
  });

  test('a sign-in link is single-use, expires, and stays on the phone that asked', async () => {
    await pinAccount();
    const first = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: EMAIL } });
    const token = sent[0].text.split('verify=')[1].trim();
    const wrong = await call(quik1, { method: 'POST', path: ['verify', 'email'], body: { token } });
    assert.equal(wrong.statusCode, 401);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const second = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: EMAIL } });
    assert.equal(second.statusCode, 200, second.body);
    const stale = await call(quik1, {
      method: 'POST', path: ['verify', 'email'],
      headers: { cookie: pendingCookie(first) },
      body: { token }
    });
    assert.equal(stale.statusCode, 401);
    const fresh = sent[1].text.split('verify=')[1].trim();
    fake.db.q1_otp_challenges.forEach(row => { if (!row.consumed_at) row.expires_at = new Date(Date.now() - 1000).toISOString(); });
    const expired = await call(quik1, {
      method: 'POST', path: ['verify', 'email'],
      headers: { cookie: pendingCookie(second) },
      body: { token: fresh }
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(JSON.stringify(fake.db.q1_otp_challenges).includes(fresh), false);
  });

  test('email and ID sign-in share a cooldown and an hourly cap', async () => {
    await pinAccount();
    const ip = { 'x-forwarded-for': '198.51.100.40' };
    const first = await call(quik1, { method: 'POST', path: ['signin', 'email'], headers: ip, body: { email: 'nobody@example.com' } });
    assert.equal(first.statusCode, 200, first.body);
    const cooled = await call(quik1, { method: 'POST', path: ['signin', 'email'], headers: ip, body: { email: 'nobody@example.com' } });
    assert.equal(cooled.statusCode, 429);
    const known = await call(quik1, { method: 'POST', path: ['signin', 'email'], headers: { 'x-forwarded-for': '198.51.100.49' }, body: { email: EMAIL } });
    assert.equal(known.statusCode, 200, known.body);
    const knownAgain = await call(quik1, { method: 'POST', path: ['signin', 'email'], headers: { 'x-forwarded-for': '198.51.100.49' }, body: { email: EMAIL } });
    assert.equal(knownAgain.statusCode, 429);
    assert.equal(sent.length, 1);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    process.env.QUIK1_ID_PHONE_HOURLY_CAP = '2';
    liveSms();
    const idIp = { 'x-forwarded-for': '198.51.100.41' };
    const a = await call(quik1, { method: 'POST', path: ['signin', 'id'], headers: idIp, body: { idNumber: SA_ID, phone: PHONE } });
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const b = await call(quik1, { method: 'POST', path: ['signin', 'id'], headers: idIp, body: { idNumber: '9107224820080', phone: '829990101' } });
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const c = await call(quik1, { method: 'POST', path: ['signin', 'id'], headers: idIp, body: { idNumber: SA_ID, phone: PHONE } });
    assert.equal(a.statusCode, 200, a.body);
    assert.equal(b.statusCode, 200, b.body);
    assert.equal(c.statusCode, 429);
    assert.equal(c.body.includes(SA_ID), false);
  });

  test('ID and cellphone sign-in fails closed when the HMAC key is unset', async () => {
    await pinAccount();
    liveSms();
    delete process.env.QUIK1_ID_HMAC_KEY;
    try {
      const res = await call(quik1, {
        method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE }
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'Sign in with your email for now');
      assert.equal(res.json().sent, undefined);
      assert.equal(res.body.includes('we sent a link'), false);
      assert.equal(cookieHeader(res).includes('q1_session='), false);
    } finally {
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    }
  });

  test('ID and cellphone sign-in fails closed when clients.id_hmac is missing', async () => {
    await pinAccount();
    liveSms();
    const installed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('select=id_hmac')) {
        return new Response(JSON.stringify({
          code: '42703',
          message: 'column id_hmac of relation clients does not exist'
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return installed(url, init);
    };
    try {
      const res = await call(quik1, {
        method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE }
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'Sign in with your email for now');
      assert.equal(res.body.includes('we sent a link'), false);
      assert.equal(cookieHeader(res).includes('q1_session='), false);
    } finally {
      globalThis.fetch = installed;
    }
  });

  test('ID and cellphone sign-in fails closed when clients.phone_hmac is missing', async () => {
    await pinAccount();
    liveSms();
    const installed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('select=phone_hmac')) {
        return new Response(JSON.stringify({
          code: 'PGRST204',
          message: 'column phone_hmac of relation clients does not exist'
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return installed(url, init);
    };
    try {
      const res = await call(quik1, {
        method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE }
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().error, 'Sign in with your email for now');
      assert.equal(res.body.includes('we sent a link'), false);
      assert.equal(cookieHeader(res).includes('q1_session='), false);
    } finally {
      globalThis.fetch = installed;
    }
  });

  test('a slow send does not make an ID match answer later than a miss', async () => {
    await pinAccount();
    const smsSent = [];
    setSmsSender({
      enabled: true,
      async send(to, text) {
        await new Promise(resolve => setTimeout(resolve, 300));
        smsSent.push({ to, text });
        return { sent: true };
      }
    });
    const miss = await call(quik1, {
      method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: '829990101' }
    });
    const match = await call(quik1, {
      method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE }
    });
    assert.equal(miss.statusCode, 200, miss.body);
    assert.equal(match.statusCode, 200, match.body);
    assert.deepEqual(miss.json(), match.json());
    assert.ok(miss.ms >= SIGNIN_PAD_MS - 50, String(miss.ms));
    assert.ok(match.ms >= SIGNIN_PAD_MS - 50, String(match.ms));
    assert.ok(Math.abs(miss.ms - match.ms) < 150, miss.ms + ' vs ' + match.ms);
    assert.ok(match.ms < SIGNIN_PAD_MS + 250, String(match.ms));
    assert.equal(smsSent.length, 1);
    assert.equal(cookieHeader(match).includes('q1_session='), false);
    assert.equal(match.body.includes(smsSent[0].text), false);
  });

  test('stampClientIdentity does nothing when an HMAC column is missing', async () => {
    const before = fake.db.clients[0].phone_hmac;
    const installed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (init && init.method === 'PATCH' && String(url).includes('/clients')) {
        return new Response(JSON.stringify({
          code: '42703',
          message: 'column phone_hmac of relation clients does not exist'
        }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return installed(url, init);
    };
    try {
      await stampClientIdentity(CLIENT_A, { id_number: SA_ID, phone: PHONE });
      await stampClientIdentity(CLIENT_A, { id_number: SA_ID, phone: PHONE });
    } finally {
      globalThis.fetch = installed;
    }
    assert.equal(fake.db.clients[0].phone_hmac, before);
  });

  test('email and ID sign-in fail closed when email is off in production', async () => {
    await pinAccount();
    process.env.QUIK1_ID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.VERCEL_ENV = 'production';
    const copy = "This phone isn't linked yet. Please contact EcoLoans and we'll reset your access.";
    try {
      const knownEmail = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: EMAIL } });
      const missEmail = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: 'nobody@example.com' } });
      const knownId = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE } });
      const missId = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: '829990101' } });
      for (const res of [knownEmail, missEmail]) {
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(res.json().error, copy);
        assert.equal(res.json().code, 'device_not_linked');
        assert.equal(res.body.includes('we sent a link'), false);
        assert.equal(cookieHeader(res).includes('q1_session='), false);
        assert.ok(res.ms >= SIGNIN_PAD_MS - 50, String(res.ms));
      }
      for (const res of [knownId, missId]) {
        assert.equal(res.statusCode, 503, res.body);
        assert.equal(res.json().error, SMS_UNAVAILABLE);
        assert.equal(cookieHeader(res).includes('q1_session='), false);
        assert.equal(res.body.includes(SA_ID), false);
        assert.ok(res.ms >= SIGNIN_PAD_MS - 50, String(res.ms));
      }
      assert.deepEqual(knownEmail.json(), missEmail.json());
      assert.deepEqual(knownId.json(), missId.json());
      assert.ok(Math.abs(knownEmail.ms - missEmail.ms) < 150, knownEmail.ms + ' vs ' + missEmail.ms);
      assert.ok(Math.abs(knownId.ms - missId.ms) < 150, knownId.ms + ' vs ' + missId.ms);
      assert.equal(sent.length, 0);
    } finally {
      delete process.env.VERCEL_ENV;
      delete process.env.QUIK1_ID_KEY;
    }
  });

  test('a match-only sign-in failure still waits out the pad', async () => {
    await pinAccount();
    const installed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('q1_otp_challenges') && init && String(init.method || 'GET').toUpperCase() === 'POST') {
        return new Response(JSON.stringify({ code: 'XX000', message: 'insert failed' }), {
          status: 500,
          headers: { 'content-type': 'application/json' }
        });
      }
      return installed(url, init);
    };
    try {
      const miss = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: 'nobody@example.com' } });
      const match = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: EMAIL } });
      assert.equal(miss.statusCode, 200, miss.body);
      assert.equal(match.statusCode, 502, match.body);
      assert.ok(miss.ms >= SIGNIN_PAD_MS - 50, String(miss.ms));
      assert.ok(match.ms >= SIGNIN_PAD_MS - 50, String(match.ms));
      assert.equal(match.body.includes('we sent a link'), false);
    } finally {
      globalThis.fetch = installed;
    }
  });

  test('SA ID and PIN opens a session on a recognised phone, and a phone on the body does not', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: { authorization: 'Bearer ' + STAFF }, body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const known = cookieHeader(redeemed);
    const withPin = await call(quik1, {
      method: 'POST', path: ['signin', 'id'], headers: { cookie: known }, body: { idNumber: SA_ID, pin: PIN_OK }
    });
    assert.equal(withPin.statusCode, 200, withPin.body);
    assert.match(withPin.json().accountRef, /^qb_/);
    assert.match(cookieHeader(withPin), /q1_session=/);
    assert.equal(withPin.body.includes(PIN_OK), false);
    assert.equal(withPin.body.includes(SA_ID), false);
    const unknownPhone = await call(quik1, {
      method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK }
    });
    assert.notEqual(unknownPhone.statusCode, 401, unknownPhone.body);
    assert.equal(unknownPhone.json().accountRef, undefined);
    const legacy = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '135790' } });
    assert.equal(legacy.statusCode, 401, legacy.body);
    assert.equal(legacy.json().error, legacyPinMessage());
    assert.equal(cookieHeader(legacy).includes('q1_session='), false);
    liveSms();
    const withBoth = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE, pin: PIN_OK } });
    assert.equal(withBoth.json().accountRef, undefined);
    assert.equal(withBoth.json().sent, true);
    assert.equal(cookieHeader(withBoth).includes('q1_session='), false);
    assert.equal(withBoth.body.includes(PHONE), false);
  });

  test('unknown ID, a mismatched phone, and a wrong code share one refusal', async () => {
    await pinAccount();
    const codes = [];
    setSmsSender({ enabled: true, async send(to, text) { codes.push(text); return { sent: true }; } });
    const known = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE } });
    const mismatch = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: '829990101' } });
    const unknownId = '0000000000000';
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: unknownId, phone: PHONE } });
    assert.deepEqual(known.json(), mismatch.json());
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(known.json().sent, true);
    assert.equal(cookieHeader(known).includes('q1_session='), false);
    assert.equal(cookieHeader(mismatch).includes('q1_session='), false);
    assert.equal(codes.length, 1);
    assert.equal(known.body.includes(codes[0]), false);
    assert.equal(JSON.stringify(fake.db.q1_otp_challenges).includes(codes[0].match(/\d{4}/)[0]), false);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const issued = (codes[0].match(/\d{4}/) || [''])[0];
    const wrongCode = issued === '9090' ? '8080' : '9090';
    const wrong = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(known) },
      body: { code: wrongCode }
    });
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const bare = await call(quik1, {
      method: 'POST', path: ['signin', 'sms'],
      headers: { cookie: pendingCookie(mismatch) },
      body: { code: '0000' }
    });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(bare.statusCode, 401, bare.body);
    assert.equal(wrong.json().error, SMS_REFUSED);
    assert.deepEqual(wrong.json(), bare.json());
    assert.equal(wrong.body.includes(SA_ID), false);
    assert.equal(wrong.body.includes(unknownId), false);
    assert.equal(cookieHeader(wrong).includes('q1_session='), false);
    assert.equal(fake.db.q1_auth_attempts.every(row => ['pin', 'email', 'id_phone', 'passkey'].includes(row.kind)), true);
  });

  test('the login dock is the design and the email link stays off the screen', async () => {
    const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../quik1/index.html'), 'utf8');
    assert.match(page, /showMethods:false/);
    assert.match(page, /emailSignIn:false/);
    assert.match(page, /emailSignIn:!!\(status&&status\.emailSignIn\)/);
    assert.equal(page.includes('>Email me a link<'), false);
    assert.equal(page.includes('>ID number and cellphone<'), false);
    assert.equal(page.includes('>Use ID number<'), false);
    assert.match(page, /label:'Face ID'/);
    assert.match(page, /label:'PIN'/);
    assert.match(page, /label:'Sign in'/);
    assert.match(page, /label:'Sign up'/);
    assert.equal(page.includes("label:'New user'"), false);
    assert.match(page, /const onAuth=!!s\.splashDone&&\(s\.screen==='login'\|\|s\.screen==='signup'\)/);
    assert.match(page, /grid-template-columns:repeat\(3,1fr\);gap:8px/);
    assert.match(page, /height:52px;border-radius:14px;[^"]*font-size:19px/);
    assert.match(page, /Enter that PIN again\. It is not taken from an ID number\./);
    assert.equal(page.includes('Same PIN again'), false);
    assert.equal(page.includes('data-q-authdock'), false);
    assert.match(page, /Are you short before payday/);
    assert.match(page, /Face ID is not set up on this phone yet/);
    assert.equal(page.includes('demo bypass'), false);
    assert.equal(page.includes('quik1_faceid_cred'), false);
    delete process.env.QUIK1_BORROWER_PIN;
    try {
      const preview = await call(quik1, { method: 'GET', path: ['webauthn'] });
      assert.equal(preview.statusCode, 200, preview.body);
      assert.equal(preview.json().emailSignIn, true);
      assert.equal(preview.json().enabled, false);
      const prod = await call(quik1, { method: 'GET', path: ['webauthn'], headers: { host: 'quik1.app' } });
      assert.equal(prod.json().emailSignIn, false);
      process.env.VERCEL_ENV = 'production';
      const vercelProd = await call(quik1, { method: 'GET', path: ['webauthn'] });
      assert.equal(vercelProd.json().emailSignIn, false);
    } finally {
      process.env.QUIK1_BORROWER_PIN = '1';
      delete process.env.VERCEL_ENV;
    }
  });

  test('phone SMS login and an uninvited sign-up do not open a session', async () => {
    await pinAccount();
    const challenges = fake.db.q1_otp_challenges.length;
    try {
      process.env.VERCEL_ENV = 'production';
      process.env.QUIK1_ID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      delete process.env.QUIK1_SMS_PROVIDER;
      setSmsSender(null);
      const closed = await call(quik1, { method: 'POST', path: ['signin', 'sms'], body: { phone: PHONE } });
      assert.equal(closed.statusCode, 503, closed.body);
      assert.equal(closed.json().error, SMS_UNAVAILABLE);
      assert.equal(closed.json().sent, undefined);
      assert.equal(cookieHeader(closed).includes('q1_session='), false);
      assert.equal(fake.db.q1_otp_challenges.length, challenges);
    } finally {
      delete process.env.VERCEL_ENV;
      delete process.env.QUIK1_ID_KEY;
      delete process.env.QUIK1_SMS_PROVIDER;
    }
    const stranger = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { idNumber: '0000000000000', phone: '829990101', pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(stranger.statusCode, 400, stranger.body);
    assert.equal(stranger.body.includes('0000000000000'), false);
    assert.equal(cookieHeader(stranger).includes('q1_session='), false);
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: { authorization: 'Bearer ' + STAFF }, body: { clientId: CLIENT_A }
    });
    assert.equal(invited.statusCode, 201, invited.body);
    const joined = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { code: invited.json().code, idNumber: SA_ID, phone: PHONE, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(joined.statusCode, 200, joined.body);
    assert.match(joined.json().accountRef, /^qb_/);
    assert.equal(joined.body.includes(SA_ID), false);
    assert.equal(joined.body.includes(PHONE), false);
  });

  test('no SMS provider fails closed on preview and production-like environments', async () => {
    await pinAccount();
    const borrowerId = fake.db.q1_borrowers[0].id;
    const planted = {
      id: 'qo_planted',
      borrower_id: borrowerId,
      channel: 'email',
      purpose: 'signin',
      token_hash: 'a'.repeat(64),
      device_hash: 'b'.repeat(64),
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      consumed_at: null
    };
    const savedVercel = process.env.VERCEL_ENV;
    const savedNode = process.env.NODE_ENV;
    const smsEnv = [
      'QUIK1_SMS_PROVIDER', 'QUIK1_SMS_API_URL', 'QUIK1_SMS_API_KEY', 'QUIK1_SMS_FROM',
      'QUIK1_SMS_ACCOUNT_SID', 'QUIK1_SMS_AUTH_TOKEN'
    ];
    const savedSms = Object.fromEntries(smsEnv.map(name => [name, process.env[name]]));
    const variants = [
      { VERCEL_ENV: 'preview' },
      { NODE_ENV: 'production' },
      { VERCEL_ENV: 'preview', NODE_ENV: 'production' }
    ];
    try {
      setSmsSender(null);
      for (const name of smsEnv) delete process.env[name];
      for (const variant of variants) {
        if (variant.VERCEL_ENV) process.env.VERCEL_ENV = variant.VERCEL_ENV;
        else delete process.env.VERCEL_ENV;
        if (variant.NODE_ENV) process.env.NODE_ENV = variant.NODE_ENV;
        else if (savedNode == null) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedNode;
        fake.db.q1_otp_challenges.push({ ...planted, id: 'qo_planted_' + (variant.VERCEL_ENV || 'node') + '_' + (variant.NODE_ENV || 'env') });
        const before = fake.db.q1_otp_challenges.map(row => ({ ...row }));
        const idSignIn = await call(quik1, {
          method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE }
        });
        const sendCode = await call(quik1, {
          method: 'POST', path: ['signin', 'sms'], body: { phone: PHONE }
        });
        const verifySms = await call(quik1, {
          method: 'POST', path: ['signin', 'sms'], body: { code: '1357' }
        });
        const verifyId = await call(quik1, {
          method: 'POST', path: ['signin', 'id'], body: { code: '1357' }
        });
        for (const res of [idSignIn, sendCode, verifySms, verifyId]) {
          assert.equal(res.statusCode, 503, res.body);
          assert.equal(res.json().error, SMS_UNAVAILABLE);
          assert.equal(res.json().sent, undefined);
          assert.equal(res.json().accountRef, undefined);
          assert.equal(cookieHeader(res).includes('q1_session='), false);
          assert.equal(res.body.includes(PHONE), false);
          assert.equal(res.body.includes('1357'), false);
        }
        assert.equal(fake.db.q1_otp_challenges.length, before.length);
        assert.deepEqual(fake.db.q1_otp_challenges, before);
      }
    } finally {
      if (savedVercel == null) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = savedVercel;
      if (savedNode == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = savedNode;
      for (const name of smsEnv) {
        if (savedSms[name] == null) delete process.env[name];
        else process.env[name] = savedSms[name];
      }
    }
  });

  test('X2 a second device cannot claim an open invite with ID and phone and no code', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: { authorization: 'Bearer ' + STAFF }, body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    const ownerCookie = cookieHeader(redeemed);
    assert.match(ownerCookie, /q1_session=/);
    const hash = fake.db.q1_borrowers[0].pin_hash;
    const openCode = 'ab'.repeat(32);
    fake.db.q1_invites.push({
      id: 'qi_x2_open',
      client_id: CLIENT_A,
      code_hash: hashInviteCode(openCode),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      revoked_at: null,
      redeemed_at: null,
      created_at: new Date().toISOString()
    });
    const sessions = fake.db.q1_sessions.map(row => row.id + ':' + (row.revoked_at || ''));
    const attack = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { idNumber: SA_ID, phone: PHONE, pin: '1357', pinConfirm: '1357' }
    });
    assert.equal(attack.statusCode, 400, attack.body);
    assert.equal(attack.json().error, 'We could not match these details to an invite.');
    assert.equal(cookieHeader(attack).includes('q1_session='), false);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
    assert.equal(await verifyPin(PIN_OK, hash), true);
    assert.equal(await verifyPin('1357', hash), false);
    assert.equal(fake.db.q1_invites.find(row => row.id === 'qi_x2_open').redeemed_at, null);
    assert.deepEqual(fake.db.q1_sessions.map(row => row.id + ':' + (row.revoked_at || '')), sessions);
    const still = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: ownerCookie } });
    assert.equal(still.statusCode, 200, still.body);
    const withCode = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { code: openCode, idNumber: SA_ID, phone: PHONE, pin: '1357', pinConfirm: '1357' }
    });
    assert.equal(withCode.statusCode, 400, withCode.body);
    assert.equal(withCode.json().error, 'This account already has a PIN. Contact us to reset it.');
    assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
    assert.equal(fake.db.q1_invites.find(row => row.id === 'qi_x2_open').redeemed_at, null);
    const stillAfter = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: ownerCookie } });
    assert.equal(stillAfter.statusCode, 200, stillAfter.body);
  });

  test('SA ID and PIN sign in against the stored client HMAC and stay generic', async () => {
    await pinAccount();
    const wrongPin = '1357';
    const unknownId = '0000000000000';
    assert.equal(luhnOk(unknownId), true);
    assert.notEqual(unknownId, SA_ID);
    const wrong = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: wrongPin } });
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: unknownId, pin: PIN_OK } });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(unknown.statusCode, 401, unknown.body);
    assert.equal(wrong.json().error, unknown.json().error);
    assert.equal(wrong.json().error, pinNotAcceptedMessage());
    assert.equal(wrong.body.includes(SA_ID), false);
    assert.equal(unknown.body.includes(unknownId), false);
    const beforeLegacy = fake.db.q1_auth_attempts.length;
    const legacy = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '13579' } });
    const legacyUnknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: unknownId, pin: '135790' } });
    assert.equal(legacy.statusCode, 401, legacy.body);
    assert.equal(legacyUnknown.statusCode, 401, legacyUnknown.body);
    assert.equal(legacy.json().error, legacyPinMessage());
    assert.deepEqual(legacy.json(), legacyUnknown.json());
    assert.equal(fake.db.q1_auth_attempts.length, beforeLegacy);
    const matched = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK } });
    assert.notEqual(matched.statusCode, 401, matched.body);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString(); });
    fake.db.q1_borrowers[0].failed_attempts = 0;
    fake.db.q1_borrowers[0].locked_at = null;
    for (let i = 0; i < 5; i++) {
      const miss = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: wrongPin } });
      assert.equal(miss.statusCode, 401, miss.body);
    }
    assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, 0);
    assert.equal(fake.db.q1_borrowers[0].locked_at, null);
    const blocked = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK } });
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.headers['retry-after'], '900');
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString(); });
    const again = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK } });
    assert.notEqual(again.statusCode, 401, again.body);
    assert.notEqual(again.statusCode, 429, again.body);
  });

  test('a bad ID still compares and a bad PIN returns 400 before any compare', async () => {
    await pinAccount();
    const attempts = fake.db.q1_borrowers[0].failed_attempts || 0;
    resetVerifyCalls();
    const badId = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: 'not-an-id', pin: PIN_OK } });
    assert.equal(badId.statusCode, 401, badId.body);
    assert.equal(badId.json().error, pinNotAcceptedMessage());
    assert.equal(badId.body.includes('not-an-id'), false);
    assert.ok(verifyCallCount() > 0);
    resetVerifyCalls();
    const badPin = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '12ab' } });
    const shortPin = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '123' } });
    assert.equal(badPin.statusCode, 400, badPin.body);
    assert.equal(shortPin.statusCode, 400, shortPin.body);
    assert.equal(badPin.json().error, 'Enter a 4-digit PIN');
    assert.equal(shortPin.json().error, badPin.json().error);
    assert.equal(verifyCallCount(), 0);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, attempts);
    const legacyBefore = fake.db.q1_auth_attempts.length;
    const legacy = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '13579' } });
    assert.equal(legacy.statusCode, 401, legacy.body);
    assert.equal(legacy.json().error, legacyPinMessage());
    assert.equal(fake.db.q1_auth_attempts.length, legacyBefore);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, attempts);
  });

  test('an unknown ID and a wrong PIN return the same error after a compare', async () => {
    await pinAccount();
    const wrongPin = '1357';
    const unknownId = '0000000000000';
    resetVerifyCalls();
    const wrong = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: wrongPin } });
    const wrongCalls = verifyCallCount();
    resetVerifyCalls();
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: unknownId, pin: PIN_OK } });
    const unknownCalls = verifyCallCount();
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(unknown.statusCode, 401, unknown.body);
    assert.deepEqual(wrong.json(), unknown.json());
    assert.equal(wrong.json().error, pinNotAcceptedMessage());
    assert.ok(wrongCalls > 0);
    assert.equal(wrongCalls, unknownCalls);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(SA_ID), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(unknownId), false);
  });

  test('each ID has its own 15-minute attempt budget', async () => {
    await pinAccount();
    const unknownId = '8001015000086';
    assert.equal(normaliseSaId(unknownId), unknownId);
    assert.notEqual(unknownId, SA_ID);
    const pin = '1357';
    const ip = '198.51.100.77';
    for (let i = 0; i < 5; i++) {
      const miss = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: unknownId, pin }
      });
      assert.equal(miss.statusCode, 401, miss.body);
      assert.equal(miss.body.includes(unknownId), false);
    }
    const budgetRows = fake.db.q1_auth_attempts.filter(row => row.subject_hash === idHmac(unknownId));
    assert.equal(budgetRows.length, 5);
    assert.equal(budgetRows.every(row => row.kind === 'id_phone'), true);
    assert.equal(budgetRows.every(row => row.ip_hash !== authIpHash(ip)), true);
    resetVerifyCalls();
    const blocked = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.78' },
      body: { idNumber: unknownId, pin }
    });
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(verifyCallCount(), 0);
    const legacyBefore = fake.db.q1_auth_attempts.length;
    const legacy = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.70' },
      body: { idNumber: unknownId, pin: '13579' }
    });
    assert.equal(legacy.statusCode, 401, legacy.body);
    assert.equal(legacy.json().error, legacyPinMessage());
    assert.equal(fake.db.q1_auth_attempts.length, legacyBefore);
    const other = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.79' },
      body: { idNumber: SA_ID, pin }
    });
    assert.equal(other.statusCode, 401, other.body);
    assert.equal(other.json().error, pinNotAcceptedMessage());
    assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, 0);
    assert.equal(fake.db.q1_borrowers[0].locked_at, null);
  });

  test('ID PIN rows use id_phone and do not change the ID-and-phone limits', async () => {
    await pinAccount();
    const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20261110143000_quik1_signin.sql'), 'utf8');
    const allowed = [...sql.matchAll(/check \(kind in \(([^)]+)\)\)/g)].map(hit => hit[1].split(',').map(part => part.trim().replace(/'/g, '')));
    const kinds = allowed.find(list => list.includes('id_phone'));
    assert.ok(kinds);
    assert.equal(kinds.includes('id_pin'), false);
    const ip = '198.51.100.60';
    process.env.QUIK1_ID_PHONE_HOURLY_CAP = '1';
    liveSms();
    try {
      const pinTry = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: SA_ID, pin: '1357' }
      });
      assert.equal(pinTry.statusCode, 401, pinTry.body);
      const budget = fake.db.q1_auth_attempts.filter(row => row.subject_hash === idHmac(SA_ID));
      assert.equal(budget.length, 1);
      assert.equal(budget[0].kind, 'id_phone');
      assert.ok(kinds.includes(budget[0].kind));
      const emailSubject = createHash('sha256').update(`q1-id_phone|${SECRET}|${SA_ID}|27825550199`).digest('hex');
      assert.notEqual(emailSubject, idHmac(SA_ID));
      const link = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: SA_ID, phone: PHONE }
      });
      assert.equal(link.statusCode, 200, link.body);
      const emailRow = fake.db.q1_auth_attempts.find(row => row.subject_hash === emailSubject);
      assert.ok(emailRow);
      assert.equal(emailRow.kind, 'id_phone');
      assert.notEqual(emailRow.subject_hash, budget[0].subject_hash);
      const again = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: SA_ID, phone: PHONE }
      });
      assert.equal(again.statusCode, 429, again.body);
      assert.equal(again.headers['retry-after'], '3600');
    } finally {
      delete process.env.QUIK1_ID_PHONE_HOURLY_CAP;
    }
  });

  test('ID PIN failures look the same for a known ID, an unknown ID, a bad ID and a lock', async () => {
    await pinAccount();
    const wrongPin = '1357';
    const unknownId = '0000000000000';
    assert.equal(luhnOk(unknownId), true);
    const borrower = fake.db.q1_borrowers[0];
    const before = { failed_attempts: borrower.failed_attempts || 0, locked_at: borrower.locked_at || null };
    const cases = [
      { name: 'known', ip: '198.51.100.21', id: SA_ID },
      { name: 'unknown', ip: '198.51.100.22', id: unknownId },
      { name: 'bad', ip: '198.51.100.23', id: 'not-an-id' }
    ];
    const seen = {};
    for (let n = 1; n <= 7; n++) {
      const round = [];
      for (const item of cases) {
        const res = await call(quik1, {
          method: 'POST', path: ['signin', 'id'],
          headers: { 'x-forwarded-for': item.ip },
          body: { idNumber: item.id, pin: wrongPin }
        });
        const snap = { status: res.statusCode, body: res.body, headers: { ...res.headers } };
        round.push(snap);
        if (n === 1) assert.ok(res.ms >= SIGNIN_PAD_MS - 50, item.name + ' ' + res.ms);
        assert.equal(res.body.includes(item.id), false, item.name);
        assert.equal(res.body.includes('Quik1 is locked'), false, item.name);
      }
      for (const snap of round) assert.deepEqual(snap, round[0]);
      seen[n] = round[0];
      if (n <= 5) {
        assert.equal(round[0].status, 401);
        assert.equal(round[0].body, JSON.stringify({ error: pinNotAcceptedMessage() }));
        assert.equal(round[0].headers['retry-after'], undefined);
      } else {
        assert.equal(round[0].status, 429);
        assert.equal(round[0].body, JSON.stringify({ error: 'Too many attempts' }));
        assert.equal(round[0].headers['retry-after'], '900');
      }
    }
    assert.equal(borrower.failed_attempts || 0, before.failed_attempts);
    assert.equal(borrower.locked_at || null, before.locked_at);
    const lockedAt = new Date().toISOString();
    borrower.failed_attempts = 3;
    borrower.locked_at = lockedAt;
    fake.db.q1_auth_attempts.forEach(row => {
      if (row.subject_hash === idHmac(SA_ID)) row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    });
    for (let n = 1; n <= 7; n++) {
      const res = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': '198.51.100.24' },
        body: { idNumber: SA_ID, pin: wrongPin }
      });
      const snap = { status: res.statusCode, body: res.body, headers: { ...res.headers } };
      assert.deepEqual(snap, seen[n]);
      assert.equal(borrower.failed_attempts, 3);
      assert.equal(borrower.locked_at, lockedAt);
    }
    fake.db.q1_auth_attempts.forEach(row => {
      if (row.subject_hash === idHmac(SA_ID)) row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    });
    const correct = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.25' },
      body: { idNumber: SA_ID, pin: PIN_OK }
    });
    assert.equal(correct.statusCode, 401, correct.body);
    assert.equal(correct.body, JSON.stringify({ error: pinNotAcceptedMessage() }));
    assert.equal(correct.body.includes('Quik1 is locked'), false);
    const lengthMismatch = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.26' },
      body: { idNumber: SA_ID, pin: '13579' }
    });
    const lengthUnknown = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.27' },
      body: { idNumber: unknownId, pin: '13579' }
    });
    assert.equal(lengthMismatch.statusCode, 401);
    assert.deepEqual(lengthMismatch.json(), lengthUnknown.json());
    assert.equal(lengthMismatch.json().error, legacyPinMessage());
    assert.equal(borrower.failed_attempts, 3);
  });

  test('one bad-format ID budget does not block a different bad-format ID', async () => {
    await pinAccount();
    const pin = '1357';
    const first = 'not-an-id';
    const second = '12345';
    assert.equal(normaliseSaId(first), '');
    assert.equal(normaliseSaId(second), '');
    for (let i = 0; i < 5; i++) {
      const miss = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': '198.51.100.31' },
        body: { idNumber: first, pin }
      });
      assert.equal(miss.statusCode, 401, miss.body);
    }
    const rows = fake.db.q1_auth_attempts.filter(row => row.kind === 'id_phone' && row.subject_hash && row.subject_hash !== idHmac(SA_ID));
    assert.equal(rows.length, 5);
    const subject = rows[0].subject_hash;
    assert.match(subject, /^[0-9a-f]{64}$/);
    assert.equal(rows.every(row => row.kind === 'id_phone' && row.subject_hash === subject), true);
    assert.equal(JSON.stringify(rows).includes(first), false);
    const blocked = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.32' },
      body: { idNumber: first, pin }
    });
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(blocked.headers['retry-after'], '900');
    const other = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.33' },
      body: { idNumber: second, pin }
    });
    assert.equal(other.statusCode, 401, other.body);
    assert.equal(other.body, JSON.stringify({ error: pinNotAcceptedMessage() }));
    const otherRows = fake.db.q1_auth_attempts.filter(row => row.subject_hash && row.subject_hash !== subject && row.subject_hash !== idHmac(SA_ID));
    assert.equal(otherRows.length, 1);
    assert.equal(otherRows[0].kind, 'id_phone');
    assert.notEqual(otherRows[0].subject_hash, subject);
    assert.equal(JSON.stringify(otherRows).includes(second), false);
  });

  test('the clients HMAC migration owns both columns and can be re-run', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../supabase/migrations/20261110150000_quik1_client_hmac.sql');
    const sql = fs.readFileSync(file, 'utf8');
    assert.match(sql, /apply only after #37 review approval; backfill needs QUIK1_ID_HMAC_KEY/);
    assert.match(sql, /add column if not exists id_hmac text/);
    assert.match(sql, /add column if not exists phone_hmac text/);
    assert.match(sql, /drop constraint if exists clients_id_hmac_hex/);
    assert.match(sql, /drop constraint if exists clients_phone_hmac_hex/);
    assert.match(sql, /create unique index if not exists clients_id_phone_hmac_uidx/);
    assert.equal(sql.includes('20261110180000'), false);
    assert.equal(/QUIK1_ID_HMAC_KEY\s*=\s*[0-9a-f]/i.test(sql), false);
  });
});
