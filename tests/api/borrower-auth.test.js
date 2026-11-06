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
import { publicLimiter } from '../../api/_lib/ratelimit.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';

const CLIENT_A = 'c_book_a';
const CLIENT_B = 'c_book_b';
const NAME_A = 'Book Client A';
const NAME_B = 'Book Client B';
const PIN_OK = '2468';
const PIN_BAD = '1357';
const PIN_NEXT = '8024';

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
  q1_sessions: []
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
    headers: { host: 'quik1.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.' + (++ipSeq % 200), ...headers },
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
    fake.reset();
    process.env.QUIK1_BORROWER_PIN = '1';
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => { restore(); restore = () => {}; });

  test('PIN hash verifies and does not keep the PIN', async () => {
    const stored = await hashPin(PIN_OK);
    assert.equal(stored.startsWith('scrypt$'), true);
    assert.equal(stored === PIN_OK, false);
    assert.equal(await verifyPin(PIN_OK, stored), true);
    assert.equal(await verifyPin(PIN_BAD, stored), false);
    assert.equal(await verifyPin('12', stored), false);
    assert.equal(await verifyPin('12345', stored), false);
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
      method: 'POST', path: ['quik1-invites'], headers: { ...staffHeaders(), host: 'quik1.test' }, body: { clientId: CLIENT_A }
    });
    assert.equal(created.statusCode, 201);
    const body = created.json();
    const linkOk = typeof body.link === 'string' && /^https:\/\/quik1\.test\/quik1\/#invite=[0-9a-f]{64}$/.test(body.link);
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
    for (let i = 0; i < 4; i++) {
      const miss = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
      assert.equal(miss.statusCode, 401);
    }
    const locked = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_BAD } });
    assert.equal(locked.statusCode, 423);
    const still = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(still.statusCode, 423);
    assert.equal(JSON.stringify(still.json()).includes(PIN_OK), false);

    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
    });
    const oldPin = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(oldPin.statusCode, 423);
    const again = await call(quik1, {
      method: 'POST', path: ['invites', 'redeem'], body: { code: reset.json().code, pin: PIN_NEXT, pinConfirm: PIN_NEXT }
    });
    assert.equal(again.statusCode, 200);
    const back = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_NEXT } });
    assert.equal(back.statusCode, 200);
    const previous = await call(quik1, { method: 'POST', path: ['login'], body: { accountRef, pin: PIN_OK } });
    assert.equal(previous.statusCode, 401);
  });

  test('a signed-out request cannot read a Ledger client, and a session sees only its own book', async () => {
    const anon = await call(quik1, { method: 'GET', path: ['me'] });
    assert.equal(anon.statusCode, 200);
    assert.equal(anon.json().identified, false);
    assert.equal(anon.json().profile.name, '');
    assert.equal(anon.json().account.available, 0);
    assert.equal(JSON.stringify(anon.json()).includes(NAME_A), false);
    assert.equal(JSON.stringify(anon.json()).includes(NAME_B), false);

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
    assert.equal(crossed.json().identified, false);
    assert.equal(JSON.stringify(crossed.json()).includes(NAME_A), false);
    assert.equal(JSON.stringify(crossed.json()).includes(NAME_B), false);
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
});
