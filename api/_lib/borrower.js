// Staff invites and borrower PIN sign-in.
// Staff share the code themselves. Nothing is emailed or texted.
// The PIN is checked against a scrypt hash. An ID number is never read.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, eq } from './supabase.js';
import { isSafeId } from './validate.js';
import { hashPin, verifyPin, isPin } from './pin.js';
import { accountFromLoans, publicProfile, unidentified } from './quik1-book.js';
import { staffIdentity } from './auth.js';
import {
  sessionSecret, mintBorrowerToken, newSessionId, readSession, readDeviceRef,
  sessionCookie, deviceCookie, clearSessionCookie, requestIsSecure
} from './quik1-session.js';

const INVITE_CODE = /^[0-9a-f]{64}$/;
const ACCOUNT_REF = /^qb_[0-9a-f]{32}$/;
const LOCKED_PLACEHOLDER = 'locked';

export function inviteTtlMs() {
  const h = parseInt(process.env.QUIK1_INVITE_TTL_HOURS, 10);
  const hours = Number.isFinite(h) && h >= 1 && h <= 24 * 14 ? h : 72;
  return hours * 3600 * 1000;
}

export function maxPinAttempts() {
  const n = parseInt(process.env.QUIK1_PIN_MAX_ATTEMPTS, 10);
  return Number.isFinite(n) && n >= 3 && n <= 10 ? n : 5;
}

export function hashInviteCode(code) {
  return createHash('sha256').update(String(code), 'utf8').digest('hex');
}

function inviteLink(req, code) {
  const rawHost = (header(req, 'x-forwarded-host') || header(req, 'host') || '').split(',')[0].trim().toLowerCase();
  const host = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(rawHost) ? rawHost : '';
  const rawProto = (header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase();
  const proto = rawProto === 'http' ? 'http' : 'https';
  const origin = host ? `${proto}://${host}` : '';
  return `${origin}/quik1/#invite=${code}`;
}

function requireSessionSecret() {
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
}

async function liveClient(clientId) {
  if (!isSafeId(clientId)) throw new HttpError(400, 'bad id');
  const client = await selectOne('clients', {
    select: 'id,ref,name,bank,deleted_at',
    id: eq(clientId)
  });
  if (!client || client.deleted_at) throw new HttpError(404, 'Client not found');
  return client;
}

function inviteState(row, now = Date.now()) {
  if (!row) return 'missing';
  if (row.revoked_at) return 'revoked';
  if (row.redeemed_at) return 'redeemed';
  if (new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'open';
}

async function revokeOpenInvites(clientId, nowIso) {
  await patchWhere('q1_invites', {
    client_id: eq(clientId),
    redeemed_at: 'is.null',
    revoked_at: 'is.null'
  }, { revoked_at: nowIso });
}

async function revokeSessions(borrowerId, nowIso) {
  await patchWhere('q1_sessions', {
    borrower_id: eq(borrowerId),
    revoked_at: 'is.null'
  }, { revoked_at: nowIso });
}

// A new invite is the reset. The previous PIN stops working until this code is redeemed.
async function lockUntilRedeem(clientId, nowIso) {
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    client_id: eq(clientId)
  });
  if (!borrower) return;
  await update('q1_borrowers', { id: borrower.id }, {
    pin_hash: LOCKED_PLACEHOLDER,
    failed_attempts: maxPinAttempts(),
    locked_at: nowIso,
    updated_at: nowIso
  });
  await revokeSessions(borrower.id, nowIso);
}

export async function createInvite(req, clientId, now = Date.now()) {
  const client = await liveClient(clientId);
  const nowIso = new Date(now).toISOString();
  await revokeOpenInvites(client.id, nowIso);
  await lockUntilRedeem(client.id, nowIso);
  const code = randomBytes(32).toString('hex');
  const id = 'qi_' + randomBytes(8).toString('hex');
  const who = staffIdentity(req);
  const createdBy = who && who.email ? String(who.email).slice(0, 80) : 'ledger';
  const expiresAt = new Date(now + inviteTtlMs()).toISOString();
  await insert('q1_invites', [{
    id,
    client_id: client.id,
    code_hash: hashInviteCode(code),
    expires_at: expiresAt,
    created_by: createdBy
  }]);
  return {
    inviteId: id,
    expiresAt,
    code,
    link: inviteLink(req, code),
    clientRef: client.ref || ''
  };
}

export async function revokeInvite(inviteId) {
  if (!isSafeId(inviteId)) throw new HttpError(400, 'bad id');
  const nowIso = new Date().toISOString();
  const rows = await patchWhere('q1_invites', {
    id: eq(inviteId),
    redeemed_at: 'is.null',
    revoked_at: 'is.null'
  }, { revoked_at: nowIso });
  if (!rows.length) {
    const row = await selectOne('q1_invites', { select: 'id', id: eq(inviteId) });
    if (!row) throw new HttpError(404, 'Invite not found');
  }
  return { ok: true };
}

export async function listInvites(clientId) {
  const client = await liveClient(clientId);
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,locked_at,failed_attempts,pin_hash',
    client_id: eq(client.id)
  });
  const invites = await select('q1_invites', {
    select: 'id,expires_at,revoked_at,redeemed_at,created_at',
    client_id: eq(client.id),
    order: 'created_at.desc',
    limit: 10
  });
  const locked = !!(borrower && (borrower.locked_at || borrower.pin_hash === LOCKED_PLACEHOLDER));
  return {
    clientRef: client.ref || '',
    locked,
    hasPin: !!(borrower && borrower.pin_hash && borrower.pin_hash.startsWith('scrypt$')),
    invites: (invites || []).map(row => ({
      id: row.id,
      state: inviteState(row),
      expiresAt: row.expires_at,
      createdAt: row.created_at
    }))
  };
}

let dummyHash = '';
async function burnPinTime(pin) {
  if (!dummyHash) dummyHash = await hashPin('0000');
  await verifyPin(isPin(pin) ? pin : '0000', dummyHash);
}

function rejectPin() {
  throw new HttpError(401, 'PIN not accepted');
}

function lockedError() {
  throw new HttpError(423, 'This account is locked. Ask your loan officer for a new invite.');
}

function isLocked(borrower) {
  if (!borrower) return false;
  if (borrower.locked_at) return true;
  if (borrower.pin_hash === LOCKED_PLACEHOLDER) return true;
  return (borrower.failed_attempts || 0) >= maxPinAttempts();
}

async function noteFailure(borrower) {
  const next = Math.min(maxPinAttempts(), (borrower.failed_attempts || 0) + 1);
  const nowIso = new Date().toISOString();
  const patch = {
    failed_attempts: next,
    updated_at: nowIso
  };
  if (next >= maxPinAttempts()) patch.locked_at = nowIso;
  await update('q1_borrowers', { id: borrower.id }, patch);
  if (next >= maxPinAttempts()) lockedError();
  rejectPin();
}

async function openSession(borrower, now = Date.now()) {
  requireSessionSecret();
  const nowIso = new Date(now).toISOString();
  await update('q1_borrowers', { id: borrower.id }, {
    failed_attempts: 0,
    locked_at: null,
    updated_at: nowIso
  });
  await revokeSessions(borrower.id, nowIso);
  const sid = newSessionId();
  const minted = mintBorrowerToken({ sid, bid: borrower.id, cid: borrower.client_id }, now);
  if (!minted) throw new HttpError(503, 'Server not configured');
  await insert('q1_sessions', [{
    id: sid,
    borrower_id: borrower.id,
    client_id: borrower.client_id,
    expires_at: new Date(minted.exp).toISOString()
  }]);
  return { minted, accountRef: borrower.id };
}

export function authCookies(minted, accountRef, req) {
  const secure = requestIsSecure(req);
  return [sessionCookie(minted.token, minted.exp, secure), deviceCookie(accountRef, secure)];
}

export async function redeemInvite(req, body) {
  requireSessionSecret();
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const pinConfirm = typeof body.pinConfirm === 'string' ? body.pinConfirm : '';
  if (!isPin(pin) || !isPin(pinConfirm)) throw new HttpError(400, 'Choose a 4-digit PIN');
  if (pin !== pinConfirm) throw new HttpError(400, 'PINs do not match');
  if (!INVITE_CODE.test(code)) throw new HttpError(410, 'This invite is no longer valid');

  const row = await selectOne('q1_invites', {
    select: 'id,client_id,expires_at,revoked_at,redeemed_at',
    code_hash: eq(hashInviteCode(code))
  });
  if (!row || inviteState(row) !== 'open') throw new HttpError(410, 'This invite is no longer valid');
  await liveClient(row.client_id);

  const pinHash = await hashPin(pin);
  const nowIso = new Date().toISOString();
  const consumed = await patchWhere('q1_invites', {
    id: eq(row.id),
    redeemed_at: 'is.null',
    revoked_at: 'is.null',
    expires_at: 'gt.' + nowIso
  }, { redeemed_at: nowIso });
  if (!consumed.length) throw new HttpError(410, 'This invite is no longer valid');

  let borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    client_id: eq(row.client_id)
  });
  if (borrower) {
    await update('q1_borrowers', { id: borrower.id }, {
      pin_hash: pinHash,
      failed_attempts: 0,
      locked_at: null,
      updated_at: nowIso
    });
  } else {
    const id = 'qb_' + randomBytes(16).toString('hex');
    await insert('q1_borrowers', [{
      id,
      client_id: row.client_id,
      pin_hash: pinHash,
      failed_attempts: 0,
      locked_at: null
    }]);
    borrower = { id, client_id: row.client_id };
  }
  const { minted, accountRef } = await openSession(borrower);
  return { accountRef, cookies: authCookies(minted, accountRef, req) };
}

export async function loginBorrower(req, body) {
  requireSessionSecret();
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const fromBody = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
  const accountRef = ACCOUNT_REF.test(fromBody) ? fromBody : readDeviceRef(req);
  if (!isPin(pin) || !ACCOUNT_REF.test(accountRef)) {
    await burnPinTime(pin);
    rejectPin();
  }
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    id: eq(accountRef)
  });
  if (!borrower) {
    await burnPinTime(pin);
    rejectPin();
  }
  if (isLocked(borrower)) lockedError();
  const ok = await verifyPin(pin, borrower.pin_hash);
  if (!ok) await noteFailure(borrower);
  try { await liveClient(borrower.client_id); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) rejectPin();
    throw e;
  }
  const { minted, accountRef: ref } = await openSession(borrower);
  return { accountRef: ref, cookies: authCookies(minted, ref, req) };
}

export async function logoutBorrower(req) {
  const sess = readSession(req);
  if (sess) {
    const nowIso = new Date().toISOString();
    await patchWhere('q1_sessions', { id: eq(sess.sid), revoked_at: 'is.null' }, { revoked_at: nowIso });
  }
  return { cookies: [clearSessionCookie(requestIsSecure(req))] };
}

export async function borrowerHome(req) {
  const sess = readSession(req);
  if (!sess) return unidentified();
  const session = await selectOne('q1_sessions', {
    select: 'id,borrower_id,client_id,expires_at,revoked_at',
    id: eq(sess.sid)
  });
  if (!session || session.revoked_at) return unidentified();
  if (session.borrower_id !== sess.bid || session.client_id !== sess.cid) return unidentified();
  if (new Date(session.expires_at).getTime() <= Date.now()) return unidentified();
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    id: eq(sess.bid)
  });
  if (!borrower || borrower.client_id !== sess.cid) return unidentified();
  const client = await selectOne('clients', {
    select: 'id,ref,name,bank,deleted_at',
    id: eq(borrower.client_id)
  });
  if (!client || client.deleted_at) return unidentified();
  const loans = await select('loans', {
    select: 'id,ref,principal,status,schedule,instalment_amount,issued_on,deleted_at,client_id',
    client_id: eq(client.id)
  });
  return {
    identified: true,
    profile: publicProfile(client),
    account: accountFromLoans(loans)
  };
}
