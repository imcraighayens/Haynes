// Staff invites and borrower PIN sign-in.
// A new device is confirmed by an email link when email is configured.
// An ID number is never used to look anyone up.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, count, eq } from './supabase.js';
import { isSafeId, cleanEmail } from './validate.js';
import { hashPin, verifyPin, isPin, isLegacyPin, isChosenPin } from './pin.js';
import { borrowerBook } from './borrower-book.js';
import { staffIdentity } from './auth.js';
import { borrowerPinLive } from './quik1-flags.js';
import { apiRole } from './hosts.js';
import { clientIp, authLimiter } from './ratelimit.js';
import { emailSender } from './email.js';
import {
  sessionSecret, mintBorrowerToken, newSessionId, readSession, readDeviceRef, readKnownDevice, readPendingDevice,
  sessionCookie, deviceCookie, knownDeviceCookie, clearKnownCookie, clearSessionCookie,
  pendingDeviceCookie, clearPendingCookie, requestIsSecure
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
  const minutes = Number.isFinite(n) && n >= 1 && n <= 60 ? n : 15;
  return minutes * 60 * 1000;
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
  } catch {
    throw new HttpError(503, 'Server not configured');
  }
  if (n >= ATTEMPT_CAP) {
    if (res) res.setHeader('Retry-After', '900');
    throw new HttpError(429, 'Too many attempts');
  }
}

export async function guardAuth(req, res) {
  assertAuthRate(req, res);
  await assertAttemptBudget(req, res);
}

const ATTEMPT_KEEP_MS = 90 * 24 * 3600 * 1000;

async function noteAttempt(borrowerId, kind, req) {
  try {
    await insert('q1_auth_attempts', [{
      id: 'qa_' + randomBytes(8).toString('hex'),
      borrower_id: borrowerId || null,
      kind,
      ip_hash: authIpHash(clientIp(req) || 'unknown'),
      expires_at: new Date(Date.now() + ATTEMPT_KEEP_MS).toISOString()
    }]);
  } catch {
    throw new HttpError(503, 'Server not configured');
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

// True only when that table is absent. A live empty table is false.
async function relationMissing(table) {
  try {
    await selectOne(table, { select: 'id', limit: 1 });
    return false;
  } catch (err) {
    if (missingTable(err)) return true;
    throw err;
  }
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
    device_reset_until: null,
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

function deviceTtlMs() {
  const days = parseInt(process.env.QUIK1_DEVICE_TTL_DAYS, 10);
  const n = Number.isFinite(days) && days >= 1 && days <= 365 ? days : 90;
  return n * 24 * 3600 * 1000;
}

async function trustDevice(borrowerId, now = Date.now()) {
  const token = randomBytes(32).toString('hex');
  const nowIso = new Date(now).toISOString();
  await insert('q1_devices', [{
    id: 'qd_' + randomBytes(8).toString('hex'),
    borrower_id: borrowerId,
    token_hash: hashDeviceToken(token),
    last_seen_at: nowIso,
    expires_at: new Date(now + deviceTtlMs()).toISOString()
  }]);
  return token;
}

async function deviceRecognised(req, borrowerId) {
  const token = readKnownDevice(req);
  if (!token) return '';
  const row = await selectOne('q1_devices', {
    select: 'id,borrower_id,revoked_at,expires_at',
    token_hash: eq(hashDeviceToken(token)),
    borrower_id: eq(borrowerId)
  });
  if (!row || row.revoked_at || row.borrower_id !== borrowerId) return '';
  if (!row.expires_at || new Date(row.expires_at).getTime() <= Date.now()) return '';
  const nowIso = new Date().toISOString();
  await update('q1_devices', { id: row.id }, { revoked_at: nowIso });
  return trustDevice(borrowerId);
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
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  const pinConfirm = typeof body.pinConfirm === 'string' ? body.pinConfirm : '';
  if (!isChosenPin(pin) || !isChosenPin(pinConfirm)) throw new HttpError(400, 'Choose a 6-digit PIN that is not a run or all one digit');
  if (pin !== pinConfirm) throw new HttpError(400, 'PINs do not match');
  if (!INVITE_CODE.test(code)) throw new HttpError(410, 'This invite is no longer valid');

  try {
    await assertAttemptBudget(req, res);
  } catch (err) {
    if (err instanceof HttpError && err.status === 503 && await relationMissing('q1_invites')) throw notSetUp();
    throw err;
  }

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
        device_reset_until: null,
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
  } catch (err) {
    // Missing auth tables must not mint a session.
    if (missingTable(err)) throw notSetUp();
    throw err;
  }
}

function ttlMinutes() {
  return Math.max(1, Math.round(otpTtlMs() / 60000));
}

function verifyCooldownMs() {
  const n = parseInt(process.env.QUIK1_VERIFY_COOLDOWN_SECONDS, 10);
  const seconds = Number.isFinite(n) && n >= 30 && n <= 300 ? n : 60;
  return seconds * 1000;
}

function verifyHourlyCap() {
  const n = parseInt(process.env.QUIK1_VERIFY_HOURLY_CAP, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 5;
}

function sigEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

function mintVerifyTicket(accountRef, now = Date.now()) {
  const exp = now + 10 * 60 * 1000;
  const sig = createHmac('sha256', sessionSecret()).update(`q1v|${accountRef}|${exp}`).digest('base64url');
  return `${exp}.${sig}`;
}

function ticketOk(accountRef, token, now = Date.now()) {
  if (!sessionSecret() || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < now || exp > now + 15 * 60 * 1000) return false;
  const expected = createHmac('sha256', sessionSecret()).update(`q1v|${accountRef}|${exp}`).digest('base64url');
  return sigEqual(sig, expected);
}

async function clientEmail(clientId) {
  const client = await selectOne('clients', {
    select: 'id,email,deleted_at',
    id: eq(clientId)
  });
  if (!client || client.deleted_at) return '';
  return cleanEmail(client.email) || '';
}

function offerVerification(req, borrower) {
  const mail = emailSender(req);
  return clientEmail(borrower.client_id).then(email => {
    const ready = !!(mail.enabled && email);
    const body = {
      verifyRequired: true,
      contactStaff: !ready,
      cookies: []
    };
    if (ready) body.verifyToken = mintVerifyTicket(borrower.id);
    return body;
  });
}

async function assertVerifyBudget(borrowerId) {
  const latest = await selectOne('q1_otp_challenges', {
    select: 'id,created_at',
    borrower_id: eq(borrowerId),
    order: 'created_at.desc'
  });
  if (latest && latest.created_at && Date.now() - new Date(latest.created_at).getTime() < verifyCooldownMs()) {
    throw new HttpError(429, 'Wait before requesting another code');
  }
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const n = await count('q1_otp_challenges', { borrower_id: eq(borrowerId), created_at: 'gte.' + since });
  if (n >= verifyHourlyCap()) throw new HttpError(429, 'Too many verification messages');
}

async function invalidateChallenges(borrowerId, nowIso) {
  await patchWhere('q1_otp_challenges', {
    borrower_id: eq(borrowerId),
    consumed_at: 'is.null'
  }, { consumed_at: nowIso });
}

function verifyPageLink(req, token) {
  const rawHost = (header(req, 'x-forwarded-host') || header(req, 'host') || '').split(',')[0].trim().toLowerCase();
  const host = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(rawHost) ? rawHost : '';
  if (host && apiRole(host, '') === 'staff') return `https://quik1.app/quik1/#verify=${token}`;
  const rawProto = (header(req, 'x-forwarded-proto') || 'https').split(',')[0].trim().toLowerCase();
  const proto = rawProto === 'http' ? 'http' : 'https';
  const origin = host ? `${proto}://${host}` : '';
  return `${origin}/quik1/#verify=${token}`;
}

function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export async function issueVerification(req, body) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  const accountRef = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
  const ticket = typeof body.verifyToken === 'string' ? body.verifyToken : '';
  if (!ACCOUNT_REF.test(accountRef) || !ticketOk(accountRef, ticket)) {
    throw new HttpError(401, 'Sign in again');
  }
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    id: eq(accountRef)
  });
  if (!borrower) throw new HttpError(401, 'Sign in again');
  const to = await clientEmail(borrower.client_id);
  const mail = emailSender(req);
  if (!mail.enabled || !to) throw new HttpError(503, 'Email verification unavailable');
  await assertVerifyBudget(borrower.id);
  const nowIso = new Date().toISOString();
  await invalidateChallenges(borrower.id, nowIso);
  const pending = randomBytes(32).toString('hex');
  const token = randomBytes(32).toString('hex');
  const id = 'qo_' + randomBytes(8).toString('hex');
  const minutes = ttlMinutes();
  await insert('q1_otp_challenges', [{
    id,
    borrower_id: borrower.id,
    channel: 'email',
    token_hash: hashToken(token),
    device_hash: hashToken(pending),
    expires_at: new Date(Date.now() + otpTtlMs()).toISOString(),
    consumed_at: null
  }]);
  const link = verifyPageLink(req, token);
  let sent = { sent: false };
  try {
    sent = await mail.send(to, 'Confirm your Quik1 phone', `Open this link on the phone that asked for it. It expires in ${minutes} minutes.\n${link}`);
  } catch {
    sent = { sent: false };
  }
  if (!sent || !sent.sent) {
    await update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() });
    throw new HttpError(503, 'Email verification unavailable');
  }
  return {
    sent: true,
    cookies: [pendingDeviceCookie(pending, Math.ceil(otpTtlMs() / 1000), requestIsSecure(req))]
  };
}

export async function consumeEmailLink(req, body) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!/^[0-9a-f]{64}$/.test(token)) throw new HttpError(401, 'This link is no longer valid');
  const challenge = await selectOne('q1_otp_challenges', {
    select: 'id,borrower_id,token_hash,device_hash,expires_at,consumed_at,channel',
    token_hash: eq(hashToken(token))
  });
  if (!challenge || challenge.channel !== 'email' || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'This link is no longer valid');
  }
  if (!deviceMatches(req, challenge)) throw new HttpError(401, 'Open the link on the phone that asked for it');
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    id: eq(challenge.borrower_id)
  });
  if (!borrower) throw new HttpError(401, 'This link is no longer valid');
  if (isLocked(borrower)) lockedError();
  const consumed = await patchWhere('q1_otp_challenges', {
    id: eq(challenge.id),
    consumed_at: 'is.null'
  }, { consumed_at: new Date().toISOString() });
  if (!consumed.length) throw new HttpError(401, 'This link is no longer valid');
  try { await liveClient(borrower.client_id); }
  catch (e) {
    if (e instanceof HttpError && e.status === 404) throw new HttpError(401, 'This link is no longer valid');
    throw e;
  }
  return finishVerified(req, borrower);
}

async function finishVerified(req, borrower) {
  const deviceToken = await trustDevice(borrower.id);
  const { minted, accountRef } = await openSession(borrower);
  const secure = requestIsSecure(req);
  return {
    accountRef,
    cookies: [...authCookies(minted, accountRef, req, deviceToken), clearPendingCookie(secure)]
  };
}

function deviceMatches(req, challenge) {
  const pending = readPendingDevice(req);
  return !!(pending && challenge && challenge.device_hash && hashToken(pending) === challenge.device_hash);
}

export async function loginBorrower(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  requireSessionSecret();
  assertAuthRate(req, res);
  const pin = typeof body.pin === 'string' ? body.pin : '';
  try {
    await assertAttemptBudget(req, res);
  } catch (err) {
    // The attempt log is required once borrower auth exists. If that schema is
    // absent entirely, this is the same as a bad PIN and must not set a cookie.
    if (err instanceof HttpError && err.status === 503 && await relationMissing('q1_borrowers')) {
      await burnPinTime(pin);
      rejectPin();
    }
    throw err;
  }
  const fromBody = typeof body.accountRef === 'string' ? body.accountRef.trim() : '';
  const accountRef = ACCOUNT_REF.test(fromBody) ? fromBody : readDeviceRef(req);
  if (!(isPin(pin) || isLegacyPin(pin)) || !ACCOUNT_REF.test(accountRef)) {
    await burnPinTime(pin);
    await noteAttempt(null, 'pin', req);
    rejectPin();
  }
  try {
    const borrower = await selectOne('q1_borrowers', {
      select: 'id,client_id,pin_hash,failed_attempts,locked_at,device_reset_until',
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
    const rotated = await deviceRecognised(req, borrower.id);
    if (rotated) {
      const { minted, accountRef: ref } = await openSession(borrower);
      return { accountRef: ref, cookies: authCookies(minted, ref, req, rotated) };
    }
    const address = await clientEmail(borrower.client_id);
    const mail = emailSender(req);
    if (!(mail.enabled && address)) {
      const nowIso = new Date().toISOString();
      const claimed = await patchWhere('q1_borrowers', {
        id: eq(borrower.id),
        device_reset_until: 'gt.' + nowIso
      }, { device_reset_until: null, updated_at: nowIso });
      if (claimed.length) {
        const token = await trustDevice(borrower.id);
        const { minted, accountRef: ref } = await openSession(borrower);
        return { accountRef: ref, cookies: authCookies(minted, ref, req, token) };
      }
    }
    return offerVerification(req, borrower);
  } catch (err) {
    // No borrower table means there is no account. Same answer as a bad PIN, and no cookie.
    if (missingTable(err)) {
      await burnPinTime(pin);
      rejectPin();
    }
    throw err;
  }
}

export async function resetBorrowerDevices(req, clientId) {
  const client = await liveClient(clientId);
  const nowIso = new Date().toISOString();
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id',
    client_id: eq(client.id)
  });
  const address = borrower ? await clientEmail(client.id) : '';
  const mail = emailSender(req);
  const emailLive = !!(mail.enabled && address);
  if (borrower) {
    await revokeDevices(borrower.id, nowIso);
    await invalidateChallenges(borrower.id, nowIso);
    await revokeSessions(borrower.id, nowIso);
    await update('q1_borrowers', { id: borrower.id }, {
      device_reset_until: emailLive ? null : new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      updated_at: nowIso
    });
  }
  const who = staffIdentity(req);
  const by = who && (who.displayName || who.email) ? String(who.displayName || who.email).slice(0, 80) : 'ledger';
  const windowNote = emailLive
    ? ' The next phone must open the email link.'
    : ' The next correct PIN on a new phone is trusted once within 24 hours.';
  try {
    await insert('audit_log', [{
      id: 'aud_q1_' + randomBytes(6).toString('hex'),
      at: nowIso,
      type: 'QUIK1 DEVICE RESET',
      ref: client.ref || '—',
      customer: '—',
      amount: 0,
      by,
      comment: 'Revoked every open Quik1 session and trusted device for ' + (client.ref || 'a client') + '. The PIN was not changed.' + windowNote
    }], { returning: false });
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  return { ok: true, cleared: !!borrower };
}

export async function logoutBorrower(req) {
  const sess = readSession(req);
  const nowIso = new Date().toISOString();
  if (sess) {
    try {
      await patchWhere('q1_sessions', { id: eq(sess.sid), revoked_at: 'is.null' }, { revoked_at: nowIso });
    } catch (err) {
      // The browser cookie still has to die. A missing table is already signed out.
      // Any other failure stays an error so a live session is not forgotten server-side.
      if (!missingTable(err)) throw err;
    }
  }
  const known = readKnownDevice(req);
  if (known) {
    try {
      await patchWhere('q1_devices', {
        token_hash: eq(hashDeviceToken(known)),
        revoked_at: 'is.null'
      }, { revoked_at: nowIso });
    } catch (err) {
      if (!missingTable(err)) throw err;
    }
  }
  const secure = requestIsSecure(req);
  return { cookies: [clearSessionCookie(secure), clearKnownCookie(secure), clearPendingCookie(secure)] };
}

export async function borrowerHome(req) {
  return borrowerBook(req);
}
