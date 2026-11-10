// WebAuthn Face ID: enrolment after a fresh PIN session, unlock, replay, and reset.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { b64urlEncode, cborEncode, sha256 } from '../../api/_lib/webauthn.js';
import { rpIdForHost } from '../../api/_lib/borrower-webauthn.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const CLIENT_A = 'c_bio_a';
const PIN_OK = '246810';

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;
process.env.QUIK1_SESSION_SECRET = SECRET;

function seed(withWebauthn) {
  const base = {
    clients: [
      { id: CLIENT_A, ref: 'EC-901', name: 'Book Client A', bank: 'Example Bank', deleted_at: null }
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
  if (withWebauthn) {
    base.q1_webauthn_credentials = [];
    base.q1_webauthn_challenges = [];
  }
  return base;
}

const fake = createFakePostgrest(seed(true));
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
async function call(handler, { method = 'GET', path = [], headers = {}, body, host } = {}) {
  const req = {
    method,
    query: { path },
    url: '/api/' + path.join('/'),
    headers: {
      host: host || (handler === ledger ? 'localhost' : 'quik1.test'),
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

function staffHeaders() {
  return { authorization: 'Bearer ' + STAFF };
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw || ''];
  return list.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
}

async function pinSession() {
  const created = await call(ledger, {
    method: 'POST', path: ['quik1-invites'], headers: staffHeaders(), body: { clientId: CLIENT_A }
  });
  assert.equal(created.statusCode, 201, created.body);
  const code = created.json().code;
  const redeemed = await call(quik1, {
    method: 'POST', path: ['invites', 'redeem'], body: { code, pin: PIN_OK, pinConfirm: PIN_OK }
  });
  assert.equal(redeemed.statusCode, 200, redeemed.body);
  return cookieHeader(redeemed);
}

function platformKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = new Map([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')],
    [-3, Buffer.from(jwk.y, 'base64url')]
  ]);
  return { privateKey, cose: cborEncode(cose), credentialId: randomBytes(16) };
}

function authData({ rpId, flags, signCount, credentialId, cose }) {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(signCount);
  const parts = [sha256(rpId), Buffer.from([flags]), count];
  if (credentialId) {
    const len = Buffer.alloc(2);
    len.writeUInt16BE(credentialId.length);
    parts.push(Buffer.alloc(16), len, credentialId, cose);
  }
  return Buffer.concat(parts);
}

function clientData(type, challenge) {
  return Buffer.from(JSON.stringify({
    type,
    challenge,
    origin: 'https://quik1.test'
  }));
}

let restore = () => {};
describe('borrower webauthn', { concurrency: false }, () => {
  beforeEach(() => {
    publicLimiter.reset();
    authLimiter.reset();
    process.env.QUIK1_BORROWER_PIN = '1';
    delete process.env.VERCEL_ENV;
    fake.reset(seed(true));
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => { restore(); restore = () => {}; delete process.env.VERCEL_ENV; });

  test('quik1.app is the passkey relying party, including www', () => {
    assert.equal(rpIdForHost('quik1.app'), 'quik1.app');
    assert.equal(rpIdForHost('www.quik1.app'), 'quik1.app');
    assert.equal(rpIdForHost('quik1.test'), 'quik1.test');
  });

  test('a PIN sign-in can enrol a platform key and that key unlocks the same borrower', async () => {
    const cookie = await pinSession();
    const bare = await call(quik1, { method: 'POST', path: ['webauthn'], body: { op: 'register-options' } });
    assert.equal(bare.statusCode, 401);
    const framed = await call(quik1, {
      method: 'POST', path: ['webauthn'],
      headers: { cookie, 'sec-fetch-dest': 'iframe' },
      body: { op: 'register-options' }
    });
    assert.equal(framed.statusCode, 401);
    const options = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: { op: 'register-options' }
    });
    assert.equal(options.statusCode, 200, options.body);
    const opt = options.json();
    assert.equal(opt.rpId, 'quik1.test');
    const storedHash = createHash('sha256').update(opt.challenge, 'utf8').digest('hex');
    assert.equal(fake.db.q1_webauthn_challenges.some(row => row.challenge_hash === storedHash && !row.consumed_at), true);
    assert.equal(JSON.stringify(fake.db.q1_webauthn_challenges).includes(opt.challenge), false);
    const again = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: { op: 'register-options' }
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(fake.db.q1_webauthn_challenges.filter(row => row.purpose === 'register' && !row.consumed_at).length, 1);
    assert.equal(fake.db.q1_webauthn_challenges.some(row => row.challenge_hash === storedHash && row.consumed_at), true);
    opt.challenge = again.json().challenge;
    assert.equal(opt.authenticatorSelection.userVerification, 'required');
    assert.equal(opt.authenticatorSelection.authenticatorAttachment, 'platform');
    const device = platformKey();
    const flags = 0x01 | 0x04 | 0x40;
    const attested = cborEncode(new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData({
        rpId: 'quik1.test', flags, signCount: 0,
        credentialId: device.credentialId, cose: device.cose
      })]
    ]));
    const enrolled = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: {
        op: 'register',
        clientDataJSON: b64urlEncode(clientData('webauthn.create', opt.challenge)),
        attestationObject: b64urlEncode(attested)
      }
    });
    assert.equal(enrolled.statusCode, 200, enrolled.body);
    assert.equal(fake.db.q1_webauthn_credentials.length, 1);
    assert.equal(fake.db.q1_webauthn_credentials[0].borrower_id, fake.db.q1_borrowers[0].id);
    assert.equal(String(fake.db.q1_webauthn_credentials[0].public_key).includes('BEGIN'), false);
    assert.ok(fake.db.q1_webauthn_credentials[0].device_id);

    const loginOpt = await call(quik1, {
      method: 'POST', path: ['webauthn'],
      body: { op: 'login-options', credentialId: b64urlEncode(device.credentialId) }
    });
    assert.equal(loginOpt.statusCode, 200, loginOpt.body);
    const assertionData = authData({ rpId: 'quik1.test', flags: 0x01 | 0x04, signCount: 1 });
    const assertionClient = clientData('webauthn.get', loginOpt.json().challenge);
    const signature = sign('sha256', Buffer.concat([assertionData, createHash('sha256').update(assertionClient).digest()]), device.privateKey);
    const unlocked = await call(quik1, {
      method: 'POST', path: ['webauthn'],
      body: {
        op: 'login',
        credentialId: b64urlEncode(device.credentialId),
        clientDataJSON: b64urlEncode(assertionClient),
        authenticatorData: b64urlEncode(assertionData),
        signature: b64urlEncode(signature)
      }
    });
    assert.equal(unlocked.statusCode, 200, unlocked.body);
    assert.match(unlocked.json().accountRef, /^qb_[0-9a-f]{32}$/);
    const me = await call(quik1, {
      method: 'GET', path: ['me'], headers: { cookie: cookieHeader(unlocked) }
    });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().identified, true);
    assert.equal(me.json().profile.name, 'Book Client A');

    const replay = await call(quik1, {
      method: 'POST', path: ['webauthn'],
      body: {
        op: 'login',
        credentialId: b64urlEncode(device.credentialId),
        clientDataJSON: b64urlEncode(assertionClient),
        authenticatorData: b64urlEncode(assertionData),
        signature: b64urlEncode(signature)
      }
    });
    assert.equal(replay.statusCode, 401);
  });

  test('an old session cannot enrol a passkey, and staff reset revokes it', async () => {
    const cookie = await pinSession();
    fake.db.q1_sessions[0].created_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const stale = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: { op: 'register-options' }
    });
    assert.equal(stale.statusCode, 401);
    fake.db.q1_sessions[0].created_at = new Date().toISOString();
    const options = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: { op: 'register-options' }
    });
    const device = platformKey();
    const flags = 0x01 | 0x04 | 0x40;
    const attested = cborEncode(new Map([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData({
        rpId: 'quik1.test', flags, signCount: 0,
        credentialId: device.credentialId, cose: device.cose
      })]
    ]));
    const enrolled = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: {
        op: 'register',
        clientDataJSON: b64urlEncode(clientData('webauthn.create', options.json().challenge)),
        attestationObject: b64urlEncode(attested)
      }
    });
    assert.equal(enrolled.statusCode, 200, enrolled.body);
    const reset = await call(ledger, {
      method: 'POST', path: ['quik1-devices', 'reset'],
      headers: staffHeaders(),
      body: { clientId: CLIENT_A }
    });
    assert.equal(reset.statusCode, 200, reset.body);
    assert.equal(fake.db.q1_webauthn_credentials.every(row => row.revoked_at), true);
    const blocked = await call(quik1, {
      method: 'POST', path: ['webauthn'],
      body: { op: 'login-options', credentialId: b64urlEncode(device.credentialId) }
    });
    assert.equal(blocked.statusCode, 401);
  });

  test('the kill switch blocks biometric wherever live PIN is off', async () => {
    delete process.env.QUIK1_BORROWER_PIN;
    const off = await call(quik1, { method: 'GET', path: ['webauthn'] });
    assert.equal(off.statusCode, 200);
    assert.equal(off.json().enabled, false);
    const blocked = await call(quik1, {
      method: 'POST', path: ['webauthn'], body: { op: 'login-options', credentialId: 'a'.repeat(20) }
    });
    assert.equal(blocked.statusCode, 503);
    assert.equal(blocked.json().error, 'Sign-in is not available');

    process.env.QUIK1_BORROWER_PIN = '1';
    for (const host of ['quik1.app', 'www.quik1.app']) {
      const status = await call(quik1, { method: 'GET', path: ['webauthn'], host });
      assert.equal(status.json().enabled, false, host);
      const post = await call(quik1, {
        method: 'POST', path: ['webauthn'], host,
        body: { op: 'register-options' }
      });
      assert.equal(post.statusCode, 503, host);
      assert.equal(post.json().error, 'Sign-in is not available');
    }
    process.env.VERCEL_ENV = 'production';
    const live = await call(quik1, {
      method: 'POST', path: ['webauthn'], host: 'preview.example',
      body: { op: 'login', credentialId: 'a'.repeat(20) }
    });
    assert.equal(live.statusCode, 503);
    assert.equal(fake.db.q1_webauthn_credentials.length, 0);
  });

  test('a missing webauthn table degrades and does not sign anyone in', async () => {
    delete fake.db.q1_webauthn_credentials;
    delete fake.db.q1_webauthn_challenges;
    const cookie = await pinSession();
    const res = await call(quik1, {
      method: 'POST', path: ['webauthn'], headers: { cookie },
      body: { op: 'register-options' }
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, 'Biometric sign-in is not set up yet');
    const me = await call(quik1, { method: 'GET', path: ['me'] });
    assert.equal(me.statusCode, 401);
    assert.notEqual(me.json().identified, true);
  });
});
