// Face ID / fingerprint for one borrower. Registration needs a fresh verified
// session. Sign-in creates a session. Staff reset-device revokes the keys.
// The relying party for quik1.app is quik1.app, including www, so the
// home-screen app is not a cross-origin iframe. Missing tables sign nobody in.
import { createHash, randomBytes } from 'node:crypto';
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, eq } from './supabase.js';
import { borrowerBiometricLive } from './quik1-flags.js';
import { requestHost, requestHostname } from './auth.js';
import { requireBorrower } from './borrower-book.js';
import { startBorrowerSession, guardAuth } from './borrower.js';
import { readKnownDevice, readSession } from './quik1-session.js';
import { b64urlEncode } from './webauthn.js';

const CRED_ID = /^[A-Za-z0-9_-]{16,256}$/;
const CHALLENGE_MS = 2 * 60 * 1000;

function unavailable() {
  return new HttpError(503, 'Sign-in is not available');
}

function notSetUp() {
  return new HttpError(503, 'Biometric sign-in is not set up yet');
}

function usePin() {
  return new HttpError(401, 'Use your PIN');
}

function missingTable(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}

function passkeyRegisterWindowMs() {
  const n = parseInt(process.env.QUIK1_PASSKEY_REGISTER_MINUTES, 10);
  const minutes = Number.isFinite(n) && n >= 1 && n <= 60 ? n : 15;
  return minutes * 60 * 1000;
}

export function rpIdForHost(host) {
  const bare = String(host || '').split(':')[0];
  if (bare === 'quik1.app' || bare === 'www.quik1.app') return 'quik1.app';
  return bare;
}

export function relyingParty(req) {
  const raw = requestHost(req);
  const host = requestHostname(req);
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(raw) || !host) throw new HttpError(400, 'Bad host');
  const dest = (header(req, 'sec-fetch-dest') || '').toLowerCase();
  if (dest === 'iframe' || dest === 'embed') throw usePin();
  const proto = (header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase();
  return { rpId: rpIdForHost(host), origin: `${proto === 'http' ? 'http' : 'https'}://${raw}` };
}

function livePin(borrower) {
  return !!(borrower && typeof borrower.pin_hash === 'string' && borrower.pin_hash.startsWith('scrypt$') && !borrower.locked_at);
}

function challengeHash(challenge) {
  return createHash('sha256').update(String(challenge), 'utf8').digest('hex');
}

async function storeChallenge(borrowerId, purpose, now = Date.now()) {
  const challenge = b64urlEncode(randomBytes(32));
  const id = 'qc_' + randomBytes(8).toString('hex');
  const nowIso = new Date(now).toISOString();
  try {
    await patchWhere('q1_webauthn_challenges', {
      borrower_id: eq(borrowerId),
      purpose: eq(purpose),
      consumed_at: 'is.null'
    }, { consumed_at: nowIso });
    await insert('q1_webauthn_challenges', [{
      id,
      borrower_id: borrowerId,
      purpose,
      challenge_hash: challengeHash(challenge),
      expires_at: new Date(now + CHALLENGE_MS).toISOString()
    }]);
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  return challenge;
}

async function consumeChallenge(borrowerId, purpose, challenge, now = Date.now()) {
  const hash = challengeHash(challenge);
  let rows;
  try {
    rows = await select('q1_webauthn_challenges', {
      select: 'id,challenge_hash,expires_at,consumed_at,borrower_id,purpose',
      challenge_hash: eq(hash),
      borrower_id: eq(borrowerId),
      purpose: eq(purpose),
      consumed_at: 'is.null'
    });
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  const hit = (rows || []).find(row => row
    && row.challenge_hash === hash
    && row.borrower_id === borrowerId
    && row.purpose === purpose
    && !row.consumed_at
    && new Date(row.expires_at).getTime() > now);
  if (!hit) return false;
  const consumed = await patchWhere('q1_webauthn_challenges', {
    id: eq(hit.id),
    consumed_at: 'is.null'
  }, { consumed_at: new Date(now).toISOString() });
  return consumed.length === 1;
}

export async function biometricStatus(req) {
  const enabled = borrowerBiometricLive(req);
  if (!enabled) return { enabled: false, ready: false };
  try {
    await select('q1_webauthn_credentials', { select: 'id', limit: 1 });
    return { enabled: true, ready: true };
  } catch (err) {
    if (missingTable(err)) return { enabled: true, ready: false };
    throw err;
  }
}

async function recentSession(req) {
  const sess = readSession(req);
  if (!sess) throw new HttpError(401, 'Sign in again to save Face ID');
  const row = await selectOne('q1_sessions', {
    select: 'id,created_at,revoked_at',
    id: eq(sess.sid)
  });
  if (!row || row.revoked_at || !row.created_at) throw new HttpError(401, 'Sign in again to save Face ID');
  if (Date.now() - new Date(row.created_at).getTime() > passkeyRegisterWindowMs()) {
    throw new HttpError(401, 'Sign in again to save Face ID');
  }
}

async function knownDeviceId(req, borrowerId) {
  const token = readKnownDevice(req);
  if (!token) return null;
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  try {
    const row = await selectOne('q1_devices', {
      select: 'id,borrower_id,revoked_at,expires_at',
      token_hash: eq(hash),
      borrower_id: eq(borrowerId)
    });
    if (!row || row.revoked_at || row.borrower_id !== borrowerId) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
    return row.id;
  } catch (err) {
    if (missingTable(err)) return null;
    throw err;
  }
}

export async function registerOptions(req) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  await guardAuth(req);
  const { borrower } = await requireBorrower(req);
  await recentSession(req);
  const row = await selectOne('q1_borrowers', {
    select: 'id,pin_hash,locked_at',
    id: eq(borrower.id)
  });
  if (!livePin(row)) throw usePin();
  const { rpId } = relyingParty(req);
  const challenge = await storeChallenge(borrower.id, 'register');
  return {
    challenge,
    rpId,
    userId: b64urlEncode(Buffer.from(borrower.id, 'utf8')),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred'
    }
  };
}

function clientJson(raw) {
  const buf = Buffer.from(String(raw || ''), 'base64url');
  if (!buf.length) return null;
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

export async function registerCredential(req, body) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  await guardAuth(req);
  const { borrower } = await requireBorrower(req);
  await recentSession(req);
  const { origin, rpId } = relyingParty(req);
  const client = clientJson(body && body.clientDataJSON);
  const attestation = typeof body.attestationObject === 'string' ? body.attestationObject : '';
  if (!client || client.type !== 'webauthn.create' || client.origin !== origin || typeof client.challenge !== 'string') throw usePin();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: {
        id: 'pending',
        rawId: 'pending',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: body.clientDataJSON,
          attestationObject: attestation
        }
      },
      expectedChallenge: client.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true
    });
  } catch {
    throw usePin();
  }
  if (!verified.verified || !verified.registrationInfo || !verified.registrationInfo.userVerified) throw usePin();
  const fresh = await consumeChallenge(borrower.id, 'register', client.challenge);
  if (!fresh) throw usePin();
  const cred = verified.registrationInfo.credential;
  const credentialId = cred.id;
  if (!CRED_ID.test(credentialId)) throw usePin();
  const deviceId = await knownDeviceId(req, borrower.id);
  const publicKey = Buffer.from(cred.publicKey).toString('base64url');
  const nowIso = new Date().toISOString();
  let existing;
  try {
    existing = await selectOne('q1_webauthn_credentials', {
      select: 'id,borrower_id,revoked_at',
      id: eq(credentialId)
    });
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  if (existing && existing.borrower_id !== borrower.id) throw usePin();
  const row = {
    public_key: publicKey,
    sign_count: cred.counter || 0,
    revoked_at: null,
    last_used_at: nowIso,
    device_id: deviceId
  };
  if (existing) {
    await update('q1_webauthn_credentials', { id: credentialId }, row);
  } else {
    try {
      await insert('q1_webauthn_credentials', [{
        id: credentialId,
        borrower_id: borrower.id,
        ...row
      }]);
    } catch (err) {
      if (missingTable(err)) throw notSetUp();
      throw err;
    }
  }
  return { ok: true };
}

export async function loginOptions(req, body) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  await guardAuth(req);
  const credentialId = typeof body.credentialId === 'string' ? body.credentialId : '';
  if (!CRED_ID.test(credentialId)) throw usePin();
  const { rpId } = relyingParty(req);
  let cred;
  try {
    cred = await selectOne('q1_webauthn_credentials', {
      select: 'id,borrower_id,revoked_at',
      id: eq(credentialId)
    });
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  if (!cred || cred.revoked_at) throw usePin();
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,pin_hash,locked_at',
    id: eq(cred.borrower_id)
  });
  if (!livePin(borrower)) throw usePin();
  const challenge = await storeChallenge(borrower.id, 'login');
  return { challenge, rpId, credentialId };
}

export async function loginCredential(req, body) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  await guardAuth(req);
  const credentialId = typeof body.credentialId === 'string' ? body.credentialId : '';
  const client = clientJson(body && body.clientDataJSON);
  if (!CRED_ID.test(credentialId) || !client || typeof body.authenticatorData !== 'string' || typeof body.signature !== 'string') throw usePin();
  const { origin, rpId } = relyingParty(req);
  let cred;
  try {
    cred = await selectOne('q1_webauthn_credentials', {
      select: 'id,borrower_id,public_key,sign_count,revoked_at',
      id: eq(credentialId)
    });
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  if (!cred || cred.revoked_at || !cred.borrower_id) throw usePin();
  if (client.type !== 'webauthn.get' || client.origin !== origin || typeof client.challenge !== 'string') throw usePin();
  const previous = Number(cred.sign_count) || 0;
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response: {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: body.clientDataJSON,
          authenticatorData: body.authenticatorData,
          signature: body.signature
        }
      },
      expectedChallenge: client.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      requireUserVerification: true,
      credential: {
        id: credentialId,
        publicKey: Buffer.from(cred.public_key, 'base64url'),
        counter: previous
      }
    });
  } catch {
    throw usePin();
  }
  if (!verified.verified || !verified.authenticationInfo.userVerified) throw usePin();
  if (previous > 0 && verified.authenticationInfo.newCounter <= previous) throw usePin();
  const fresh = await consumeChallenge(cred.borrower_id, 'login', client.challenge);
  if (!fresh) throw usePin();
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,locked_at',
    id: eq(cred.borrower_id)
  });
  if (!livePin(borrower)) throw usePin();
  await update('q1_webauthn_credentials', { id: credentialId }, {
    sign_count: verified.authenticationInfo.newCounter,
    last_used_at: new Date().toISOString()
  });
  const session = await startBorrowerSession(borrower, req);
  try {
    await update('q1_webauthn_credentials', { id: credentialId }, { device_id: session.deviceId });
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  return session;
}
