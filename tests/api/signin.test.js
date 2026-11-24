// Email and ID-plus-cellphone sign-in. Responses do not say whether an account exists.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { setEmailSender } from '../../api/_lib/email.js';
import { idHmac, phoneHmac, luhnOk, normaliseSaId, stampClientIdentity } from '../../api/_lib/sa-id.js';
import { pinNotAcceptedMessage, resetVerifyCalls, verifyCallCount } from '../../api/_lib/pin.js';
import { authIpHash } from '../../api/_lib/borrower.js';
import { SIGNIN_PAD_MS } from '../../api/_lib/signin.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const CLIENT_A = 'c_sign_a';
const PIN_OK = '24680';
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
  afterEach(() => { setEmailSender(null); restore(); restore = () => {}; });

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

  test('ID and cellphone never open a session until the email link is used', async () => {
    await pinAccount();
    const before = fake.db.q1_sessions.length;
    const known = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: PHONE } });
    const unknown = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, phone: '829990101' } });
    assert.equal(known.statusCode, 200, known.body);
    assert.deepEqual(known.json(), unknown.json());
    assert.deepEqual(cookieNames(known), cookieNames(unknown));
    assert.equal(known.body.includes(SA_ID), false);
    assert.equal(known.body.includes(PHONE), false);
    assert.equal(cookieHeader(known).includes('q1_session='), false);
    assert.equal(fake.db.q1_sessions.length, before);
    assert.equal(fake.db.q1_auth_attempts.some(row => row.kind === 'id_phone'), true);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(SA_ID), false);
    assert.equal(sent.length, 1);
    const token = sent[0].text.split('verify=')[1].trim();
    const opened = await call(quik1, {
      method: 'POST', path: ['verify', 'email'],
      headers: { cookie: pendingCookie(known) },
      body: { token }
    });
    assert.equal(opened.statusCode, 200, opened.body);
    assert.match(opened.json().accountRef, /^qb_/);
    assert.match(cookieHeader(opened), /q1_session=/);
    const again = await call(quik1, {
      method: 'POST', path: ['verify', 'email'],
      headers: { cookie: pendingCookie(known) },
      body: { token }
    });
    assert.equal(again.statusCode, 401);
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
    setEmailSender({
      enabled: true,
      async send(to, subject, text) {
        await new Promise(resolve => setTimeout(resolve, 300));
        sent.push({ to, subject, text });
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
    assert.equal(sent.length, 1);
    assert.equal(cookieHeader(match).includes('q1_session='), false);
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
      for (const res of [knownEmail, missEmail, knownId, missId]) {
        assert.equal(res.statusCode, 403, res.body);
        assert.equal(res.json().error, copy);
        assert.equal(res.json().code, 'device_not_linked');
        assert.equal(res.body.includes('we sent a link'), false);
        assert.equal(cookieHeader(res).includes('q1_session='), false);
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

  test('SA ID and PIN sign in against the stored client HMAC and stay generic', async () => {
    await pinAccount();
    const wrongPin = '13579';
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
    assert.equal(wrong.body.includes(wrongPin), false);
    assert.equal(unknown.body.includes(PIN_OK), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(SA_ID), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(unknownId), false);
    const legacy = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '135790' } });
    assert.equal(legacy.statusCode, 400, legacy.body);
    assert.equal(legacy.json().error, 'Enter a 5-digit PIN');
    const matched = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK } });
    assert.notEqual(matched.statusCode, 401, matched.body);
    assert.equal(matched.body.includes(SA_ID), false);
    assert.equal(matched.body.includes(PIN_OK), false);
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
    assert.equal(blocked.body.includes('Quik1 is locked'), false);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 16 * 60 * 1000).toISOString(); });
    const again = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: PIN_OK } });
    assert.notEqual(again.statusCode, 401, again.body);
    assert.notEqual(again.statusCode, 423, again.body);
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
    assert.equal(badId.body.includes(PIN_OK), false);
    assert.ok(verifyCallCount() > 0);
    resetVerifyCalls();
    const badPin = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '12ab' } });
    const shortPin = await call(quik1, { method: 'POST', path: ['signin', 'id'], body: { idNumber: SA_ID, pin: '1234' } });
    assert.equal(badPin.statusCode, 400, badPin.body);
    assert.equal(shortPin.statusCode, 400, shortPin.body);
    assert.equal(badPin.json().error, 'Enter a 5-digit PIN');
    assert.equal(shortPin.json().error, badPin.json().error);
    assert.equal(verifyCallCount(), 0);
    assert.equal(badPin.body.includes(SA_ID), false);
    assert.equal(badPin.body.includes('12ab'), false);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, attempts);
  });

  test('an unknown ID and a wrong PIN return the same error after a compare', async () => {
    await pinAccount();
    const wrongPin = '13579';
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
    assert.equal(wrong.body.includes(SA_ID), false);
    assert.equal(unknown.body.includes(unknownId), false);
    assert.equal(wrong.body.includes(wrongPin), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(SA_ID), false);
    assert.equal(JSON.stringify(fake.db.q1_auth_attempts).includes(unknownId), false);
  });

  test('each ID has its own 15-minute attempt budget', async () => {
    await pinAccount();
    const unknownId = '8001015000086';
    assert.equal(normaliseSaId(unknownId), unknownId);
    assert.notEqual(unknownId, SA_ID);
    const pin = '13579';
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
    assert.equal(JSON.stringify(budgetRows).includes(unknownId), false);
    resetVerifyCalls();
    const blocked = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      headers: { 'x-forwarded-for': '198.51.100.78' },
      body: { idNumber: unknownId, pin }
    });
    assert.equal(blocked.statusCode, 429, blocked.body);
    assert.equal(verifyCallCount(), 0);
    assert.equal(blocked.body.includes(unknownId), false);
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
    try {
      const pinTry = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: SA_ID, pin: '13579' }
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
    const wrongPin = '13579';
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
    const locked = [];
    for (let n = 1; n <= 7; n++) {
      const res = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': '198.51.100.24' },
        body: { idNumber: SA_ID, pin: wrongPin }
      });
      const snap = { status: res.statusCode, body: res.body, headers: { ...res.headers } };
      assert.deepEqual(snap, seen[n]);
      locked.push(snap);
      assert.equal(borrower.failed_attempts, 3);
      assert.equal(borrower.locked_at, lockedAt);
    }
    assert.deepEqual(
      [seen[5], seen[6], seen[7]].map(snap => ({ status: snap.status, body: snap.body, retryAfter: snap.headers['retry-after'] || null })),
      [locked[4], locked[5], locked[6]].map(snap => ({ status: snap.status, body: snap.body, retryAfter: snap.headers['retry-after'] || null }))
    );
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
    assert.equal(correct.headers['retry-after'], undefined);
    assert.equal(borrower.failed_attempts, 3);
    assert.equal(borrower.locked_at, lockedAt);
    assert.equal(correct.body.includes('Quik1 is locked'), false);
  });

  test('one bad-format ID budget does not block a different bad-format ID', async () => {
    await pinAccount();
    const pin = '13579';
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
    assert.equal(JSON.stringify(rows).includes('notanid'), false);
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
    assert.match(otherRows[0].subject_hash, /^[0-9a-f]{64}$/);
    assert.equal(otherRows[0].kind, 'id_phone');
    assert.notEqual(otherRows[0].subject_hash, subject);
    assert.equal(JSON.stringify(otherRows).includes(second), false);
  });

  test('email sign-in buttons follow the server flag and ID entry stays', async () => {
    const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../quik1/index.html'), 'utf8');
    const master = `showMethods:s.screen==='login'&&s.pinPhase==='sign'&&!s.inviteCode`;
    assert.match(page, /showMethods:!!s\.emailSignIn&&s\.screen==='login'&&s\.pinPhase==='sign'&&!s\.inviteCode/);
    assert.match(page, /emailSignIn:false/);
    assert.match(page, /emailSignIn:!!\(status&&status\.emailSignIn\)/);
    const showMethods = page.match(/showMethods:([^,\n]+)/)[1];
    const visible = new Function('s', 'return (' + showMethods + ')');
    const login = { screen: 'login', pinPhase: 'sign', inviteCode: '' };
    assert.equal(visible({ ...login, emailSignIn: false }), false);
    assert.equal(visible({ ...login, emailSignIn: true }), true);
    assert.equal(visible({ ...login, emailSignIn: true, inviteCode: 'invite' }), false);
    assert.equal(visible({ ...login, emailSignIn: true, pinPhase: 'idpin' }), false);
    assert.equal(visible({ ...login, emailSignIn: true, screen: 'home' }), false);
    assert.match(page, /<button data-q-email="1" sc-camel-on-click="\{\{ onEmailSignIn \}\}" style="width:100%;height:52px;border-radius:999px;border:1px solid rgba\(255,255,255,\.22\);background:transparent;cursor:pointer;font-size:16px;font-weight:600;color:#FFFFFF">Email me a link<\/button>/);
    assert.match(page, /<button data-q-idphone="1" sc-camel-on-click="\{\{ onIdPhoneSignIn \}\}" style="width:100%;height:52px;border-radius:999px;border:1px solid rgba\(255,255,255,\.22\);background:transparent;cursor:pointer;font-size:16px;font-weight:600;color:#FFFFFF">ID number and cellphone<\/button>/);
    assert.equal(page.includes(master.replace('showMethods:', '')), true);
    assert.match(page, /showUseId:s\.screen==='login'&&s\.pinPhase==='sign'&&!s\.inviteCode/);
    assert.match(page, />Use ID number</);
    assert.equal(/showUseId:[^\n]*emailSignIn/.test(page), false);
    assert.match(page, /grid-template-columns:repeat\(3,1fr\);gap:8px/);
    assert.match(page, /height:52px;border-radius:14px;[^"]*font-size:19px/);
    assert.match(page, /Enter that PIN again\. It is not taken from an ID number\./);
    assert.equal(page.includes('Same PIN again'), false);
    assert.match(page, /const onAuth=false;/);
    assert.equal(page.includes("label:'New user'"), false);
    assert.equal(page.includes('data-q-authdock'), false);
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
