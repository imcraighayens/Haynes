// Face ID / fingerprint unlock for one borrower on one device.
// The credential's public key is stored by borrower id. The PIN stays the fallback.
// If the migration has not been applied, every call reports that and signs nobody in.
import { randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, eq } from './supabase.js';
import { borrowerBiometricLive } from './quik1-flags.js';
import { requestHost, requestHostname } from './auth.js';
import { requireBorrower } from './borrower-book.js';
import { startBorrowerSession } from './borrower.js';
import {
  b64urlEncode, b64urlDecode, sha256, parseClientData, parseAuthData,
  registrationFromAttestation, verifyAssertion
} from './webauthn.js';

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

export function relyingParty(req) {
  const raw = requestHost(req);
  const host = requestHostname(req);
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/.test(raw) || !host) throw new HttpError(400, 'Bad host');
  const proto = (header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase();
  return { rpId: host, origin: `${proto === 'http' ? 'http' : 'https'}://${raw}` };
}

function newChallenge() {
  return b64urlEncode(randomBytes(32));
}

async function storeChallenge(borrowerId, purpose, now = Date.now()) {
  const challenge = newChallenge();
  const id = 'qc_' + randomBytes(8).toString('hex');
  try {
    await insert('q1_webauthn_challenges', [{
      id,
      borrower_id: borrowerId,
      purpose,
      challenge,
      expires_at: new Date(now + CHALLENGE_MS).toISOString()
    }]);
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  return challenge;
}

async function consumeChallenge(borrowerId, purpose, challenge, now = Date.now()) {
  let rows;
  try {
    rows = await select('q1_webauthn_challenges', {
      select: 'id,challenge,expires_at,consumed_at,borrower_id,purpose',
      borrower_id: eq(borrowerId),
      purpose: eq(purpose),
      consumed_at: 'is.null'
    });
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  const hit = (rows || []).find(row => row
    && row.challenge === challenge
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

function livePin(borrower) {
  return !!(borrower && typeof borrower.pin_hash === 'string' && borrower.pin_hash.startsWith('scrypt$') && !borrower.locked_at);
}

export async function registerOptions(req) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  const { borrower } = await requireBorrower(req);
  const row = await selectOne('q1_borrowers', {
    select: 'id,pin_hash,locked_at',
    id: eq(borrower.id)
  });
  if (!livePin(row)) throw usePin();
  const { rpId, origin } = relyingParty(req);
  const challenge = await storeChallenge(borrower.id, 'register');
  return {
    challenge,
    rpId,
    origin,
    userId: b64urlEncode(Buffer.from(borrower.id, 'utf8'))
  };
}

export async function registerCredential(req, body) {
  if (!borrowerBiometricLive(req)) throw unavailable();
  const { borrower } = await requireBorrower(req);
  const { origin, rpId } = relyingParty(req);
  const clientData = b64urlDecode(body && body.clientDataJSON);
  const attestation = b64urlDecode(body && body.attestationObject);
  if (!clientData || !attestation) throw usePin();
  const reg = registrationFromAttestation(attestation);
  if (!reg || !reg.parsed.up || !reg.parsed.uv) throw usePin();
  if (!sha256(rpId).equals(reg.parsed.rpIdHash)) throw usePin();
  let client;
  try { client = JSON.parse(clientData.toString('utf8')); } catch { throw usePin(); }
  if (!client || client.type !== 'webauthn.create' || client.origin !== origin) throw usePin();
  if (typeof client.challenge !== 'string') throw usePin();
  const fresh = await consumeChallenge(borrower.id, 'register', client.challenge);
  if (!fresh) throw usePin();
  const credentialId = b64urlEncode(reg.parsed.credentialId);
  if (!CRED_ID.test(credentialId)) throw usePin();
  const existing = await selectOne('q1_webauthn_credentials', {
    select: 'id,borrower_id,revoked_at',
    id: eq(credentialId)
  }).catch(err => { if (missingTable(err)) throw notSetUp(); throw err; });
  if (existing && existing.borrower_id !== borrower.id) throw usePin();
  const nowIso = new Date().toISOString();
  if (existing) {
    await update('q1_webauthn_credentials', { id: credentialId }, {
      public_key: b64urlEncode(reg.cose),
      sign_count: reg.parsed.signCount,
      revoked_at: null,
      last_used_at: nowIso
    });
  } else {
    try {
      await insert('q1_webauthn_credentials', [{
        id: credentialId,
        borrower_id: borrower.id,
        public_key: b64urlEncode(reg.cose),
        sign_count: reg.parsed.signCount
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
  const credentialId = typeof body.credentialId === 'string' ? body.credentialId : '';
  const clientData = b64urlDecode(body && body.clientDataJSON);
  const authenticatorData = b64urlDecode(body && body.authenticatorData);
  const signature = b64urlDecode(body && body.signature);
  if (!CRED_ID.test(credentialId) || !clientData || !authenticatorData || !signature) throw usePin();
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
  if (!cred || cred.revoked_at || cred.borrower_id == null) throw usePin();
  const parsed = parseAuthData(authenticatorData);
  if (!parsed || !parsed.up || !parsed.uv || parsed.credentialId) throw usePin();
  if (!sha256(rpId).equals(parsed.rpIdHash)) throw usePin();
  let client;
  try { client = JSON.parse(clientData.toString('utf8')); } catch { throw usePin(); }
  if (!parseClientData(clientData, { type: 'webauthn.get', origin, challenge: client && client.challenge })) throw usePin();
  const cose = b64urlDecode(cred.public_key);
  if (!cose || !verifyAssertion({ authenticatorData, clientData, signature, publicKey: cose })) throw usePin();
  const previous = Number(cred.sign_count) || 0;
  if (previous > 0 && parsed.signCount <= previous) throw usePin();
  const fresh = await consumeChallenge(cred.borrower_id, 'login', client.challenge);
  if (!fresh) throw usePin();
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,locked_at',
    id: eq(cred.borrower_id)
  });
  if (!livePin(borrower)) throw usePin();
  await update('q1_webauthn_credentials', { id: credentialId }, {
    sign_count: parsed.signCount,
    last_used_at: new Date().toISOString()
  });
  return startBorrowerSession(borrower, req);
}
