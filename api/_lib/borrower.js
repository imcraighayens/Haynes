// Staff invites and borrower PIN sign-in.
// Staff share the code themselves. Nothing is emailed or texted.
// The PIN is checked against a scrypt hash. An ID number is never read.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, eq } from './supabase.js';
import { isSafeId } from './validate.js';
import { hashPin, verifyPin, isPin } from './pin.js';
import { borrowerBook } from './borrower-book.js';
import { staffIdentity } from './auth.js';
import { borrowerPinLive } from './quik1-flags.js';
import { apiRole } from './hosts.js';
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
  // Staff pages do not serve /quik1, so an invite created there opens on the borrower site.
  if (host && apiRole(host, '') === 'staff') return `https://quik1.app/quik1/#invite=${code}`;
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

const ACCESS_LABEL = {
  none: 'No access',
  invited: 'Invited',
  pin: 'PIN set',
  locked: 'Locked',
  revoked: 'Revoked',
  unavailable: 'Quik1 access not set up yet'
};

function missingTable(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}

function notSetUp() {
  return new HttpError(503, ACCESS_LABEL.unavailable);
}

function accessFrom(borrower, invites, now = Date.now()) {
  const list = Array.isArray(invites) ? invites : [];
  const open = list.find(row => inviteState(row, now) === 'open') || null;
  const newest = list[0] || null;
  const hasPin = !!(borrower && typeof borrower.pin_hash === 'string' && borrower.pin_hash.startsWith('scrypt$'));
  const staffLocked = !!(borrower && (borrower.pin_hash === LOCKED_PLACEHOLDER || (borrower.locked_at && !hasPin)));
  let access = 'none';
  if (open) access = 'invited';
  else if (hasPin && isLocked(borrower)) access = 'locked';
  else if (hasPin) access = 'pin';
  else if (staffLocked) access = 'revoked';
  else if (newest && inviteState(newest, now) === 'revoked') access = 'revoked';
  return { access, open };
}

function accessPayload(client, borrower, invites, now = Date.now()) {
  const view = accessFrom(borrower, invites, now);
  const mapped = (invites || []).map(row => ({
    id: row.id,
    state: inviteState(row, now),
    expiresAt: row.expires_at,
    createdAt: row.created_at
  }));
  return {
    ready: true,
    clientRef: client.ref || '',
    locked: !!(borrower && (borrower.locked_at || borrower.pin_hash === LOCKED_PLACEHOLDER)),
    hasPin: !!(borrower && borrower.pin_hash && String(borrower.pin_hash).startsWith('scrypt$')),
    access: view.access,
    accessLabel: ACCESS_LABEL[view.access],
    expiresAt: view.open ? view.open.expires_at : null,
    inviteId: view.open ? view.open.id : null,
    invites: mapped
  };
}

function unavailablePayload(client) {
  return {
    ready: false,
    clientRef: (client && client.ref) || '',
    locked: false,
    hasPin: false,
    access: 'unavailable',
    accessLabel: ACCESS_LABEL.unavailable,
    expiresAt: null,
    inviteId: null,
    invites: []
  };
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
  try {
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
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
}

export async function revokeInvite(inviteId) {
  if (!isSafeId(inviteId)) throw new HttpError(400, 'bad id');
  const nowIso = new Date().toISOString();
  try {
    const rows = await patchWhere('q1_invites', {
      id: eq(inviteId),
      redeemed_at: 'is.null',
      revoked_at: 'is.null'
    }, { revoked_at: nowIso });
    if (!rows.length) {
      const row = await selectOne('q1_invites', { select: 'id', id: eq(inviteId) });
      if (!row) throw new HttpError(404, 'Invite not found');
    }
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  return { ok: true };
}

export async function listInvites(clientId) {
  const client = await liveClient(clientId);
  try {
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
    return accessPayload(client, borrower, invites || []);
  } catch (err) {
    if (missingTable(err)) return unavailablePayload(client);
    throw err;
  }
}

// Staff revoke. Open links die, and a PIN that was already set stops working
// until the client opens a new invite and chooses another PIN.
export async function revokeAccess(clientId) {
  const client = await liveClient(clientId);
  const nowIso = new Date().toISOString();
  try {
    await revokeOpenInvites(client.id, nowIso);
    await lockUntilRedeem(client.id, nowIso);
  } catch (err) {
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
  return listInvites(client.id);
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
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const pinConfirm = typeof body.pinConfirm === 'string' ? body.pinConfirm : '';
  if (!isPin(pin) || !isPin(pinConfirm)) throw new HttpError(400, 'Choose a 4-digit PIN');
  if (pin !== pinConfirm) throw new HttpError(400, 'PINs do not match');
  if (!INVITE_CODE.test(code)) throw new HttpError(410, 'This invite is no longer valid');

  try {
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
  } catch (err) {
    // Missing auth tables must not mint a session.
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
}

export async function loginBorrower(req, body) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const fromBody = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
  const accountRef = ACCOUNT_REF.test(fromBody) ? fromBody : readDeviceRef(req);
  if (!isPin(pin) || !ACCOUNT_REF.test(accountRef)) {
    await burnPinTime(pin);
    rejectPin();
  }
  try {
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
  } catch (err) {
    // No borrower table means there is no account. Same answer as a bad PIN, and no cookie.
    if (missingTable(err)) {
      await burnPinTime(pin);
      rejectPin();
    }
    throw err;
  }
}

export async function logoutBorrower(req) {
  const sess = readSession(req);
  if (sess) {
    const nowIso = new Date().toISOString();
    try {
      await patchWhere('q1_sessions', { id: eq(sess.sid), revoked_at: 'is.null' }, { revoked_at: nowIso });
    } catch (err) {
      // The browser cookie still has to die. A missing table is already signed out.
      // Any other failure stays an error so a live session is not forgotten server-side.
      if (!missingTable(err)) throw err;
    }
  }
  return { cookies: [clearSessionCookie(requestIsSecure(req))] };
}

export async function borrowerHome(req) {
  return borrowerBook(req);
}
