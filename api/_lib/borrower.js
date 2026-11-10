// Staff invites and borrower PIN sign-in.
// The PIN is a salted scrypt hash. A new or unrecognised device also needs an
// SMS code. The SMS provider is a no-op unless a caller supplies one or the
// SMS flag is on outside production. An ID number is never used to look anyone up.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, count, eq } from './supabase.js';
import { isSafeId } from './validate.js';
import { hashPin, verifyPin, isPin } from './pin.js';
import { borrowerBook } from './borrower-book.js';
import { staffIdentity } from './auth.js';
import { borrowerPinLive } from './quik1-flags.js';
import { apiRole } from './hosts.js';
import { clientIp, authLimiter } from './ratelimit.js';
import { smsProvider, smsTo, maskPhone } from './sms.js';
import {
  sessionSecret, mintBorrowerToken, newSessionId, readSession, readDeviceRef, readKnownDevice,
  sessionCookie, deviceCookie, knownDeviceCookie, clearSessionCookie, requestIsSecure
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

export function lockoutMs() {
  const n = parseInt(process.env.QUIK1_LOCKOUT_MINUTES, 10);
  const minutes = Number.isFinite(n) && n >= 5 && n <= 24 * 60 ? n : 15;
  return minutes * 60 * 1000;
}

function otpTtlMs() {
  const n = parseInt(process.env.QUIK1_OTP_TTL_MINUTES, 10);
  const minutes = Number.isFinite(n) && n >= 1 && n <= 15 ? n : 5;
  return minutes * 60 * 1000;
}

function missingTable(err) {
  return !!(err && (err.code === '42P01' || /42P01/.test(String(err.message || ''))));
}

export function authIpHash(ip) {
  return createHash('sha256').update(`q1-auth|${sessionSecret() || 'unset'}|${ip}`).digest('hex');
}

export function assertAuthRate(req, res) {
  const rl = authLimiter.check(clientIp(req) || 'unknown');
  if (!rl.ok) {
    if (res) res.setHeader('Retry-After', String(rl.retryAfter));
    throw new HttpError(429, 'Too many attempts');
  }
}

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_CAP = 30;

async function assertAttemptBudget(req, res) {
  const ipHash = authIpHash(clientIp(req) || 'unknown');
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
  let n = 0;
  try {
    n = await count('q1_auth_attempts', { ip_hash: eq(ipHash), created_at: 'gte.' + since });
  } catch (err) {
    if (missingTable(err)) return;
    throw err;
  }
  if (n >= ATTEMPT_CAP) {
    if (res) res.setHeader('Retry-After', '900');
    throw new HttpError(429, 'Too many attempts');
  }
}

async function noteAttempt(borrowerId, kind, req) {
  try {
    await insert('q1_auth_attempts', [{
      id: 'qa_' + randomBytes(8).toString('hex'),
      borrower_id: borrowerId || null,
      kind,
      ip_hash: authIpHash(clientIp(req) || 'unknown')
    }]);
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
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

async function revokeDevices(borrowerId, nowIso) {
  try {
    await patchWhere('q1_devices', {
      borrower_id: eq(borrowerId),
      revoked_at: 'is.null'
    }, { revoked_at: nowIso });
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
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
  await revokeDevices(borrower.id, nowIso);
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
  if (!dummyHash) dummyHash = await hashPin('000000');
  await verifyPin(isPin(pin) ? pin : '000000', dummyHash);
}

function rejectPin() {
  throw new HttpError(401, 'PIN not accepted');
}

function lockedError() {
  throw new HttpError(423, 'This account is locked. Wait and try again, or ask your loan officer for a new invite.');
}

function lockActive(borrower, now = Date.now()) {
  if (!borrower || !borrower.locked_at) return false;
  return new Date(borrower.locked_at).getTime() + lockoutMs() > now;
}

async function clearExpiredLock(borrower, now = Date.now()) {
  if (!borrower || !borrower.locked_at) return borrower;
  if (lockActive(borrower, now)) return borrower;
  if (borrower.pin_hash === LOCKED_PLACEHOLDER) return borrower;
  const nowIso = new Date(now).toISOString();
  await update('q1_borrowers', { id: borrower.id }, {
    failed_attempts: 0,
    locked_at: null,
    updated_at: nowIso
  });
  borrower.failed_attempts = 0;
  borrower.locked_at = null;
  return borrower;
}

function isLocked(borrower, now = Date.now()) {
  if (!borrower) return false;
  if (borrower.pin_hash === LOCKED_PLACEHOLDER) return true;
  if ((borrower.failed_attempts || 0) >= maxPinAttempts() && !borrower.locked_at) return true;
  return lockActive(borrower, now);
}

async function noteFailure(borrower, kind, req) {
  await noteAttempt(borrower && borrower.id, kind, req);
  const next = Math.min(maxPinAttempts(), (borrower.failed_attempts || 0) + 1);
  const nowIso = new Date().toISOString();
  const patch = {
    failed_attempts: next,
    updated_at: nowIso
  };
  if (next >= maxPinAttempts()) patch.locked_at = nowIso;
  await update('q1_borrowers', { id: borrower.id }, patch);
  borrower.failed_attempts = next;
  if (next >= maxPinAttempts()) {
    borrower.locked_at = nowIso;
    lockedError();
  }
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

function hashDeviceToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

async function trustDevice(borrowerId) {
  const token = randomBytes(32).toString('hex');
  await insert('q1_devices', [{
    id: 'qd_' + randomBytes(8).toString('hex'),
    borrower_id: borrowerId,
    token_hash: hashDeviceToken(token),
    last_seen_at: new Date().toISOString()
  }]);
  return token;
}

async function deviceRecognised(req, borrowerId) {
  const token = readKnownDevice(req);
  if (!token) return false;
  const row = await selectOne('q1_devices', {
    select: 'id,borrower_id,revoked_at',
    token_hash: eq(hashDeviceToken(token)),
    borrower_id: eq(borrowerId)
  });
  if (!row || row.revoked_at || row.borrower_id !== borrowerId) return false;
  await update('q1_devices', { id: row.id }, { last_seen_at: new Date().toISOString() });
  return true;
}

export function authCookies(minted, accountRef, req, deviceToken) {
  const secure = requestIsSecure(req);
  const out = [sessionCookie(minted.token, minted.exp, secure), deviceCookie(accountRef, secure)];
  if (deviceToken) out.push(knownDeviceCookie(deviceToken, secure));
  return out;
}

export async function redeemInvite(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  assertAuthRate(req, res);
  await assertAttemptBudget(req, res);
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const pinConfirm = typeof body.pinConfirm === 'string' ? body.pinConfirm : '';
  if (!isPin(pin) || !isPin(pinConfirm)) throw new HttpError(400, 'Choose a 6-digit PIN');
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
  await revokeDevices(borrower.id, nowIso);
  const deviceToken = await trustDevice(borrower.id);
  const { minted, accountRef } = await openSession(borrower);
  return { accountRef, cookies: authCookies(minted, accountRef, req, deviceToken) };
}

async function clientSmsTo(clientId) {
  const client = await selectOne('clients', {
    select: 'id,phone,deleted_at',
    id: eq(clientId)
  });
  if (!client || client.deleted_at) return '';
  return smsTo(client.phone);
}

async function beginOtp(req, borrower) {
  const provider = smsProvider(req);
  const to = await clientSmsTo(borrower.client_id);
  if (!provider.enabled || !to) throw new HttpError(503, 'SMS is not available');
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = await hashPin(code);
  const id = 'qo_' + randomBytes(8).toString('hex');
  const expiresAt = new Date(Date.now() + otpTtlMs()).toISOString();
  await insert('q1_otp_challenges', [{
    id,
    borrower_id: borrower.id,
    code_hash: codeHash,
    expires_at: expiresAt,
    consumed_at: null
  }]);
  let sent = { sent: false };
  try {
    sent = await provider.send(to, `Quik1 code ${code}. It expires in 5 minutes.`);
  } catch {
    sent = { sent: false };
  }
  if (!sent || !sent.sent) {
    await update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() });
    throw new HttpError(503, 'SMS is not available');
  }
  return {
    otpRequired: true,
    challengeId: id,
    phoneMasked: maskPhone(to),
    cookies: []
  };
}

export async function loginBorrower(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  assertAuthRate(req, res);
  await assertAttemptBudget(req, res);
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const fromBody = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
  const accountRef = ACCOUNT_REF.test(fromBody) ? fromBody : readDeviceRef(req);
  if (!isPin(pin) || !ACCOUNT_REF.test(accountRef)) {
    await burnPinTime(pin);
    await noteAttempt(null, 'pin', req);
    rejectPin();
  }
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    id: eq(accountRef)
  });
  if (!borrower) {
    await burnPinTime(pin);
    await noteAttempt(null, 'pin', req);
    rejectPin();
  }
  await clearExpiredLock(borrower);
  if (isLocked(borrower)) lockedError();
  const ok = await verifyPin(pin, borrower.pin_hash);
  if (!ok) await noteFailure(borrower, 'pin', req);
  try { await liveClient(borrower.client_id); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) rejectPin();
    throw e;
  }
  if (!(await deviceRecognised(req, borrower.id))) {
    return beginOtp(req, borrower);
  }
  const { minted, accountRef: ref } = await openSession(borrower);
  return { accountRef: ref, cookies: authCookies(minted, ref, req) };
}

export async function verifyOtp(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  assertAuthRate(req, res);
  await assertAttemptBudget(req, res);
  const challengeId = typeof body.challengeId === 'string' ? body.challengeId.trim() : '';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!isSafeId(challengeId) || !isPin(code)) {
    await burnPinTime(code);
    await noteAttempt(null, 'otp', req);
    throw new HttpError(401, 'Code not accepted');
  }
  const challenge = await selectOne('q1_otp_challenges', {
    select: 'id,borrower_id,code_hash,expires_at,consumed_at',
    id: eq(challengeId)
  });
  if (!challenge || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    await burnPinTime(code);
    await noteAttempt(challenge && challenge.borrower_id, 'otp', req);
    throw new HttpError(401, 'Code not accepted');
  }
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    id: eq(challenge.borrower_id)
  });
  if (!borrower) {
    await burnPinTime(code);
    throw new HttpError(401, 'Code not accepted');
  }
  await clearExpiredLock(borrower);
  if (isLocked(borrower)) lockedError();
  const ok = await verifyPin(code, challenge.code_hash);
  if (!ok) {
    await noteFailure(borrower, 'otp', req);
  }
  const nowIso = new Date().toISOString();
  const consumed = await patchWhere('q1_otp_challenges', {
    id: eq(challenge.id),
    consumed_at: 'is.null'
  }, { consumed_at: nowIso });
  if (!consumed.length) throw new HttpError(401, 'Code not accepted');
  try { await liveClient(borrower.client_id); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(401, 'Code not accepted');
    throw e;
  }
  const deviceToken = await trustDevice(borrower.id);
  const { minted, accountRef } = await openSession(borrower);
  return { accountRef, cookies: authCookies(minted, accountRef, req, deviceToken) };
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
  return borrowerBook(req);
}
