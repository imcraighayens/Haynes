// Borrower invites, PIN hashes, lockout, and the rule that a signed-out request
// cannot read a Ledger client's book.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { hashPin, verifyPin } from '../../api/_lib/pin.js';
import { accountFromLoans } from '../../api/_lib/quik1-book.js';
import { mintBorrowerToken } from '../../api/_lib/quik1-session.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { setEmailSender } from '../../api/_lib/email.js';
import { authIpHash } from '../../api/_lib/borrower.js';
import { decryptId } from '../../api/_lib/sa-id.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';

const CLIENT_A = 'c_book_a';
const CLIENT_B = 'c_book_b';
const NAME_A = 'Book Client A';
const NAME_B = 'Book Client B';
const PIN_OK = '246810';
const PIN_BAD = '135791';
const PIN_NEXT = '802468';
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
  if (sessionSecret) process.env.QUIK1_SESSION_SECRET = sessionSecret;
  else delete process.env.QUIK1_SESSION_SECRET;
  await handler(req, res);
  return res;
}

function staffHeaders() {
  return { authorization: 'Bearer ' + STAFF };
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

  test('live PIN stays off without the flag and on a production host', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const code = created.json().code;
    delete process.env.QUIK1_BORROWER_PIN;
    const held = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    process.env.QUIK1_BORROWER_PIN = '1';
    assert.equal(held.statusCode, 503);
    assert.equal(fake.db.q1_borrowers.length, 0);

    for (const host of ['quik1.app', 'www.quik1.app']) {
      const blocked = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'],
        headers: { host },
        body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
      });
      assert.equal(blocked.statusCode, 503, host);
    }
    for (const host of ['quik1ledger.com', 'www.quik1ledger.com']) {
      const blocked = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'],
        headers: { host },
        body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
      });
      assert.equal(blocked.statusCode, 404, host);
    }
    assert.equal(fake.db.q1_borrowers.length, 0);

    process.env.VERCEL_ENV = 'production';
    const live = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'],
      headers: { host: 'quik1.app' },
      body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    delete process.env.VERCEL_ENV;
    assert.equal(live.statusCode, 503);
    assert.equal(fake.db.q1_borrowers.length, 0);
    assert.equal(JSON.stringify(live.json()).includes(PIN_OK), false);
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
    const quiet = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(quiet.statusCode, 200, quiet.body);
    assert.equal(quiet.json().verifyRequired, true);
    assert.equal(quiet.json().contactStaff, true);
    assert.equal(quiet.json().verifyToken, undefined);
    assert.equal(quiet.body.includes(PIN_OK), false);
    assert.equal(fake.db.q1_otp_challenges.length, 0);
    assert.equal(fake.db.q1_sessions.length, sessions);
    const forced = await call(quik1, {
      method: 'POST', path: ['verify'], body: { accountRef, verifyToken: '1.nope' }
    });
    assert.equal(forced.statusCode, 401);

    const sent = [];
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

  test('weak PINs are refused and a legacy 4-digit hash still signs in until the next invite', async () => {
    const created = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const weak = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin: '123456', pinConfirm: '123456' }
    });
    assert.equal(weak.statusCode, 400);
    assert.equal(fake.db.q1_borrowers.length, 0);
    const again = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const redeemed = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: again.json().code, pin: PIN_OK, pinConfirm: PIN_OK }
    });
    const legacy = '1357';
    fake.db.q1_borrowers[0].pin_hash = await hashPin(legacy);
    const accountRef = redeemed.json().accountRef;
    const old = await call(quik1, {
      method: 'POST', path: ['login'], headers: { cookie: knownCookie(redeemed) }, body: { accountRef, pin: legacy }
    });
    assert.equal(old.statusCode, 200, old.body);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const upgraded = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: reset.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(upgraded.statusCode, 200, upgraded.body);
    assert.equal(await verifyPin(PIN_NEXT, fake.db.q1_borrowers[0].pin_hash), true);
    assert.equal(await verifyPin(legacy, fake.db.q1_borrowers[0].pin_hash), false);
  });

  test('email links share a resend cooldown and an hourly cap', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
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
    assert.equal(second.json().verifyRequired, true);
    assert.equal(second.json().contactStaff, true);
    fake.db.q1_borrowers[0].device_reset_until = new Date(Date.now() - 60 * 1000).toISOString();
    const expired = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(expired.json().verifyRequired, true);
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
    const wins = [a, b].filter(res => res.statusCode === 200 && !res.json().verifyRequired);
    assert.equal(wins.length, 1);
    assert.equal([a, b].filter(res => res.json().verifyRequired).length, 1);
    assert.equal(fake.db.q1_devices.filter(row => !row.revoked_at).length, 1);
    assert.equal(fake.db.q1_sessions.filter(row => !row.revoked_at).length, 1);
    assert.equal(fake.db.q1_borrowers[0].device_reset_until, null);
  });

  test('a device reset uses the email link when email is configured', async () => {
    fake.db.clients.find(c => c.id === CLIENT_A).email = 'book@example.com';
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
});
