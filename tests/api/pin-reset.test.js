// Forgot-PIN. The email body is generic. The link reuses purpose signin.
// A qr_ id and a #reset= fragment tell it apart from a sign-in link.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { setEmailSender } from '../../api/_lib/email.js';
import { tempPinLimiter } from '../../api/_lib/borrower.js';
import { QUIK1_PIN_LENGTH, verifyPin } from '../../api/_lib/pin.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const CLIENT_A = 'c_reset_a';
const PIN_OK = '24680';
const PIN_NEXT = '13579';
const EMAIL = 'ada@example.com';

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;
process.env.QUIK1_SESSION_SECRET = SECRET;

const seed = {
  clients: [
    { id: CLIENT_A, ref: 'EC-901', name: 'Reset Client', email: EMAIL, deleted_at: null }
  ],
  loans: [],
  q1_borrowers: [],
  q1_sessions: [],
  q1_devices: [],
  q1_otp_challenges: [],
  q1_auth_attempts: [],
  q1_temp_pin_sets: [],
  q1_webauthn_credentials: [],
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
  await handler(req, res);
  return res;
}

function cookiePart(res, name) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw || '')];
  const hit = list.find(c => String(c).startsWith(name + '='));
  return hit ? String(hit).split(';')[0] : '';
}

function enableEmail() {
  process.env.QUIK1_EMAIL_FROM = 'quik1@example.com';
  process.env.QUIK1_EMAIL_API_URL = 'https://email.example.test/send';
  process.env.QUIK1_EMAIL_API_KEY = 'test-email-key';
}

async function setPin() {
  const set = await call(ledger, {
    method: 'POST', path: ['quik1-temp-pin'],
    headers: { authorization: 'Bearer ' + STAFF },
    body: { clientId: CLIENT_A, pin: PIN_OK, pinConfirm: PIN_OK }
  });
  assert.equal(set.statusCode, 200, set.body);
  return fake.db.q1_borrowers[0];
}

function resetToken() {
  const last = sent[sent.length - 1];
  assert.ok(last);
  assert.match(last.text, /#reset=[0-9a-f]{64}/);
  assert.equal(last.text.includes('#verify='), false);
  return last.text.split('reset=')[1].trim();
}

let restore = () => {};
describe('forgot PIN', { concurrency: false }, () => {
  beforeEach(() => {
    publicLimiter.reset();
    authLimiter.reset();
    tempPinLimiter.reset();
    sent.length = 0;
    setEmailSender({
      enabled: true,
      async send(to, subject, text) {
        sent.push({ to, subject, text });
        return { sent: true };
      }
    });
    process.env.QUIK1_BORROWER_PIN = '1';
    enableEmail();
    delete process.env.VERCEL_ENV;
    delete process.env.QUIK1_AUTH_RATE_LIMIT;
    fake.reset();
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => {
    setEmailSender(null);
    restore();
    restore = () => {};
    delete process.env.QUIK1_EMAIL_FROM;
    delete process.env.QUIK1_EMAIL_API_URL;
    delete process.env.QUIK1_EMAIL_API_KEY;
  });

  test('the button stays hidden until email is live, and the route is 503 when email is off', async () => {
    const quik = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../quik1/index.html'), 'utf8');
    assert.match(quik, /Forgot PIN/);
    assert.match(quik, /showForgotPin:!!s\.emailLive/);
    assert.match(quik, /data-q-forgot="1"/);
    delete process.env.QUIK1_EMAIL_API_KEY;
    const off = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: EMAIL } });
    assert.equal(off.statusCode, 503, off.body);
    assert.equal(off.json().error, 'PIN reset is not available');
    assert.equal(off.headers['set-cookie'], undefined);
    assert.equal(fake.db.q1_otp_challenges.length, 0);
    assert.equal(sent.length, 0);
    const idle = await call(quik1, { method: 'GET', path: ['pin'] });
    assert.equal(idle.json().emailLive, false);
    assert.equal(idle.json().pinChangeRequired, false);
  });

  test('an unknown email gets the same body as a known one and no challenge', async () => {
    await setPin();
    const known = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: '  ADA@example.com ' } });
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const unknown = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: 'nobody@example.com' } });
    assert.equal(known.statusCode, 200, known.body);
    assert.equal(unknown.statusCode, 200, unknown.body);
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(known.json().sent, true);
    assert.equal(fake.db.q1_otp_challenges.length, 1);
    assert.equal(fake.db.q1_otp_challenges[0].purpose, 'signin');
    assert.equal(String(fake.db.q1_otp_challenges[0].id).startsWith('qr_'), true);
    assert.equal(JSON.stringify(fake.db.q1_otp_challenges).includes(resetToken()), false);
    assert.equal(cookiePart(known, 'q1_pending') !== '', true);
    assert.equal(cookiePart(known, 'q1_session'), '');
  });

  test('a reset link is single-use, expires, and stays on the phone that asked', async () => {
    const borrower = await setPin();
    const device = 'qd_old';
    const session = 'qs_old';
    fake.db.q1_devices.push({
      id: device, borrower_id: borrower.id, token_hash: 'ab'.repeat(32), revoked_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString()
    });
    fake.db.q1_sessions.push({
      id: session, borrower_id: borrower.id, client_id: CLIENT_A, revoked_at: null,
      expires_at: new Date(Date.now() + 86400000).toISOString()
    });
    fake.db.q1_webauthn_credentials.push({
      id: 'cred_old', borrower_id: borrower.id, revoked_at: null
    });
    const first = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: EMAIL } });
    const token = resetToken();
    const wrong = await call(quik1, { method: 'POST', path: ['pin', 'reset', 'consume'], body: { token } });
    assert.equal(wrong.statusCode, 401, wrong.body);
    assert.equal(fake.db.q1_otp_challenges[0].consumed_at, null);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    fake.db.q1_otp_challenges[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const expired = await call(quik1, {
      method: 'POST', path: ['pin', 'reset', 'consume'],
      headers: { cookie: cookiePart(first, 'q1_pending') },
      body: { token }
    });
    assert.equal(expired.statusCode, 401, expired.body);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const again = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: EMAIL } });
    const fresh = resetToken();
    const consumed = await call(quik1, {
      method: 'POST', path: ['pin', 'reset', 'consume'],
      headers: { cookie: cookiePart(again, 'q1_pending') },
      body: { token: fresh }
    });
    assert.equal(consumed.statusCode, 200, consumed.body);
    assert.equal(consumed.json().pinChange, true);
    assert.equal(consumed.json().accountRef, undefined);
    assert.equal(cookiePart(consumed, 'q1_session'), '');
    assert.match(cookiePart(consumed, 'q1_pin_change'), /^q1_pin_change=[0-9a-f]{64}$/);
    const reused = await call(quik1, {
      method: 'POST', path: ['pin', 'reset', 'consume'],
      headers: { cookie: cookiePart(again, 'q1_pending') },
      body: { token: fresh }
    });
    assert.equal(reused.statusCode, 401, reused.body);
    const short = await call(quik1, {
      method: 'POST', path: ['pin'],
      headers: { cookie: cookiePart(consumed, 'q1_pin_change') },
      body: { pin: '1234', pinConfirm: '1234' }
    });
    assert.equal(short.statusCode, 400, short.body);
    const long = await call(quik1, {
      method: 'POST', path: ['pin'],
      headers: { cookie: cookiePart(consumed, 'q1_pin_change') },
      body: { pin: '1'.repeat(QUIK1_PIN_LENGTH + 1), pinConfirm: '1'.repeat(QUIK1_PIN_LENGTH + 1) }
    });
    assert.equal(long.statusCode, 400, long.body);
    assert.equal(fake.db.q1_borrowers[0].pin_change_hash != null, true);
    const done = await call(quik1, {
      method: 'POST', path: ['pin'],
      headers: { cookie: cookiePart(consumed, 'q1_pin_change') },
      body: { pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(done.statusCode, 200, done.body);
    assert.match(done.json().accountRef, /^qb_/);
    assert.match(cookiePart(done, 'q1_session'), /^q1_session=/);
    assert.match(cookiePart(done, 'q1_known'), /^q1_known=/);
    const row = fake.db.q1_borrowers[0];
    assert.equal(row.pin_change_hash, null);
    assert.equal(row.device_reset_until, null);
    assert.equal(await verifyPin(PIN_NEXT, row.pin_hash), true);
    assert.equal(fake.db.q1_devices.find(d => d.id === device).revoked_at != null, true);
    assert.equal(fake.db.q1_sessions.find(s => s.id === session).revoked_at != null, true);
    assert.equal(fake.db.q1_webauthn_credentials[0].revoked_at != null, true);
    assert.equal(fake.db.q1_otp_challenges.every(c => c.consumed_at), true);
    assert.equal(fake.db.q1_devices.some(d => d.id !== device && !d.revoked_at), true);
    assert.equal(fake.db.q1_sessions.some(s => s.id !== session && !s.revoked_at), true);
    const old = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: 'q1_session=stale' } });
    assert.equal(old.statusCode, 401);
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookiePart(done, 'q1_session') } });
    assert.equal(home.statusCode, 200, home.body);
  });

  test('a sign-in link is not a reset link, and a reset link does not sign in', async () => {
    await setPin();
    const sign = await call(quik1, { method: 'POST', path: ['signin', 'email'], body: { email: EMAIL } });
    const signToken = sent[0].text.split('verify=')[1].trim();
    const asReset = await call(quik1, {
      method: 'POST', path: ['pin', 'reset', 'consume'],
      headers: { cookie: cookiePart(sign, 'q1_pending') },
      body: { token: signToken }
    });
    assert.equal(asReset.statusCode, 401, asReset.body);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    const reset = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: EMAIL } });
    const token = resetToken();
    const asSign = await call(quik1, {
      method: 'POST', path: ['verify', 'email'],
      headers: { cookie: cookiePart(reset, 'q1_pending') },
      body: { token }
    });
    assert.equal(asSign.statusCode, 401, asSign.body);
    assert.equal(cookiePart(asSign, 'q1_session'), '');
  });

  test('reset shares the sign-in subject cap and the auth budgets', async () => {
    await setPin();
    const ip = { 'x-forwarded-for': '198.51.100.77' };
    const first = await call(quik1, { method: 'POST', path: ['pin', 'reset'], headers: ip, body: { email: EMAIL } });
    assert.equal(first.statusCode, 200, first.body);
    const cooled = await call(quik1, { method: 'POST', path: ['pin', 'reset'], headers: ip, body: { email: EMAIL } });
    assert.equal(cooled.statusCode, 429, cooled.body);
    fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    for (let i = 0; i < 5; i++) {
      const ok = await call(quik1, { method: 'POST', path: ['pin', 'reset'], headers: ip, body: { email: 'nobody@example.com' } });
      assert.equal(ok.statusCode, 200, ok.body);
      fake.db.q1_auth_attempts.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    }
    const capped = await call(quik1, { method: 'POST', path: ['pin', 'reset'], headers: ip, body: { email: 'nobody@example.com' } });
    assert.equal(capped.statusCode, 429, capped.body);
    const hashIp = '203.0.113.90';
    const { authIpHash } = await import('../../api/_lib/borrower.js');
    const hash = authIpHash(hashIp);
    for (let i = 0; i < 30; i++) {
      fake.db.q1_auth_attempts.push({
        id: 'qa_budget_' + i, borrower_id: null, kind: 'pin', ip_hash: hash, created_at: new Date().toISOString()
      });
    }
    const budget = await call(quik1, {
      method: 'POST', path: ['pin', 'reset'],
      headers: { 'x-forwarded-for': hashIp },
      body: { email: EMAIL }
    });
    assert.equal(budget.statusCode, 429, budget.body);
  });

  test('a locked account gets the generic body and no link', async () => {
    const borrower = await setPin();
    borrower.failed_attempts = 5;
    borrower.locked_at = new Date().toISOString();
    const res = await call(quik1, { method: 'POST', path: ['pin', 'reset'], body: { email: EMAIL } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().sent, true);
    assert.equal(sent.length, 0);
    assert.equal(fake.db.q1_otp_challenges.length, 0);
  });

  test('staff can still set a login PIN', async () => {
    delete process.env.QUIK1_EMAIL_FROM;
    delete process.env.QUIK1_EMAIL_API_URL;
    delete process.env.QUIK1_EMAIL_API_KEY;
    const set = await setPin();
    assert.equal(set.pin_hash.startsWith('scrypt$'), true);
    const logged = await call(quik1, {
      method: 'POST', path: ['login'],
      body: { accountRef: set.id, pin: PIN_OK }
    });
    assert.equal(logged.statusCode, 200, logged.body);
    assert.equal(logged.json().ok, true);
  });
});
