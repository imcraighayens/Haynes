// Borrower invites, PIN hashes, lockout, and the rule that a signed-out request
// cannot read a Ledger client's book.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { hashPin, verifyPin, hashPinForVerify, resetVerifyCalls, verifyCallCount, pinNotAcceptedMessage, QUIK1_PIN_LENGTH } from '../../api/_lib/pin.js';
import { accountFromLoans } from '../../api/_lib/quik1-book.js';
import { mintBorrowerToken, deviceCookie, DEVICE_MAX_AGE } from '../../api/_lib/quik1-session.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { setEmailSender } from '../../api/_lib/email.js';
import { authIpHash, deviceMatches, tempPinLimiter, TEMP_PIN_INVITE_LOCK } from '../../api/_lib/borrower.js';
import { mintStaffSession, staffCookieHeader, STAFF_COOKIE } from '../../api/_lib/auth.js';
import { decryptId, idHmac, phoneHmac, luhnOk } from '../../api/_lib/sa-id.js';

const UNLINKED = "This phone isn't linked yet. Please contact EcoLoans and we'll reset your access.";

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';

const CLIENT_A = 'c_book_a';
const CLIENT_B = 'c_book_b';
const NAME_A = 'Book Client A';
const NAME_B = 'Book Client B';
const PIN_OK = '24680';
const PIN_BAD = '13579';
const PIN_NEXT = '80246';
const SA_ID = '9912314800084';
const ID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HMAC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;
process.env.QUIK1_SESSION_SECRET = SECRET;

const seed = {
  clients: [
    { id: CLIENT_A, ref: 'EC-901', name: NAME_A, bank: 'Example Bank', deleted_at: null },
    { id: CLIENT_B, ref: 'EC-902', name: NAME_B, bank: 'Other Bank', deleted_at: null },
    { id: 'c_book_gone', ref: 'EC-904', name: 'Archived Client', bank: '', deleted_at: '2026-04-01T00:00:00.000Z' }
  ],
  loans: [
    { id: 'l_a_open', ref: 'ECL-901', client_id: CLIENT_A, principal: 2000, status: 'issued', schedule: ['2026-11-25'], instalment_amount: 2700, issued_on: '2026-10-25', deleted_at: null },
    { id: 'l_a_paid', ref: 'ECL-903', client_id: CLIENT_A, principal: 1000, status: 'paid', schedule: ['2026-07-25'], instalment_amount: 675, issued_on: '2026-05-25', deleted_at: null },
    { id: 'l_b_open', ref: 'ECL-902', client_id: CLIENT_B, principal: 1500, status: 'overdue', schedule: ['2026-11-25'], instalment_amount: 675, issued_on: '2026-08-25', deleted_at: null }
  ],
  q1_borrowers: [],
  q1_invites: [],
  q1_sessions: [],
  q1_devices: [],
  q1_otp_challenges: [],
  q1_auth_attempts: [],
  q1_temp_pin_sets: [],
  audit_log: []
};

const fake = createFakePostgrest(seed);
const quik1 = (await import('../../api/quik1.js')).default;
const ledger = (await import('../../api/ledger.js')).default;

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
async function call(handler, { method = 'GET', path = [], url, headers = {}, body, query = {}, sessionSecret = SECRET } = {}) {
  const req = {
    method,
    query: { path, ...query },
    url: url || '/api/' + path.join('/'),
    headers: { host: handler === ledger ? 'localhost' : 'quik1.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.' + (++ipSeq % 200), ...headers },
    body
  };
  const res = makeRes();
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.LEDGER_KEY = STAFF;
  if (sessionSecret === '') process.env.QUIK1_SESSION_SECRET = '';
  else if (sessionSecret) process.env.QUIK1_SESSION_SECRET = sessionSecret;
  else delete process.env.QUIK1_SESSION_SECRET;
  await handler(req, res);
  return res;
}

function staffHeaders() {
  return { authorization: 'Bearer ' + STAFF };
}

function enableBorrowerEmail() {
  process.env.QUIK1_EMAIL_FROM = 'quik1@example.com';
  process.env.QUIK1_EMAIL_API_URL = 'https://email.example.test/send';
  process.env.QUIK1_EMAIL_API_KEY = 'test-email-key';
}

function assertDeviceNotLinked(res) {
  assert.equal(res.statusCode, 403, res.body);
  const body = res.json();
  assert.equal(body.error, UNLINKED);
  assert.equal(body.code, 'device_not_linked');
  assert.equal(body.deviceNotLinked, true);
  assert.equal(body.verifyRequired, undefined);
  assert.equal(body.verifyToken, undefined);
  assert.equal(body.sent, undefined);
  assert.equal(body.contactStaff, undefined);
  assert.equal(/\bsent\b/i.test(res.body), false);
  assert.equal(res.headers['set-cookie'], undefined);
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw || ''];
  return list.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
}

function knownCookie(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw || '')];
  const hit = list.find(c => String(c).startsWith('q1_known='));
  return hit ? String(hit).split(';')[0] : '';
}

function sessionToken(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw || '')];
  const hit = list.find(c => String(c).startsWith('q1_session='));
  if (!hit) return '';
  return decodeURIComponent(String(hit).split(';')[0].slice('q1_session='.length));
}

let restore = () => {};
describe('borrower auth', { concurrency: false }, () => {
  beforeEach(() => {
    publicLimiter.reset();
    authLimiter.reset();
    tempPinLimiter.reset();
    setEmailSender(null);
    delete process.env.QUIK1_EMAIL_FROM;
    delete process.env.QUIK1_EMAIL_API_URL;
    delete process.env.QUIK1_EMAIL_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM;
    delete process.env.QUIK1_ID_KEY;
    delete process.env.QUIK1_ID_HMAC_KEY;
    fake.reset();
    process.env.QUIK1_BORROWER_PIN = '1';
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => { setEmailSender(null); restore(); restore = () => {}; });

  test('PIN hash verifies and does not keep the PIN', async () => {
    const stored = await hashPin(PIN_OK);
    assert.equal(stored.startsWith('scrypt$'), true);
    assert.equal(stored === PIN_OK, false);
    assert.equal(await verifyPin(PIN_OK, stored), true);
    assert.equal(await verifyPin(PIN_BAD, stored), false);
    assert.equal(await verifyPin('12', stored), false);
    assert.equal(await verifyPin('1234', stored), false);
    assert.equal(await verifyPin('12345', stored), false);
    assert.equal(await verifyPin('1234567', stored), false);
  });

  test('available credit ignores settled principal and the interest rate', () => {
    const acct = accountFromLoans(seed.loans.filter(l => l.client_id === CLIENT_A));
    assert.equal(acct.credit_limit, 2000);
    assert.equal(acct.outstanding_principal, 2000);
    assert.equal(acct.available, 0);
    assert.equal(acct.next_due, '2026-11-25');
    assert.equal(acct.loans.find(l => l.ref === 'ECL-903').outstanding_principal, 0);
  });

  test('staff can create, revoke, and reissue an invite; the code is stored only as a hash', async () => {
    const denied = await call(ledger, { method: 'POST', path: ['quik1-invites'], body: { clientId: CLIENT_A } });
    assert.equal(denied.statusCode, 401);

    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    const linkOk = typeof body.link === 'string' && /^https:\/\/localhost\/quik1\/#invite=[0-9a-f]{64}$/.test(body.link);
    assert.equal(linkOk, true);
    assert.equal(body.clientRef, 'EC-901');
    assert.equal(body.clientId, undefined);
    const code = body.link.split('invite=')[1];
    assert.equal(body.code, code);
    const row = fake.db.q1_invites[0];
    assert.equal(row.code, undefined);
    assert.equal(row.code_hash, createHash('sha256').update(code).digest('hex'));
    assert.equal(row.code_hash === code, false);

    const listed = await call(ledger, {
      method: 'GET', path: ['quik1-invites'], headers: staffHeaders(), query: { clientId: CLIENT_A }
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().invites[0].state, 'open');
    assert.equal(JSON.stringify(listed.json()).includes(code), false);

    const revoked = await call(ledger, {
      method: 'POST', path: ['quik1-invites', body.inviteId, 'revoke'], headers: staffHeaders(), body: {}
    });
    assert.equal(revoked.statusCode, 200);
    const stale = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(stale.statusCode, 410);

    const again = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(again.statusCode, 201);
    const code2 = again.json().code;
    const oldStill = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(oldStill.statusCode, 410);
    const fresh = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: code2, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(fresh.statusCode, 200);
    assert.match(fresh.json().accountRef, /^qb_[0-9a-f]{32}$/);
    const borrower = fake.db.q1_borrowers[0];
    assert.equal(borrower.client_id, CLIENT_A);
    assert.equal(borrower.pin_hash.startsWith('scrypt$'), true);
    assert.equal(borrower.pin_hash === PIN_OK, false);
    assert.equal(await verifyPin(PIN_OK, borrower.pin_hash), true);
    const cookies = fresh.headers['set-cookie'];
    const joined = Array.isArray(cookies) ? cookies.join('\n') : String(cookies);
    assert.match(joined, /HttpOnly/);
    assert.match(joined, /Secure/);
    assert.match(joined, /q1_session=/);
    const knownLine = (Array.isArray(cookies) ? cookies : [cookies]).find(c => String(c).startsWith('q1_known='));
    assert.match(String(knownLine), /HttpOnly/);
    assert.match(String(knownLine), /Secure/);
    assert.match(String(knownLine), /SameSite=Lax/);
    assert.match(String(knownLine), /Max-Age=7776000/);
    assert.equal(joined.includes(PIN_OK), false);
  });

  test('an expired invite cannot be redeemed', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const code = created.json().code;
    fake.db.q1_invites[0].expires_at = '2020-01-01T00:00:00.000Z';
    const res = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(res.statusCode, 410);
    assert.equal(fake.db.q1_borrowers.length, 0);
  });

  test('mismatched PINs do not consume the invite', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const res = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_BAD }
    });
    assert.equal(res.statusCode, 400);
    assert.equal(fake.db.q1_invites[0].redeemed_at == null, true);
  });

  test('five failures lock the account until a new invite sets a new PIN', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const device = { cookie: knownCookie(redeemed) };
    assert.match(device.cookie, /^q1_known=[0-9a-f]{64}$/);
    for (let i = 0; i < 4; i++) {
      const miss = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_BAD } });
      assert.equal(miss.statusCode, 401);
    }
    const locked = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_BAD } });
    assert.equal(locked.statusCode, 423);
    const still = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_OK } });
    assert.equal(still.statusCode, 423);
    assert.equal(JSON.stringify(still.json()).includes(PIN_OK), false);

    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const oldPin = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_OK } });
    assert.equal(oldPin.statusCode, 423);
    const again = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: reset.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(again.statusCode, 200);
    const back = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(again) }, body: { accountRef, pin: PIN_NEXT }
    });
    assert.equal(back.statusCode, 200);
    const previous = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(again) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(previous.statusCode, 401);
  });

  test('a signed-out request cannot read a Ledger client, and a session sees only its own book', async () => {
    const anon = await call(quik1, { method: 'GET', path: ['me'] });
    assert.equal(anon.statusCode, 401);
    assert.equal(JSON.stringify(anon.json()).includes(NAME_A), false);
    assert.equal(JSON.stringify(anon.json()).includes(NAME_B), false);
    const loans = await call(quik1, { method: 'GET', path: ['loans'] });
    assert.equal(loans.statusCode, 401);
    const avail = await call(quik1, { method: 'GET', path: ['available', 'ap_0123456789ab'] });
    assert.equal(avail.statusCode, 401);
    const ident = await call(quik1, { method: 'POST', path: ['identity'], body: { idNumber: SA_ID } });
    assert.equal(ident.statusCode, 401);
    assert.equal(ident.body.includes(SA_ID), false);

    const missing = await call(quik1, { method: 'GET', path: ['clients', CLIENT_A] });
    assert.equal(missing.statusCode, 404);
    assert.equal(JSON.stringify(missing.json()).includes(NAME_A), false);

    const staffBook = await call(ledger, { method: 'GET', path: ['state'] });
    assert.equal(staffBook.statusCode, 401);

    const inviteA = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const inviteB = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_B }
    });
    const signA = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: inviteA.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: inviteB.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    const homeA = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(signA) } });
    assert.equal(homeA.statusCode, 200);
    assert.equal(homeA.json().identified, true);
    assert.equal(homeA.json().profile.name, NAME_A);
    assert.equal(homeA.json().profile.ref, 'EC-901');
    assert.equal(homeA.json().account.outstanding_principal, 2000);
    assert.equal(JSON.stringify(homeA.json()).includes(NAME_B), false);
    assert.equal(homeA.json().client_id, undefined);
    assert.equal(JSON.stringify(homeA.json()).includes(PIN_OK), false);

    const forged = mintBorrowerToken({
      sid: fake.db.q1_sessions.find(s => s.client_id === CLIENT_A).id,
      bid: signA.json().accountRef,
      cid: CLIENT_B
    });
    const crossed = await call(quik1, {
      method: 'GET', path: ['me'], headers: { cookie: 'q1_session=' + encodeURIComponent(forged.token) }
    });
    assert.equal(crossed.statusCode, 401);
    assert.equal(JSON.stringify(crossed.json()).includes(NAME_A), false);
    assert.equal(JSON.stringify(crossed.json()).includes(NAME_B), false);
  });

  test('staff invite, client PIN, sign-in, then revoke access', async () => {
    const none = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(none.statusCode, 200);
    assert.equal(none.json().ready, true);
    assert.equal(none.json().access, 'none');
    assert.equal(none.json().accessLabel, 'No access');

    const anonInvite = await call(ledger, { method: 'POST', path: ['quik1-invites'], body: { clientId: CLIENT_A } });
    assert.equal(anonInvite.statusCode, 401);

    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 201);
    const ttl = new Date(created.json().expiresAt).getTime() - Date.now();
    assert.equal(ttl > 71 * 3600 * 1000 && ttl < 73 * 3600 * 1000, true);
    assert.match(created.json().link, /#invite=[0-9a-f]{64}$/);
    const invited = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(invited.json().access, 'invited');
    assert.equal(invited.json().accessLabel, 'Invited');
    assert.equal(JSON.stringify(invited.json()).includes(created.json().code), false);

    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(redeemed.statusCode, 200);
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(redeemed) } });
    assert.equal(home.json().identified, true);
    assert.equal(home.json().profile.name, NAME_A);
    const pinSet = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(pinSet.json().access, 'pin');
    assert.equal(pinSet.json().accessLabel, 'PIN set');

    const anonRevoke = await call(ledger, {
      method: 'POST', path: ['quik1-invites', 'revoke-access'], body: { clientId: CLIENT_A }
    });
    assert.equal(anonRevoke.statusCode, 401);

    const revoked = await call(ledger, {
      method: 'POST', path: ['quik1-invites', 'revoke-access'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(revoked.statusCode, 200);
    assert.equal(revoked.json().access, 'revoked');
    assert.equal(revoked.json().accessLabel, 'Revoked');
    assert.equal(JSON.stringify(revoked.json()).includes(PIN_OK), false);
    const signedOut = await call(quik1, {
      method: 'POST', path: ['login'], body: { accountRef: redeemed.json().accountRef, pin: PIN_OK }
    });
    assert.equal(signedOut.statusCode, 423);
    const stale = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { code: created.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(stale.statusCode, 410);
  });

  test('missing borrower tables tell staff Quik1 access is not set up', async () => {
    delete fake.db.q1_borrowers;
    delete fake.db.q1_invites;
    delete fake.db.q1_sessions;
    const listed = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(listed.statusCode, 200);
    assert.equal(listed.json().ready, false);
    assert.equal(listed.json().accessLabel, 'Quik1 access not set up yet');
    assert.equal(JSON.stringify(listed.json()).includes(NAME_A), false);
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 503);
    assert.equal(created.json().error, 'Quik1 access not set up yet');
    const revoked = await call(ledger, {
      method: 'POST', path: ['quik1-invites', 'revoke-access'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(revoked.statusCode, 503);
    assert.equal(revoked.json().error, 'Quik1 access not set up yet');
  });

  test('borrower routes do not look up an ID number', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const src = fs.readFileSync(path.join(root, 'api/_lib/borrower.js'), 'utf8');
    const page = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
    assert.equal(src.includes('id_number'), false);
    assert.equal(page.includes('first four digits of your ID number'), false);
  });

  test('redeem refuses to run without the session secret', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    delete process.env.QUIK1_SESSION_SECRET;
    const res = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK },
      sessionSecret: ''
    });
    process.env.QUIK1_SESSION_SECRET = SECRET;
    assert.equal(res.statusCode, 503);
  });

  test('an invite created on the staff host opens on the borrower site', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'],
      headers: { ...staffHeaders(), host: 'quik1ledger.com' },
      body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.match(created.json().link, /^https:\/\/quik1\.app\/quik1\/#invite=[0-9a-f]{64}$/);
  });

  test('borrower PIN follows the flag, and production also needs both ID keys', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const code = created.json().code;
    const redeem = (headers, sessionSecret = SECRET) => call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], headers, sessionSecret,
      body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const login = headers => call(quik1, {
      method: 'POST', path: ['login'], headers,
      body: { accountRef: 'qb_' + 'a'.repeat(32), pin: PIN_OK }
    });
    try {
      delete process.env.QUIK1_BORROWER_PIN;
      delete process.env.VERCEL_ENV;
      delete process.env.QUIK1_ID_KEY;
      delete process.env.QUIK1_ID_HMAC_KEY;
      const noFlagHost = await redeem({ host: 'quik1.app' });
      const noFlagLogin = await login({ host: 'quik1.app' });
      process.env.VERCEL_ENV = 'production';
      const noFlagEnv = await redeem({ host: 'preview.example' });
      delete process.env.VERCEL_ENV;
      for (const res of [noFlagHost, noFlagLogin, noFlagEnv]) {
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().error, 'Sign-in is not available');
      }

      process.env.QUIK1_BORROWER_PIN = '1';
      const missingSecret = await redeem({ host: 'preview.example' }, null);
      const emptySecret = await redeem({ host: 'preview.example' }, '');
      assert.equal(missingSecret.statusCode, 503);
      assert.equal(emptySecret.statusCode, 503);
      assert.equal(emptySecret.json().error, 'Sign-in is not available');

      const prodNoId = await redeem({ host: 'quik1.app' });
      process.env.QUIK1_ID_KEY = ID_KEY;
      const prodNoHmac = await redeem({ host: 'www.quik1.app' });
      delete process.env.QUIK1_ID_KEY;
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
      process.env.VERCEL_ENV = 'production';
      const prodEnvNoId = await redeem({ host: 'preview.example' });
      delete process.env.VERCEL_ENV;
      delete process.env.QUIK1_ID_HMAC_KEY;
      for (const res of [prodNoId, prodNoHmac, prodEnvNoId]) {
        assert.equal(res.statusCode, 503);
        assert.equal(res.json().error, 'Sign-in is not available');
      }
      assert.equal(fake.db.q1_borrowers.length, 0);

      for (const host of ['quik1ledger.com', 'www.quik1ledger.com']) {
        const blocked = await redeem({ host });
        assert.equal(blocked.statusCode, 404, host);
      }

      const preview = await redeem({ host: 'preview.example' });
      assert.equal(preview.statusCode, 200, preview.body);
      assert.equal(fake.db.q1_borrowers.length, 1);
      assert.equal(JSON.stringify(preview.json()).includes(PIN_OK), false);

      const again = await call(ledger, {
        method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
      });
      process.env.QUIK1_ID_KEY = ID_KEY;
      process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
      const prod = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'],
        headers: { host: 'quik1.app' },
        body: { code: again.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(prod.statusCode, 200, prod.body);
      assert.equal(String(fake.db.q1_borrowers[0].pin_hash).startsWith('scrypt$'), true);
      assert.equal(JSON.stringify(prod.json()).includes(PIN_NEXT), false);
    } finally {
      delete process.env.VERCEL_ENV;
      delete process.env.QUIK1_ID_KEY;
      delete process.env.QUIK1_ID_HMAC_KEY;
      process.env.QUIK1_BORROWER_PIN = '1';
      process.env.QUIK1_SESSION_SECRET = SECRET;
    }
  });

  test('a lock expires after the cooldown and a new invite still resets it immediately', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const device = { cookie: knownCookie(redeemed) };
    for (let i = 0; i < 5; i++) {
      await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_BAD } });
    }
    const held = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_OK } });
    assert.equal(held.statusCode, 423);
    fake.db.q1_borrowers[0].locked_at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const cooled = await call(quik1, { method: 'POST', path: ['login'], headers: device, body: { accountRef, pin: PIN_OK } });
    assert.equal(cooled.statusCode, 200, cooled.body);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts, 0);
    assert.equal(fake.db.q1_borrowers[0].locked_at, null);
  });

  test('an unrecognised device uses an email link, and an unconfigured sender asks for staff', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
    process.env.TWILIO_ACCOUNT_SID = 'AC-staff';
    process.env.TWILIO_AUTH_TOKEN = 'staff-token';
    process.env.TWILIO_FROM = '+10000000000';
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const sessions = fake.db.q1_sessions.length;
    const sent = [];
    setEmailSender({
      enabled: true,
      async send(to, subject, text) { sent.push({ to, subject, text }); return { sent: true }; }
    });
    const quiet = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assertDeviceNotLinked(quiet);
    assert.equal(quiet.body.includes(PIN_OK), false);
    assert.equal(sent.length, 0);
    assert.equal(fake.db.q1_otp_challenges.length, 0);
    assert.equal(fake.db.q1_sessions.length, sessions);
    const forced = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: '1.nope' }
    });
    assert.equal(forced.statusCode, 401);

    enableBorrowerEmail();
    setEmailSender({
      enabled: true,
      async send(to, subject, text) { sent.push({ to, subject, text }); return { sent: true }; }
    });
    const fresh = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(fresh.statusCode, 200, fresh.body);
    assert.equal(fresh.json().contactStaff, false);
    assert.equal(typeof fresh.json().verifyToken, 'string');
    assert.equal(sent.length, 0);
    const issued = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: fresh.json().verifyToken }
    });
    assert.equal(issued.statusCode, 200, issued.body);
    assert.equal(issued.json().sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'book@example.com');
    assert.match(sent[0].text, /expires in 15 minutes/);
    const token = (sent[0].text.match(/#verify=([0-9a-f]{64})/) || [])[1];
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(issued.body.includes(token), false);
    const challenge = fake.db.q1_otp_challenges.find(row => !row.consumed_at);
    assert.equal(challenge.token_hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(challenge.token_hash === token, false);
    assert.equal(JSON.stringify(challenge).includes(token), false);
    const pending = (Array.isArray(issued.headers['set-cookie']) ? issued.headers['set-cookie'] : [issued.headers['set-cookie']])
      .find(c => String(c).startsWith('q1_pending='));
    const pendingHeader = String(pending).split(';')[0];
    const wrongDevice = await call(quik1, { method: 'POST', path: ['verify', 'email'], body: { token } });
    assert.equal(wrongDevice.statusCode, 401);
    const good = await call(quik1, {
      method: 'POST', path: ['verify', 'email'], headers: { cookie: pendingHeader }, body: { token }
    });
    assert.equal(good.statusCode, 200, good.body);
    assert.match(knownCookie(good), /^q1_known=/);
    assert.equal(good.body.includes(token), false);
    const replay = await call(quik1, {
      method: 'POST', path: ['verify', 'email'], headers: { cookie: pendingHeader }, body: { token }
    });
    assert.equal(replay.statusCode, 401);
    const oldKnown = knownCookie(redeemed);
    const rotated = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(good) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(rotated.statusCode, 200, rotated.body);
    assert.equal(rotated.json().verifyRequired, undefined);
    assert.notEqual(knownCookie(rotated), knownCookie(good));
    const stale = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(good) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(stale.json().verifyRequired, true);
    const out = await call(quik1, {
      method: 'POST', path: ['logout'], headers: { cookie: knownCookie(rotated) }
    });
    assert.match(String(out.headers['set-cookie']), /q1_known=;/);
    const afterOut = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(rotated) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(afterOut.json().verifyRequired, true);
    assert.equal(oldKnown.length > 0, true);
  });

  test('logout revokes the device when the session table is missing', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    const session = sessionToken(redeemed);
    const known = knownCookie(redeemed);
    assert.match(session, /\./);
    assert.match(known, /^q1_known=/);
    assert.equal(fake.db.q1_devices.some(row => !row.revoked_at), true);
    delete fake.db.q1_sessions;
    const out = await call(quik1, {
      method: 'POST', path: ['logout'],
      headers: { cookie: 'q1_session=' + encodeURIComponent(session) + '; ' + known }
    });
    assert.equal(out.statusCode, 200, out.body);
    assert.equal(fake.db.q1_devices.every(row => row.revoked_at), true);
    assert.match(String(out.headers['set-cookie']), /q1_known=;/);
    assert.match(String(out.headers['set-cookie']), /q1_session=/);
  });

  test('a signed-in borrower can store an SA ID encrypted, and the client only sees a mask', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const session = { cookie: cookieHeader(redeemed) };
    const unsigned = await call(quik1, { method: 'POST', path: ['identity'], body: { idNumber: SA_ID } });
    assert.equal(unsigned.statusCode, 401);
    assert.equal(unsigned.body.includes(SA_ID), false);

    const missingKey = await call(quik1, { method: 'POST', path: ['identity'], headers: session, body: { idNumber: SA_ID } });
    assert.equal(missingKey.statusCode, 503);
    assert.equal(missingKey.body.includes(SA_ID), false);
    assert.equal(fake.db.q1_borrowers[0].id_ciphertext, undefined);

    process.env.QUIK1_ID_KEY = ID_KEY;
    const noHmac = await call(quik1, { method: 'POST', path: ['identity'], headers: session, body: { idNumber: SA_ID } });
    assert.equal(noHmac.statusCode, 503);
    assert.match(noHmac.json().error, /ID storage is not configured/);
    assert.equal(noHmac.body.includes(SA_ID), false);
    assert.equal(fake.db.q1_borrowers[0].id_ciphertext, undefined);
    assert.equal(fake.db.q1_borrowers[0].id_hmac, undefined);
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    const badId = '9912314800085';
    const bad = await call(quik1, { method: 'POST', path: ['identity'], headers: session, body: { idNumber: badId } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.body.includes(badId), false);

    const saved = await call(quik1, { method: 'POST', path: ['identity'], headers: session, body: { idNumber: SA_ID } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().idMasked, '*********0084');
    assert.equal(saved.body.includes(SA_ID), false);
    const stored = fake.db.q1_borrowers[0].id_ciphertext;
    assert.match(stored, /^v1\./);
    assert.equal(stored.includes(SA_ID), false);
    assert.equal(decryptId(stored, redeemed.json().accountRef), SA_ID);
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: session });
    assert.equal(home.statusCode, 200);
    assert.equal(home.json().profile.idMasked, '*********0084');
    assert.equal(home.body.includes(SA_ID), false);
    assert.equal(home.body.includes(stored), false);
    delete process.env.QUIK1_ID_KEY;
    delete process.env.QUIK1_ID_HMAC_KEY;
    assert.equal(decryptId(stored, redeemed.json().accountRef), '');
  });

  test('auth attempts from one address are rate limited', async () => {
    process.env.QUIK1_AUTH_RATE_LIMIT = '3';
    authLimiter.reset();
    const ip = { 'x-forwarded-for': '198.51.100.77' };
    for (let i = 0; i < 3; i++) {
      const res = await call(quik1, { method: 'POST', path: ['login'], headers: ip, body: { pin: 'nope' } });
      assert.equal(res.statusCode, 401);
    }
    const blocked = await call(quik1, { method: 'POST', path: ['login'], headers: ip, body: { pin: PIN_BAD } });
    delete process.env.QUIK1_AUTH_RATE_LIMIT;
    authLimiter.reset();
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.body.includes(PIN_BAD), false);

    const hash = authIpHash('203.0.113.50');
    for (let i = 0; i < 30; i++) {
      fake.db.q1_auth_attempts.push({
        id: 'qa_seed_' + i,
        borrower_id: null,
        kind: 'pin',
        ip_hash: hash,
        created_at: new Date().toISOString()
      });
    }
    const persisted = await call(quik1, {
      method: 'POST', path: ['login'],
      headers: { 'x-forwarded-for': '203.0.113.50' },
      body: { accountRef: 'qb_' + 'ab'.repeat(16), pin: PIN_BAD }
    });
    assert.equal(persisted.statusCode, 429);
    assert.equal(persisted.body.includes(PIN_BAD), false);
  });

  test('weak PINs are refused, and an older stored PIN does not sign in until staff reset it', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const weakPin = '1'.repeat(QUIK1_PIN_LENGTH);
    const weak = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: weakPin, pinConfirm: weakPin }
    });
    assert.equal(weak.statusCode, 400);
    assert.equal(fake.db.q1_borrowers.length, 0);
    const again = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: again.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const legacy = '2'.repeat(QUIK1_PIN_LENGTH + 1);
    const legacyHash = await hashPinForVerify(legacy);
    fake.db.q1_borrowers[0].pin_hash = legacyHash;
    const accountRef = redeemed.json().accountRef;
    assert.equal(await verifyPin(PIN_OK, legacyHash), false);
    const oldShape = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(redeemed) }, body: { accountRef, pin: legacy }
    });
    assert.equal(oldShape.statusCode, 400, oldShape.body);
    const missed = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(redeemed) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(missed.statusCode, 401, missed.body);
    assert.equal(missed.json().error, pinNotAcceptedMessage());
    assert.equal(fake.db.q1_borrowers[0].pin_hash, legacyHash);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const upgraded = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: reset.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(upgraded.statusCode, 200, upgraded.body);
    assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(legacy, fake.db.q1_borrowers[0].pin_hash), false);
    assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), false);
  });

  test('email links share a resend cooldown and an hourly cap', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
    enableBorrowerEmail();
    setEmailSender({ enabled: true, async send() { return { sent: true }; } });
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const first = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    const sent = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: first.json().verifyToken }
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const secondLogin = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    const soon = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: secondLogin.json().verifyToken }
    });
    assert.equal(soon.statusCode, 429);
    fake.db.q1_otp_challenges.forEach(row => { row.created_at = new Date(Date.now() - 2 * 60 * 1000).toISOString(); });
    process.env.QUIK1_VERIFY_HOURLY_CAP = '1';
    const cappedLogin = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    const capped = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: cappedLogin.json().verifyToken }
    });
    delete process.env.QUIK1_VERIFY_HOURLY_CAP;
    assert.equal(capped.statusCode, 429);
  });

  test('a missing attempt log fails closed, and staff can reset a device', async () => {
    delete fake.db.q1_auth_attempts;
    const closed = await call(quik1, { method: 'POST', path: ['login'], body: { pin: PIN_BAD } });
    assert.equal(closed.statusCode, 503);
    fake.db.q1_auth_attempts = [];
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const denied = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], body: { clientId: CLIENT_A }
    });
    assert.equal(denied.statusCode, 401);
    const borrowerHost = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'],
      headers: { ...staffHeaders(), host: 'quik1.app' },
      body: { clientId: CLIENT_A }
    });
    assert.equal(borrowerHost.statusCode, 404);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'],
      headers: { ...staffHeaders(), host: 'quik1ledger.com' },
      body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(fake.db.q1_devices.every(row => row.revoked_at), true);
    assert.equal(fake.db.q1_sessions.every(row => row.revoked_at), true);
    assert.equal(fake.db.audit_log.some(row => row.type === 'QUIK1 DEVICE RESET' && row.ref === 'EC-901'), true);
    assert.equal(JSON.stringify(fake.db.audit_log).includes(PIN_OK), false);
    const oldHome = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(redeemed) } });
    assert.equal(oldHome.statusCode, 401);
  });

  test('a device reset trusts one new phone on the next correct PIN', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const pinHash = fake.db.q1_borrowers[0].pin_hash;
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(redeemed) } });
    assert.equal(home.statusCode, 200);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'],
      headers: staffHeaders(),
      body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    const until = new Date(fake.db.q1_borrowers[0].device_reset_until).getTime();
    assert.ok(until > Date.now() + 23 * 3600 * 1000 && until < Date.now() + 25 * 3600 * 1000);
    const closed = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(redeemed) } });
    assert.equal(closed.statusCode, 401);
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until != null, true);
    const next = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().verifyRequired, undefined);
    assert.match(knownCookie(next), /^q1_known=/);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
    const second = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assertDeviceNotLinked(second);
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() - 60 * 1000).toISOString();
    const expired = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assertDeviceNotLinked(expired);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until != null, true);
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() + 3600 * 1000).toISOString();
    fake.db.q1_borrowers[0].locked_at = new Date().toISOString();
    fake.db.q1_borrowers[0].failed_attempts = 5;
    const locked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(locked.statusCode, 423);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until != null, true);
    const note = fake.db.audit_log.find(row => row.type === 'QUIK1 DEVICE RESET').comment;
    assert.match(note, /session/i);
    assert.match(note, /24 hours/);
  });

  test('two new phones cannot both claim one device reset', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const accountRef = redeemed.json().accountRef;
    const [a, b] = await Promise.all([
      call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } }),
      call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } })
    ]);
    const wins = [a, b].filter(res => res.statusCode === 200 && res.json().ok === true);
    assert.equal(wins.length, 1);
    const lost = [a, b].filter(res => res.statusCode === 403);
    assert.equal(lost.length, 1);
    assert.equal(lost[0].json().code, 'device_not_linked');
    assert.equal(lost[0].json().deviceNotLinked, true);
    assert.equal(fake.db.q1_devices.filter(row => !row.revoked_at).length, 1);
    assert.equal(fake.db.q1_sessions.filter(row => !row.revoked_at).length, 1);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
  });

  test('a device reset uses the email link when email is configured', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
    enableBorrowerEmail();
    setEmailSender({ enabled: true, async send() { return { sent: true }; } });
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const pinHash = fake.db.q1_borrowers[0].pin_hash;
    await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
    assert.equal(fake.db.q1_sessions.every(row => row.revoked_at), true);
    const accountRef = redeemed.json().accountRef;
    const next = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().verifyRequired, true);
    assert.equal(next.json().contactStaff, false);
    assert.equal(typeof next.json().verifyToken, 'string');
    assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() + 3600 * 1000).toISOString();
    const still = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(still.json().verifyRequired, true);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until != null, true);
    const note = fake.db.audit_log.find(row => row.type === 'QUIK1 DEVICE RESET').comment;
    assert.match(note, /session/i);
    assert.match(note, /email link/);
  });

  test('a new invite clears the device-reset flag', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(fake.db.q1_borrowers[0].device_reset_until != null, true);
    const invite = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() + 3600 * 1000).toISOString();
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invite.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
  });

  test('email off, an unknown account matches a wrong PIN, and only a correct PIN on a new device is device_not_linked', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const sends = [];
    setEmailSender({
      enabled: true,
      async send(to, subject, text) { sends.push({ to, subject, text }); return { sent: true }; }
    });
    const sessions = fake.db.q1_sessions.length;
    const challenges = fake.db.q1_otp_challenges.length;
    await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: 'qb_' + '11'.repeat(16), pin: PIN_OK } });
    const unknownRef = 'qb_' + 'cd'.repeat(16);
    const started = process.hrtime.bigint();
    const unknown = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: unknownRef, pin: PIN_OK } });
    const mid = process.hrtime.bigint();
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    const ended = process.hrtime.bigint();
    assert.equal(unknown.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(unknown.json(), { error: pinNotAcceptedMessage() });
    assert.deepEqual(wrong.json(), unknown.json());
    assert.equal(unknown.headers['set-cookie'], undefined);
    assert.equal(wrong.headers['set-cookie'], undefined);
    const unknownMs = Number(mid - started) / 1e6;
    const wrongMs = Number(ended - mid) / 1e6;
    const ratio = Math.max(unknownMs, wrongMs) / Math.max(1, Math.min(unknownMs, wrongMs));
    assert.ok(ratio < 4, `unknown ${unknownMs.toFixed(1)}ms vs wrong PIN ${wrongMs.toFixed(1)}ms`);
    const fresh = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assertDeviceNotLinked(fresh);
    assert.equal(sends.length, 0);
    assert.equal(fake.db.q1_otp_challenges.length, challenges);
    assert.equal(fake.db.q1_sessions.length, sessions);
    assert.equal(JSON.stringify(fake.db.q1_otp_challenges).includes('token'), false);

    const linked = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(redeemed) }, body: { accountRef, pin: PIN_OK }
    });
    assert.equal(linked.statusCode, 200, linked.body);
    assert.equal(linked.json().ok, true);
    assert.equal(linked.json().accountRef, accountRef);
    assert.equal(linked.json().deviceNotLinked, undefined);
    assert.match(knownCookie(linked), /^q1_known=/);
    assert.equal(sends.length, 0);

    enableBorrowerEmail();
    process.env.QUIK1_ID_KEY = ID_KEY;
    process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
    const production = await call(quik1, {
      method: 'POST', path: ['login'],
      headers: { host: 'quik1.app' },
      body: { accountRef, pin: PIN_OK }
    });
    delete process.env.QUIK1_ID_KEY;
    delete process.env.QUIK1_ID_HMAC_KEY;
    assertDeviceNotLinked(production);
    assert.equal(sends.length, 0);
    assert.equal(fake.db.q1_otp_challenges.length, challenges);
  });

  test('email on, a new device still receives the link', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
    enableBorrowerEmail();
    const sent = [];
    setEmailSender({
      enabled: true,
      async send(to, subject, text) { sent.push({ to, subject, text }); return { sent: true }; }
    });
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const accountRef = redeemed.json().accountRef;
    const unknown = await call(quik1, {
      method: 'POST', path: ['login'], body: { accountRef: 'qb_' + 'ef'.repeat(16), pin: PIN_OK }
    });
    assert.equal(unknown.statusCode, 401);
    assert.equal(unknown.json().error, pinNotAcceptedMessage());
    assert.equal(unknown.json().deviceNotLinked, undefined);
    const fresh = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(fresh.statusCode, 200, fresh.body);
    assert.equal(fresh.json().verifyRequired, true);
    assert.equal(fresh.json().contactStaff, false);
    assert.equal(typeof fresh.json().verifyToken, 'string');
    assert.equal(sent.length, 0);
    const issued = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: fresh.json().verifyToken }
    });
    assert.equal(issued.statusCode, 200, issued.body);
    assert.equal(issued.json().sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'book@example.com');
    assert.match(sent[0].text, /#verify=[0-9a-f]{64}/);
    assert.equal(fake.db.q1_otp_challenges.some(row => !row.consumed_at), true);
  });

  test('the Quik1 screen renders the unlinked copy from the deviceNotLinked flag', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const page = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
    const flagAt = page.indexOf('j.deviceNotLinked===true');
    assert.ok(flagAt > 0);
    const branch = page.slice(flagAt, flagAt + 700);
    assert.equal(branch.includes(UNLINKED), true);
    assert.equal(/check your email/i.test(branch), false);
    assert.equal(/we sent/i.test(branch), false);
    assert.equal(/\bsent\b/i.test(branch), false);
    assert.match(page, /pinPhase==='unlinked'\?"This phone isn't linked yet"/);
    assert.match(page, /pinPhase==='unlinked'\s*\?\s*"Please contact EcoLoans and we'll reset your access\."/);
    assert.equal(page.includes("pinPhase==='email'?'Check your email'"), true);
  });

  test('borrower B cannot consume borrower A’s device-reset flag', async () => {
    const inviteA = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemedA = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: inviteA.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const inviteB = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_B }
    });
    const redeemedB = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: inviteB.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    const refA = redeemedA.json().accountRef;
    const refB = redeemedB.json().accountRef;
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    const row = id => fake.db.q1_borrowers.find(borrower => borrower.id === id);
    const flagA = row(refA).device_reset_until;
    assert.ok(flagA);
    assert.ok(!row(refB).device_reset_until);

    const wrongPin = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: refB, pin: PIN_OK } });
    assert.equal(wrongPin.statusCode, 401);
    assert.equal(wrongPin.body.includes(PIN_OK), false);
    assert.equal(row(refA).device_reset_until, flagA);

    const asB = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: refB, pin: PIN_NEXT } });
    assert.equal(asB.statusCode, 403, asB.body);
    assert.equal(asB.json().code, 'device_not_linked');
    assert.equal(asB.json().verifyToken, undefined);
    assert.equal(cookieHeader(asB).includes('q1_session='), false);
    assert.equal(row(refA).device_reset_until, flagA);
    assert.ok(!row(refB).device_reset_until);

    const sameInvite = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_B }
    });
    const sameRedeem = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      body: { code: sameInvite.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(sameRedeem.statusCode, 200, sameRedeem.body);
    assert.equal(row(refA).device_reset_until, flagA);
    const samePin = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: refB, pin: PIN_OK } });
    assert.equal(samePin.statusCode, 403, samePin.body);
    assert.equal(samePin.json().code, 'device_not_linked');
    assert.equal(samePin.json().verifyToken, undefined);
    assert.equal(cookieHeader(samePin).includes('q1_session='), false);
    assert.equal(row(refA).device_reset_until, flagA);

    const claimed = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef: refA, pin: PIN_OK } });
    assert.equal(claimed.statusCode, 200, claimed.body);
    assert.equal(claimed.json().verifyRequired, undefined);
    assert.match(knownCookie(claimed), /^q1_known=/);
    assert.equal(row(refA).device_reset_until, null);
    assert.equal(claimed.json().accountRef, refA);
  });

  test('email and PIN flags stay unset in the example env', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const env = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    const src = fs.readFileSync(path.join(root, 'api/_lib/borrower.js'), 'utf8');
    assert.doesNotMatch(env, /^QUIK1_EMAIL_API_KEY=\S/m);
    assert.doesNotMatch(env, /^QUIK1_BORROWER_PIN=1/m);
    assert.doesNotMatch(env, /QUIK1_SMS/);
    assert.match(env, /^# QUIK1_EMAIL_FROM=/m);
    assert.match(env, /^# QUIK1_ID_KEY=/m);
    assert.equal(src.includes('sms.js'), false);
    assert.equal(src.includes('TWILIO_'), false);
  });

  test('verify routes are rate limited before the link is checked', async () => {
    process.env.QUIK1_AUTH_RATE_LIMIT = '3';
    authLimiter.reset();
    const ip = { 'x-forwarded-for': '198.51.100.21' };
    try {
      for (let i = 0; i < 3; i++) {
        const res = await call(quik1, { method: 'POST', path: ['verify'], headers: ip, body: {} });
        assert.notEqual(res.statusCode, 429);
      }
      const blocked = await call(quik1, { method: 'POST', path: ['verify'], headers: ip, body: {} });
      assert.equal(blocked.statusCode, 429);
      const emailIp = { 'x-forwarded-for': '198.51.100.22' };
      authLimiter.reset();
      for (let i = 0; i < 3; i++) {
        const res = await call(quik1, { method: 'POST', path: ['verify', 'email'], headers: emailIp, body: { token: 'ab'.repeat(32) } });
        assert.notEqual(res.statusCode, 429);
      }
      const blockedEmail = await call(quik1, { method: 'POST', path: ['verify', 'email'], headers: emailIp, body: { token: 'cd'.repeat(32) } });
      assert.equal(blockedEmail.statusCode, 429);
    } finally {
      delete process.env.QUIK1_AUTH_RATE_LIMIT;
      authLimiter.reset();
    }
  });

  test('the magic-link hash is cleared before the token is posted', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
    const start = quik.indexOf("const link=/^#verify=");
    const strip = quik.indexOf('history.replaceState', start);
    const post = quik.indexOf('this.consumeEmailLink(token)', start);
    assert.ok(start > 0 && strip > start && post > strip);
    assert.equal(quik.includes('keepSms'), false);
    assert.equal(quik.includes("pinPhase==='sms'"), false);
  });

  test('device match uses a length-safe compare and the device cookie lasts 90 days', () => {
    const token = 'ab'.repeat(32);
    const hash = createHash('sha256').update(token, 'utf8').digest('hex');
    const req = { headers: { cookie: 'q1_pending=' + token } };
    assert.equal(deviceMatches(req, { device_hash: hash }), true);
    assert.equal(deviceMatches(req, { device_hash: '0'.repeat(64) }), false);
    assert.equal(deviceMatches(req, { device_hash: 'abc' }), false);
    assert.equal(deviceMatches(req, { device_hash: '' }), false);
    const baked = deviceCookie('qb_' + 'cd'.repeat(16), true);
    assert.match(baked, new RegExp('Max-Age=' + DEVICE_MAX_AGE + '(;|$)'));
    assert.equal(DEVICE_MAX_AGE, 90 * 24 * 3600);
    assert.equal(baked.includes('Max-Age=34560000'), false);
  });
  const LOGIN_PIN = '86420';

  function pinChangeCookie(res) {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [String(raw || '')];
    const hit = list.find(c => String(c).startsWith('q1_pin_change='));
    return hit ? String(hit).split(';')[0] : '';
  }

  function rawCookies(res) {
    return String(res.headers['set-cookie'] || '');
  }

  function silence() {
    const lines = [];
    const orig = {};
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
      orig[m] = console[m];
      console[m] = (...args) => {
        lines.push(args.map(a => { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); } }).join(' '));
      };
    }
    return { lines, restore() { Object.keys(orig).forEach(m => { console[m] = orig[m]; }); } };
  }

  function assertNoPin(text, pin) {
    assert.equal(String(text).includes(pin), false);
  }

  async function setLogin(clientId, pin = LOGIN_PIN, headers = staffHeaders()) {
    return call(ledger, {
      method: 'POST', path: ['quik1-temp-pin'], headers, body: { clientId, pin, pinConfirm: pin }
    });
  }

  async function withClock(at, fn) {
    const RealDate = Date;
    class Shifted extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(at);
        else super(...args);
      }
      static now() { return at; }
    }
    globalThis.Date = Shifted;
    try { return await fn(); }
    finally { globalThis.Date = RealDate; }
  }

  test('login PIN rules match the borrower PIN rules', async () => {
    const ascending = Array.from({ length: QUIK1_PIN_LENGTH }, (_, i) => String((i + 1) % 10)).join('');
    const descending = Array.from({ length: QUIK1_PIN_LENGTH }, (_, i) => String((9 - i + 10) % 10)).join('');
    const weak = [
      '1'.repeat(QUIK1_PIN_LENGTH),
      ascending,
      descending,
      '1'.repeat(QUIK1_PIN_LENGTH - 1),
      '1'.repeat(QUIK1_PIN_LENGTH + 1),
      'a'.repeat(QUIK1_PIN_LENGTH)
    ];
    for (const pin of weak) {
      const res = await call(ledger, {
        method: 'POST', path: ['quik1-temp-pin'], headers: staffHeaders(),
        body: { clientId: CLIENT_A, pin, pinConfirm: pin }
      });
      assert.equal(res.statusCode, 400, pin + ' ' + res.body);
      assertNoPin(res.body, pin);
      assert.equal(fake.db.q1_borrowers.length, 0);
    }
    const mismatch = await call(ledger, {
      method: 'POST', path: ['quik1-temp-pin'], headers: staffHeaders(),
      body: { clientId: CLIENT_A, pin: LOGIN_PIN, pinConfirm: PIN_NEXT }
    });
    assert.equal(mismatch.statusCode, 400);
    assertNoPin(mismatch.body, LOGIN_PIN);
    assertNoPin(mismatch.body, PIN_NEXT);
  });

  test('a PIN of the wrong length is rejected at set, change, and sign-in', async () => {
    const shortPin = '2'.repeat(QUIK1_PIN_LENGTH - 1);
    const longPin = '2'.repeat(QUIK1_PIN_LENGTH + 1);
    for (const pin of [shortPin, longPin]) {
      const set = await setLogin(CLIENT_A, pin);
      assert.equal(set.statusCode, 400, set.body);
      assertNoPin(set.body, pin);
      const signed = await call(quik1, {
        method: 'POST', path: ['login'], body: { accountRef: 'qb_' + 'ab'.repeat(16), pin }
      });
      assert.equal(signed.statusCode, 400, signed.body);
      assertNoPin(signed.body, pin);
    }
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const cookie = cookieHeader(redeemed);
    for (const pin of [shortPin, longPin]) {
      const changed = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_OK, pin, pinConfirm: pin }
      });
      assert.equal(changed.statusCode, 400, changed.body);
      assertNoPin(changed.body, pin);
      const current = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: pin, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(current.statusCode, 400, current.body);
      assert.equal(fake.db.q1_borrowers[0].failed_attempts || 0, 0);
    }
    assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
  });

  test('a stored older PIN rejects a live-length entry with the same 401 and then locks', async () => {
    await setLogin(CLIENT_A);
    const legacy = '8'.repeat(QUIK1_PIN_LENGTH + 1);
    const legacyHash = await hashPinForVerify(legacy);
    fake.db.q1_borrowers[0].pin_hash = legacyHash;
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() + 3600 * 1000).toISOString();
    const accountRef = fake.db.q1_borrowers[0].id;
    const unknown = await call(quik1, {
      method: 'POST', path: ['login'], body: { accountRef: 'qb_' + 'cd'.repeat(16), pin: PIN_OK }
    });
    assert.equal(unknown.statusCode, 401, unknown.body);
    let last;
    for (let i = 0; i < 4; i++) {
      last = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
      assert.equal(last.statusCode, 401, last.body);
      assert.equal(last.json().error, unknown.json().error);
      assert.equal(last.json().error, pinNotAcceptedMessage());
    }
    const locked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(locked.statusCode, 423, locked.body);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, legacyHash);
    assert.equal(await verifyPin(PIN_OK, legacyHash), false);
    assert.equal(String(locked.body).includes(PIN_OK), false);
    assert.equal(String(locked.body).includes(legacy), false);
  });

  test('a staff login PIN is the scrypt hash sign-in accepts, with no expiry', async () => {
    const logs = silence();
    try {
      const created = await setLogin(CLIENT_A);
      assert.equal(created.statusCode, 200, created.body);
      assert.equal(created.json().pinStatus, 'Active');
      assert.equal(created.json().ok, true);
      assertNoPin(created.body, LOGIN_PIN);
      assert.equal(created.body.includes('scrypt$'), false);
      const row = fake.db.q1_borrowers[0];
      assert.equal(fake.db.q1_borrowers.length, 1);
      assert.equal(row.client_id, CLIENT_A);
      assert.match(row.pin_hash, /^scrypt\$16384\$8\$1\$/);
      assert.equal(await verifyPin(LOGIN_PIN, row.pin_hash), true);
      assert.equal(await verifyPin(PIN_OK, row.pin_hash), false);
      assert.equal(row.temp_pin_hash, null);
      assert.equal(row.temp_pin_expires_at, null);
      assert.equal(row.pin_change_hash, null);
      const again = await setLogin(CLIENT_A, PIN_NEXT);
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(fake.db.q1_borrowers.length, 1);
      assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
      assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), false);
      assert.equal(fake.db.q1_borrowers[0].temp_pin_expires_at, null);
      assertNoPin(logs.lines.join('\n'), LOGIN_PIN);
      assertNoPin(logs.lines.join('\n'), PIN_NEXT);
    } finally { logs.restore(); }
  });

  test('setting a login PIN replaces the borrower PIN, writes an audit row, and revokes sessions', async () => {
    const logs = silence();
    try {
      const invited = await call(ledger, {
        method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
      });
      const redeemed = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
      });
      const pinHash = fake.db.q1_borrowers[0].pin_hash;
      const anon = await call(ledger, {
        method: 'POST', path: ['quik1-temp-pin'], body: { clientId: CLIENT_A, pin: LOGIN_PIN, pinConfirm: LOGIN_PIN }
      });
      assert.equal(anon.statusCode, 401);
      const set = await setLogin(CLIENT_A);
      assert.equal(set.statusCode, 200, set.body);
      assertNoPin(set.body, LOGIN_PIN);
      assert.equal(set.json().pinStatus, 'Active');
      const row = fake.db.q1_borrowers[0];
      assert.notEqual(row.pin_hash, pinHash);
      assert.equal(await verifyPin(LOGIN_PIN, row.pin_hash), true);
      assert.equal(await verifyPin(PIN_OK, row.pin_hash), false);
      assert.equal(row.temp_pin_hash, null);
      assert.equal(row.temp_pin_expires_at, null);
      assert.equal(row.failed_attempts, 0);
      assert.equal(row.locked_at, null);
      const until = new Date(row.device_reset_until).getTime();
      assert.ok(until > Date.now() + 23 * 3600 * 1000 && until < Date.now() + 25 * 3600 * 1000);
      assert.equal(fake.db.q1_sessions.every(s => s.revoked_at), true);
      assert.equal(fake.db.q1_devices.every(d => d.revoked_at), true);
      const audit = fake.db.audit_log.find(a => a.type === 'borrower_temp_pin_set');
      assert.ok(audit);
      assert.match(audit.by, /^key:[0-9a-f]{16}$/);
      assert.equal(audit.comment, 'client_id=' + CLIENT_A);
      assert.equal(typeof audit.at, 'string');
      assertNoPin(JSON.stringify(audit), LOGIN_PIN);
      assert.equal(JSON.stringify(fake.db.q1_temp_pin_sets).includes(LOGIN_PIN), false);
      const oldHome = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(redeemed) } });
      assert.equal(oldHome.statusCode, 401);
      const listed = await call(ledger, {
        method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
      });
      assert.equal(listed.json().pinStatus, 'Active');
      assertNoPin(listed.body, LOGIN_PIN);
      assert.equal(listed.body.includes('scrypt$'), false);
      assert.equal(listed.body.includes('temp_pin_hash'), false);
      assertNoPin(logs.lines.join('\n'), LOGIN_PIN);
    } finally { logs.restore(); }
  });

  test('login PIN sets are limited per staff member and per client', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await setLogin(CLIENT_A, LOGIN_PIN);
      assert.equal(ok.statusCode, 200, ok.body);
    }
    const blocked = await setLogin(CLIENT_A, PIN_NEXT);
    assert.equal(blocked.statusCode, 429);
    assert.equal(blocked.json().error, 'Too many attempts');
    assert.equal(blocked.headers['retry-after'], '900');
    assertNoPin(blocked.body, PIN_NEXT);
    assert.equal(fake.db.q1_temp_pin_sets.length, 5);

    tempPinLimiter.reset();
    fake.db.q1_temp_pin_sets = Array.from({ length: 5 }, (_, i) => ({
      id: 'qt_seed_' + i, client_id: CLIENT_A, actor: 'other@ecoloans.co.za', created_at: new Date().toISOString()
    }));
    const clientBlocked = await setLogin(CLIENT_A, LOGIN_PIN);
    assert.equal(clientBlocked.statusCode, 429);
    const otherClient = await setLogin(CLIENT_B, LOGIN_PIN);
    assert.equal(otherClient.statusCode, 200, otherClient.body);
    assert.equal(fake.db.q1_borrowers.filter(b => b.client_id === CLIENT_B).length, 1);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers.find(b => b.client_id === CLIENT_B).pin_hash), true);
  });

  test('a cross-site staff cookie cannot set a login PIN', async () => {
    fake.db.employees = [{ id: 'e_staff', name: 'Asha', email: 'asha@ecoloans.co.za', role: 'admin', active: true }];
    const minted = mintStaffSession(Date.now(), { email: 'asha@ecoloans.co.za', displayName: 'Asha' });
    const cookie = STAFF_COOKIE + '=' + encodeURIComponent(minted.token);
    assert.match(staffCookieHeader(minted.token, minted.exp), /HttpOnly/);
    const cross = await call(ledger, {
      method: 'POST', path: ['quik1-temp-pin'],
      headers: { host: 'localhost', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site', cookie },
      body: { clientId: CLIENT_A, pin: LOGIN_PIN, pinConfirm: LOGIN_PIN }
    });
    assert.equal(cross.statusCode, 401);
    assert.equal(fake.db.q1_borrowers.length, 0);
    const same = await call(ledger, {
      method: 'POST', path: ['quik1-temp-pin'],
      headers: { host: 'localhost', origin: 'http://localhost', 'sec-fetch-site': 'same-origin', cookie },
      body: { clientId: CLIENT_A, pin: LOGIN_PIN, pinConfirm: LOGIN_PIN }
    });
    assert.equal(same.statusCode, 200, same.body);
    assert.equal(fake.db.audit_log.some(a => a.type === 'borrower_temp_pin_set' && a.by === 'asha@ecoloans.co.za'), true);
    assertNoPin(same.body, LOGIN_PIN);
  });

  test('sign-in with a staff-set PIN is a normal session and does not force a PIN change', async () => {
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), { error: pinNotAcceptedMessage() });
    assert.equal(rawCookies(wrong).includes('q1_session='), false);
    assert.equal(rawCookies(wrong).includes('q1_pin_change='), false);
    fake.db.q1_borrowers[0].failed_attempts = 0;
    fake.db.q1_borrowers[0].locked_at = null;
    const first = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().ok, true);
    assert.equal(first.json().accountRef, accountRef);
    assert.equal(first.json().pinChangeRequired, undefined);
    assert.match(cookieHeader(first), /q1_session=/);
    assert.match(knownCookie(first), /^q1_known=/);
    assert.equal(pinChangeCookie(first), '');
    assert.equal(rawCookies(first).includes('q1_pin_change='), false);
    assertNoPin(first.body, LOGIN_PIN);
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(first) } });
    assert.equal(home.statusCode, 200, home.body);
    const again = await call(quik1, {
      method: 'POST', path: ['login'],
      headers: { cookie: knownCookie(first) },
      body: { accountRef, pin: LOGIN_PIN }
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().pinChangeRequired, undefined);
    assert.match(cookieHeader(again), /q1_session=/);
  });

  test('a staff-set PIN still signs in well after 72 hours', async () => {
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    const pinHash = fake.db.q1_borrowers[0].pin_hash;
    assert.equal(fake.db.q1_borrowers[0].temp_pin_expires_at, null);
    const opened = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(opened.statusCode, 200, opened.body);
    const known = knownCookie(opened);
    const start = Date.now();
    await withClock(start + 80 * 3600 * 1000, async () => {
      const late = await call(quik1, {
        method: 'POST', path: ['login'],
        headers: { cookie: known },
        body: { accountRef, pin: LOGIN_PIN }
      });
      assert.equal(late.statusCode, 200, late.body);
      assert.equal(late.json().ok, true);
      assert.equal(late.json().accountRef, accountRef);
      assert.equal(late.json().pinChangeRequired, undefined);
      assert.match(cookieHeader(late), /q1_session=/);
      assert.equal(rawCookies(late).includes('q1_pin_change='), false);
      assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
      assert.equal(await verifyPin(LOGIN_PIN, pinHash), true);
    });
  });

  test('past 72 hours an unused staff PIN is still the PIN, and a dead phone window is device_not_linked', async () => {
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    const pinHash = fake.db.q1_borrowers[0].pin_hash;
    const start = Date.now();
    await withClock(start + 80 * 3600 * 1000, async () => {
      const late = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
      assertDeviceNotLinked(late);
      assert.equal(fake.db.q1_borrowers[0].failed_attempts, 0);
      assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
      const reset = await call(ledger, {
        method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
      });
      assert.equal(reset.statusCode, 200, reset.body);
      assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
      const again = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(again.json().ok, true);
      assert.equal(again.json().pinChangeRequired, undefined);
      assert.match(cookieHeader(again), /q1_session=/);
      assert.equal(rawCookies(again).includes('q1_pin_change='), false);
    });
  });

  test('staff-set sign-in keeps lock, then PIN, then device order', async () => {
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    fake.db.q1_borrowers[0].device_reset_until = null;
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), { error: pinNotAcceptedMessage() });
    assert.equal(wrong.headers['set-cookie'], undefined);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts, 1);
    fake.db.q1_borrowers[0].failed_attempts = 5;
    fake.db.q1_borrowers[0].locked_at = new Date().toISOString();
    const locked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(locked.statusCode, 423);
    assert.equal(locked.headers['set-cookie'], undefined);
    fake.db.q1_borrowers[0].failed_attempts = 0;
    fake.db.q1_borrowers[0].locked_at = null;
    const unlinked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assertDeviceNotLinked(unlinked);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts, 0);
    const unknown = await call(quik1, {
      method: 'POST', path: ['login'], body: { accountRef: 'qb_' + 'ab'.repeat(16), pin: LOGIN_PIN }
    });
    assert.equal(unknown.statusCode, 401);
    assert.deepEqual(unknown.json(), wrong.json());
  });

  test('with email live, a staff-set PIN does not skip the new-phone email check', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
    enableBorrowerEmail();
    setEmailSender({ enabled: true, async send() { return { sent: true }; } });
    await setLogin(CLIENT_A);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
    const accountRef = fake.db.q1_borrowers[0].id;
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.headers['set-cookie'], undefined);
    const ok = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().verifyRequired, true);
    assert.equal(ok.json().pinChangeRequired, undefined);
    assert.equal(ok.json().accountRef, undefined);
    assert.equal(rawCookies(ok).includes('q1_session='), false);
    assert.equal(rawCookies(ok).includes('q1_pin_change='), false);
    assertNoPin(ok.body, LOGIN_PIN);
  });

  test('a signed-in borrower can change PIN only with the session and the current PIN', async () => {
    const logs = silence();
    try {
      const invited = await call(ledger, {
        method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
      });
      const redeemed = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
      });
      const cookie = cookieHeader(redeemed);
      const accountRef = redeemed.json().accountRef;
      const bare = await call(quik1, {
        method: 'POST', path: ['pin'],
        body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(bare.statusCode, 401);
      assert.equal(bare.json().error, 'Sign in required');
      assertNoPin(bare.body, PIN_OK);
      assertNoPin(bare.body, PIN_NEXT);
      assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
      const stale = await call(quik1, {
        method: 'POST', path: ['pin'],
        headers: { cookie: 'q1_pin_change=' + 'ab'.repeat(32) },
        body: { pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(stale.statusCode, 401);
      assert.equal(rawCookies(stale).includes('q1_session='), false);
      const wrong = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_BAD, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(wrong.statusCode, 401);
      assert.equal(wrong.json().error, pinNotAcceptedMessage());
      assert.equal(fake.db.q1_borrowers[0].failed_attempts, 1);
      assertNoPin(wrong.body, PIN_BAD);
      const mismatch = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: LOGIN_PIN }
      });
      assert.equal(mismatch.statusCode, 400);
      assert.equal(mismatch.json().error, 'PINs do not match');
      assert.equal(fake.db.q1_borrowers[0].failed_attempts, 1);
      const same = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_OK, pin: PIN_OK, pinConfirm: PIN_OK }
      });
      assert.equal(same.statusCode, 400);
      assert.equal(same.json().error, 'Choose a different PIN');
      assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
      const changed = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.deepEqual(changed.json(), { ok: true });
      assertNoPin(changed.body, PIN_NEXT);
      assertNoPin(changed.body, PIN_OK);
      assert.equal(changed.body.includes('scrypt$'), false);
      assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
      assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), false);
      assert.equal(fake.db.q1_borrowers[0].failed_attempts, 0);
      const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie } });
      assert.equal(home.statusCode, 200, home.body);
      const oldPin = await call(quik1, {
        method: 'POST', path: ['login'],
        headers: { cookie: knownCookie(redeemed) },
        body: { accountRef, pin: PIN_OK }
      });
      assert.equal(oldPin.statusCode, 401);
      const newPin = await call(quik1, {
        method: 'POST', path: ['login'],
        headers: { cookie: knownCookie(redeemed) },
        body: { accountRef, pin: PIN_NEXT }
      });
      assert.equal(newPin.statusCode, 200, newPin.body);
      assert.equal(newPin.json().ok, true);
      assert.equal(newPin.json().pinChangeRequired, undefined);
      assertNoPin(logs.lines.join('\n'), PIN_OK);
      assertNoPin(logs.lines.join('\n'), PIN_NEXT);
      assertNoPin(logs.lines.join('\n'), PIN_BAD);
    } finally { logs.restore(); }
  });

  test('a wrong current PIN counts toward lockout and the auth rate limit', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const cookie = cookieHeader(redeemed);
    const hash = fake.db.q1_borrowers[0].pin_hash;
    for (let i = 0; i < 4; i++) {
      const miss = await call(quik1, {
        method: 'POST', path: ['pin'], headers: { cookie },
        body: { currentPin: PIN_BAD, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(miss.statusCode, 401, miss.body);
      assertNoPin(miss.body, PIN_BAD);
    }
    const locked = await call(quik1, {
      method: 'POST', path: ['pin'], headers: { cookie },
      body: { currentPin: PIN_BAD, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(locked.statusCode, 423, locked.body);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts, 5);
    assert.equal(fake.db.q1_borrowers[0].locked_at != null, true);
    const still = await call(quik1, {
      method: 'POST', path: ['pin'], headers: { cookie },
      body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(still.statusCode, 423);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
    assert.equal(await verifyPin(PIN_OK, hash), true);

    fake.db.q1_borrowers[0].failed_attempts = 0;
    fake.db.q1_borrowers[0].locked_at = null;
    process.env.QUIK1_AUTH_RATE_LIMIT = '3';
    authLimiter.reset();
    const ip = { 'x-forwarded-for': '198.51.100.44', cookie };
    try {
      for (let i = 0; i < 3; i++) {
        const res = await call(quik1, {
          method: 'POST', path: ['pin'], headers: ip,
          body: { currentPin: PIN_BAD, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
        });
        assert.equal(res.statusCode, 401, res.body);
      }
      const blocked = await call(quik1, {
        method: 'POST', path: ['pin'], headers: ip,
        body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
      });
      assert.equal(blocked.statusCode, 429, blocked.body);
      assert.equal(blocked.json().error, 'Too many attempts');
      assert.ok(blocked.headers['retry-after']);
      assertNoPin(blocked.body, PIN_OK);
      assert.equal(fake.db.q1_borrowers[0].failed_attempts, 3);
      assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
    } finally {
      delete process.env.QUIK1_AUTH_RATE_LIMIT;
      authLimiter.reset();
    }
  });

  test('change PIN is off with the borrower PIN flag, and a new invite still replaces a forgotten PIN', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    delete process.env.QUIK1_BORROWER_PIN;
    const off = await call(quik1, {
      method: 'POST', path: ['pin'], headers: { cookie: cookieHeader(redeemed) },
      body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(off.statusCode, 503);
    assert.equal(off.json().error, 'Sign-in is not available');
    assertNoPin(off.body, PIN_NEXT);
    process.env.QUIK1_BORROWER_PIN = '1';
    await setLogin(CLIENT_A);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), true);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 201, reset.body);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, 'locked');
    const upgraded = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: reset.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(upgraded.statusCode, 200, upgraded.body);
    assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), false);
    const home = await call(quik1, { method: 'GET', path: ['me'], headers: { cookie: cookieHeader(upgraded) } });
    assert.equal(home.statusCode, 200, home.body);
  });

  test('reset device keeps the login PIN and does not set a temporary PIN', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const pinHash = fake.db.q1_borrowers[0].pin_hash;
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.deepEqual(reset.json(), { ok: true, cleared: true });
    const until = new Date(fake.db.q1_borrowers[0].device_reset_until).getTime();
    assert.ok(until > Date.now() + 23 * 3600 * 1000 && until < Date.now() + 25 * 3600 * 1000);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, pinHash);
    assert.equal(fake.db.q1_borrowers[0].temp_pin_hash == null, true);
    assert.equal(fake.db.audit_log.some(a => a.type === 'QUIK1 DEVICE RESET'), true);
    assert.equal(fake.db.audit_log.some(a => a.type === 'borrower_temp_pin_set'), false);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const html = fs.readFileSync(path.join(root, 'ledger/index.html'), 'utf8');
    const quik = fs.readFileSync(path.join(root, 'quik1/index.html'), 'utf8');
    assert.match(html, /Reset device/);
    assert.match(html, /\/quik1-devices\/reset/);
    assert.match(html, /Device reset\. The next phone must open the email link\./);
    assert.match(html, /Set login PIN/);
    assert.doesNotMatch(html, /Set temporary PIN/);
    assert.doesNotMatch(html, /expires after 72 hours/);
    assert.match(html, /signs the borrower out of every phone/);
    assert.match(html, /removes Face ID and passkeys/);
    assert.match(html, /tempPin:''/);
    assert.match(html, /tempPin2:''/);
    assert.match(html, /type="password"/);
    assert.match(html, /\{\{ q1PinStatus \}\}/);
    assert.match(quik, /Change PIN/);
    assert.match(quik, /currentPin/);
    assert.match(quik, /Enter your current PIN/);
    assert.doesNotMatch(quik, /pinChangeRequired/);
    assert.match(quik, /Open the link on this phone\. It works once, then this device is remembered\./);
    assert.match(quik, /Staff can reset this device in Ledger\. Your PIN stays the same\./);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261110231500_q1_borrower_temp_pin.sql'), 'utf8');
    assert.match(sql, /^-- apply only after review approval\n/);
    assert.match(sql, /public\.q1_borrowers/);
    assert.match(sql, /public\.q1_temp_pin_sets/);
    assert.match(sql, /column_name = 'device_reset_until'/);
    assert.match(html, /Quik1 invites are switched off until launch\./);
    assert.match(html, /q1PinLive!==true/);
    assert.match(quik, /finishBorrower\('\/pin'/);
    assert.doesNotMatch(sql, /alter table public\.(?!q1_)/);
  });

  test('set PIN fails closed when the flag is off or the migration is not applied', async () => {
    delete process.env.QUIK1_BORROWER_PIN;
    const off = await setLogin(CLIENT_A);
    assert.equal(off.statusCode, 503);
    assert.equal(off.json().error, 'Sign-in is not available');
    assert.equal(off.json().code, undefined);
    assertNoPin(off.body, LOGIN_PIN);
    assert.equal(fake.db.q1_borrowers.length, 0);
    process.env.QUIK1_BORROWER_PIN = '1';

    fake.hideColumns('q1_borrowers', ['temp_pin_hash', 'temp_pin_expires_at', 'device_reset_until', 'temp_pin_spent_hash', 'pin_change_hash', 'pin_change_expires_at']);
    const pending = await setLogin(CLIENT_A);
    assert.equal(pending.statusCode, 503);
    assert.equal(pending.json().error, "Set PIN isn't available yet.");
    assert.equal(pending.json().code, 'migration_pending');
    assertNoPin(pending.body, LOGIN_PIN);
    const stillListed = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(stillListed.statusCode, 200);
    assert.equal(stillListed.json().pinStatus, 'None');

    fake.hideColumns('q1_borrowers', []);
    delete fake.db.q1_temp_pin_sets;
    const missing = await setLogin(CLIENT_A);
    assert.equal(missing.statusCode, 503);
    assert.equal(missing.json().code, 'migration_pending');
    assert.equal(missing.json().error, "Set PIN isn't available yet.");
  });

  function tempGone(row) {
    assert.equal(row.temp_pin_hash == null, true);
    assert.equal(row.temp_pin_expires_at == null, true);
    assert.equal(row.temp_pin_spent_hash == null, true);
    assert.equal(row.pin_change_hash == null, true);
    assert.equal(row.pin_change_expires_at == null, true);
  }

  test('Reset Device clears leftover temporary PIN columns and keeps the login PIN', async () => {
    await setLogin(CLIENT_A);
    const hash = fake.db.q1_borrowers[0].pin_hash;
    Object.assign(fake.db.q1_borrowers[0], {
      temp_pin_hash: 'scrypt$16384$8$1$aa$bb',
      temp_pin_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      temp_pin_spent_hash: 'scrypt$16384$8$1$cc$dd',
      pin_change_hash: 'ab'.repeat(32),
      pin_change_expires_at: new Date(Date.now() + 60000).toISOString()
    });
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    tempGone(fake.db.q1_borrowers[0]);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
    const accountRef = fake.db.q1_borrowers[0].id;
    const login = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().ok, true);
    assert.equal(login.json().pinChangeRequired, undefined);
    const listed = await call(ledger, {
      method: 'GET', path: ['quik1-invites', CLIENT_A], headers: staffHeaders()
    });
    assert.equal(listed.json().pinStatus, 'Active');
  });

  test('a known device sign-in clears leftover temporary PIN columns', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const hash = await hashPin(LOGIN_PIN);
    Object.assign(fake.db.q1_borrowers[0], {
      temp_pin_hash: hash,
      temp_pin_expires_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      temp_pin_spent_hash: hash,
      pin_change_hash: 'ab'.repeat(32),
      pin_change_expires_at: new Date(Date.now() + 60000).toISOString()
    });
    const next = await call(quik1, {
      method: 'POST', path: ['login'],
      headers: { cookie: knownCookie(redeemed) },
      body: { accountRef: redeemed.json().accountRef, pin: PIN_OK }
    });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().pinChangeRequired, undefined);
    tempGone(fake.db.q1_borrowers[0]);
    assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
  });

  test('creating or revoking an invite clears leftover temporary PIN columns', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    Object.assign(fake.db.q1_borrowers[0], {
      temp_pin_hash: 'scrypt$16384$8$1$aa$bb',
      temp_pin_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      pin_change_hash: 'cd'.repeat(32)
    });
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 201, created.body);
    tempGone(fake.db.q1_borrowers[0]);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, 'locked');
    await setLogin(CLIENT_A);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, 'locked');
    const revoked = await call(ledger, {
      method: 'POST', path: ['quik1-invites', 'revoke-access'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    tempGone(fake.db.q1_borrowers[0]);
  });

  test('redeeming an invite replaces a staff-set PIN', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    await setLogin(CLIENT_A);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(fake.db.q1_invites[0].redeemed_at == null, true);
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    tempGone(fake.db.q1_borrowers[0]);
    assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), false);
  });

  test('a locked borrower cannot sign in with a staff-set PIN, and change PIN stays locked', async () => {
    const invited = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: invited.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    fake.db.q1_borrowers[0].locked_at = new Date().toISOString();
    fake.db.q1_borrowers[0].failed_attempts = 5;
    const accountRef = redeemed.json().accountRef;
    const locked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(locked.statusCode, 423);
    assert.equal(locked.headers['set-cookie'], undefined);
    const refused = await call(quik1, {
      method: 'POST', path: ['pin'],
      headers: { cookie: cookieHeader(redeemed) },
      body: { currentPin: PIN_OK, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(refused.statusCode, 423);
    assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), false);
  });

  test('GET /api/quik1/pin does not require a PIN change, and logout clears a stale change cookie', async () => {
    const idle = await call(quik1, { method: 'GET', path: ['pin'] });
    assert.equal(idle.statusCode, 200);
    assert.deepEqual(idle.json(), { pinChangeRequired: false });
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    const logged = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: LOGIN_PIN } });
    assert.equal(logged.json().pinChangeRequired, undefined);
    const pending = await call(quik1, {
      method: 'GET', path: ['pin'],
      headers: { cookie: 'q1_pin_change=' + 'ab'.repeat(32) }
    });
    assert.deepEqual(pending.json(), { pinChangeRequired: false });
    assert.equal(pending.body.includes(LOGIN_PIN), false);
    assert.equal(pending.body.includes('scrypt$'), false);
    const out = await call(quik1, {
      method: 'POST', path: ['logout'],
      headers: { cookie: 'q1_pin_change=' + 'ab'.repeat(32) }
    });
    assert.equal(out.statusCode, 200, out.body);
    const cleared = String(out.headers['set-cookie']);
    assert.match(cleared, /q1_pin_change=/);
    assert.match(cleared, /Path=\/api\/quik1\/pin/);
    assert.match(cleared, /Max-Age=0/);
  });

  test('an unknown account burns two scrypt checks, the same as a known miss', async () => {
    await setLogin(CLIENT_A);
    const accountRef = fake.db.q1_borrowers[0].id;
    resetVerifyCalls();
    const unknown = await call(quik1, {
      method: 'POST', path: ['login'], body: { accountRef: 'qb_' + 'ab'.repeat(16), pin: LOGIN_PIN }
    });
    assert.equal(unknown.statusCode, 401);
    assert.deepEqual(unknown.json(), { error: pinNotAcceptedMessage() });
    assert.equal(verifyCallCount(), 2);
    resetVerifyCalls();
    const wrong = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(wrong.json(), unknown.json());
    assert.equal(verifyCallCount(), 2);
  });

  test('the features flag follows borrower PIN and switches the staff button off', async () => {
    delete process.env.QUIK1_BORROWER_PIN;
    const off = await call(ledger, { method: 'GET', path: ['features'], headers: staffHeaders() });
    assert.equal(off.statusCode, 200);
    assert.equal(off.json().borrowerPin, false);
    process.env.QUIK1_BORROWER_PIN = '1';
    const on = await call(ledger, { method: 'GET', path: ['features'], headers: staffHeaders() });
    assert.equal(on.json().borrowerPin, true);
  });

  function noPinMaterial(row, pins) {
    const text = JSON.stringify(row);
    for (const pin of pins) assert.equal(text.includes(pin), false);
    assert.equal(text.includes('scrypt$'), false);
    assert.equal(text.includes('temp_pin_hash'), false);
    assert.equal(text.includes('temp_pin_spent_hash'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'pin'), false);
  }

  async function borrowerWithPin() {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    assert.equal(redeemed.statusCode, 200, redeemed.body);
    return redeemed.json().accountRef;
  }

  async function refuseLoginPinRace(mutate) {
    await borrowerWithPin();
    const row = fake.db.q1_borrowers[0];
    const lockedAt = row.locked_at;
    const prev = globalThis.fetch;
    let once = false;
    globalThis.fetch = async (url, init) => {
      const method = String((init && init.method) || 'GET').toUpperCase();
      if (!once && method === 'PATCH' && String(url).includes('/q1_borrowers')) {
        once = true;
        mutate(row);
      }
      return prev(url, init);
    };
    try {
      const refused = await setLogin(CLIENT_A);
      assert.equal(refused.statusCode, 409, refused.body);
      assert.equal(refused.json().error, TEMP_PIN_INVITE_LOCK);
      assert.equal(refused.body.includes(LOGIN_PIN), false);
    } finally {
      globalThis.fetch = prev;
    }
    assert.equal(row.temp_pin_hash == null, true);
    assert.equal(String(row.temp_pin_hash || '').startsWith('scrypt$'), false);
    assert.equal(fake.db.q1_temp_pin_sets.length, 0);
    assert.equal(fake.db.audit_log.some(a => a.type === 'borrower_temp_pin_set'), false);
    return { row, lockedAt };
  }

  test('a failed-attempt lockout can be cleared by Set PIN and the set row records unlocked', async () => {
    await borrowerWithPin();
    const oldHash = fake.db.q1_borrowers[0].pin_hash;
    fake.db.q1_borrowers[0].failed_attempts = 5;
    fake.db.q1_borrowers[0].locked_at = new Date().toISOString();
    const set = await setLogin(CLIENT_A);
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(fake.db.q1_borrowers[0].failed_attempts, 0);
    assert.equal(fake.db.q1_borrowers[0].locked_at, null);
    assert.equal(await verifyPin(LOGIN_PIN, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(PIN_OK, fake.db.q1_borrowers[0].pin_hash), false);
    assert.notEqual(fake.db.q1_borrowers[0].pin_hash, oldHash);
    assert.equal(fake.db.q1_borrowers[0].temp_pin_hash, null);
    const recorded = fake.db.q1_temp_pin_sets.filter(row => row.unlocked === true);
    assert.equal(recorded.length, 1);
    noPinMaterial(recorded[0], [LOGIN_PIN, PIN_OK]);
    const audit = fake.db.audit_log.find(row => row.type === 'borrower_temp_pin_set');
    assert.ok(audit);
    noPinMaterial(audit, [LOGIN_PIN, PIN_OK]);
  });

  test('an invite-locked client is refused with 409 and nothing is written', async () => {
    await borrowerWithPin();
    const invite = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(invite.statusCode, 201, invite.body);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, 'locked');
    const before = JSON.stringify(fake.db.q1_borrowers[0]);
    const sets = fake.db.q1_temp_pin_sets.length;
    const audits = fake.db.audit_log.filter(row => row.type === 'borrower_temp_pin_set').length;
    const refused = await setLogin(CLIENT_A);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, TEMP_PIN_INVITE_LOCK);
    assert.equal(refused.body.includes(LOGIN_PIN), false);
    assert.equal(JSON.stringify(fake.db.q1_borrowers[0]), before);
    assert.equal(fake.db.q1_temp_pin_sets.length, sets);
    assert.equal(fake.db.audit_log.filter(row => row.type === 'borrower_temp_pin_set').length, audits);
  });

  test('a revoked client is refused with 409 and nothing is written', async () => {
    await borrowerWithPin();
    const revoked = await call(ledger, {
      method: 'POST', path: ['quik1-invites', 'revoke-access'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, 'locked');
    const before = JSON.stringify(fake.db.q1_borrowers[0]);
    const sets = fake.db.q1_temp_pin_sets.length;
    const audits = fake.db.audit_log.filter(row => row.type === 'borrower_temp_pin_set').length;
    const refused = await setLogin(CLIENT_A);
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, TEMP_PIN_INVITE_LOCK);
    assert.equal(refused.body.includes(LOGIN_PIN), false);
    assert.equal(JSON.stringify(fake.db.q1_borrowers[0]), before);
    assert.equal(fake.db.q1_temp_pin_sets.length, sets);
    assert.equal(fake.db.audit_log.filter(row => row.type === 'borrower_temp_pin_set').length, audits);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const html = fs.readFileSync(path.join(root, 'ledger/index.html'), 'utf8');
    assert.equal(html.includes(TEMP_PIN_INVITE_LOCK), true);
    assert.match(html, /e\.status===409/);
  });

  test('a revoke that sets pin_hash to locked before the write is a 409 and writes nothing', async () => {
    const { row, lockedAt } = await refuseLoginPinRace(borrower => {
      borrower.pin_hash = 'locked';
    });
    assert.equal(row.pin_hash, 'locked');
    assert.equal(row.locked_at, lockedAt);
  });

  test('a revoke that changes locked_at before the write is a 409 and writes nothing', async () => {
    const seen = new Date().toISOString();
    const { row } = await refuseLoginPinRace(borrower => {
      borrower.locked_at = seen;
    });
    assert.equal(await verifyPin(PIN_OK, row.pin_hash), true);
    assert.equal(await verifyPin(LOGIN_PIN, row.pin_hash), false);
    assert.equal(row.locked_at, seen);
  });

  function bindIdPhone() {
    process.env.QUIK1_ID_HMAC_KEY = 'ab'.repeat(32);
    let saId = '';
    for (let check = 0; check <= 9; check++) {
      const id = '910722482008' + String(check);
      if (luhnOk(id)) { saId = id; break; }
    }
    const phone = '825550199';
    const client = fake.db.clients.find(c => c.id === CLIENT_A);
    client.id_hmac = idHmac(saId);
    client.phone_hmac = phoneHmac(phone);
    return { saId, phone };
  }

  test('a staff-set PIN works through ID and phone sign-in and stays refused while locked', async () => {
    const { saId, phone } = bindIdPhone();
    const set = await setLogin(CLIENT_A);
    assert.equal(set.statusCode, 200, set.body);
    const challenges = fake.db.q1_otp_challenges.length;
    const ok = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      body: { idNumber: saId, phone, pin: LOGIN_PIN }
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().ok, true);
    assert.equal(ok.json().pinChangeRequired, undefined);
    assert.match(ok.json().accountRef, /^qb_[0-9a-f]{32}$/);
    assert.match(cookieHeader(ok), /q1_session=/);
    assert.equal(rawCookies(ok).includes('q1_pin_change='), false);
    assert.equal(fake.db.q1_otp_challenges.length, challenges);
    assert.equal(ok.body.includes(LOGIN_PIN), false);

    const hash = fake.db.q1_borrowers[0].pin_hash;
    fake.db.q1_borrowers[0].failed_attempts = 5;
    fake.db.q1_borrowers[0].locked_at = new Date().toISOString();
    const locked = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      body: { idNumber: saId, phone, pin: LOGIN_PIN }
    });
    assert.equal(locked.statusCode, 423, locked.body);
    assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
    assert.equal(await verifyPin(LOGIN_PIN, hash), true);
    assert.equal(cookieHeader(locked).includes('q1_session='), false);
    assert.equal(fake.db.q1_otp_challenges.length, challenges);

    const unknown = await call(quik1, {
      method: 'POST', path: ['signin', 'id'],
      body: { idNumber: saId, phone: '825550100', pin: PIN_BAD }
    });
    assert.equal(unknown.statusCode, 401, unknown.body);
    assert.equal(unknown.json().error, pinNotAcceptedMessage());
    assert.equal(fake.db.q1_otp_challenges.length, challenges);
  });

  test('the ID and phone IP limit applies when the request includes a PIN', async () => {
    process.env.QUIK1_ID_PHONE_HOURLY_CAP = '1';
    const { saId, phone } = bindIdPhone();
    const set = await setLogin(CLIENT_A);
    assert.equal(set.statusCode, 200, set.body);
    const hash = fake.db.q1_borrowers[0].pin_hash;
    const ip = '198.51.100.77';
    fake.db.q1_auth_attempts.push({
      id: 'qa_id_phone_cap',
      borrower_id: null,
      kind: 'id_phone',
      ip_hash: authIpHash(ip),
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    });
    try {
      const blocked = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': ip },
        body: { idNumber: saId, phone, pin: LOGIN_PIN }
      });
      assert.equal(blocked.statusCode, 429, blocked.body);
      assert.equal(blocked.headers['retry-after'], '3600');
      assert.equal(blocked.body.includes(LOGIN_PIN), false);
      assert.equal(fake.db.q1_borrowers[0].pin_hash, hash);
      assert.equal(cookieHeader(blocked).includes('q1_session='), false);
      assert.equal(cookieHeader(blocked).includes('q1_pin_change='), false);
      const other = await call(quik1, {
        method: 'POST', path: ['signin', 'id'],
        headers: { 'x-forwarded-for': '198.51.100.78' },
        body: { idNumber: saId, phone, pin: LOGIN_PIN }
      });
      assert.equal(other.statusCode, 200, other.body);
      assert.equal(other.json().ok, true);
      assert.equal(other.json().pinChangeRequired, undefined);
      assert.match(cookieHeader(other), /q1_session=/);
      assert.equal(rawCookies(other).includes('q1_pin_change='), false);
    } finally {
      delete process.env.QUIK1_ID_PHONE_HOURLY_CAP;
    }
  });
});
