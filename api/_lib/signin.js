// Email sign-in, and ID plus cellphone that continues by a one-time SMS code.
// The HTTP body is the same whether or not an account matches. ID and phone
// are compared as keyed HMACs. ID and phone alone never sign anyone in.
// A session is created only after the SMS code is entered on the same phone.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, count, eq } from './supabase.js';
import { cleanEmail } from './validate.js';
import { borrowerPinLive } from './quik1-flags.js';
import { apiRole } from './hosts.js';
import { clientIp } from './ratelimit.js';
import { borrowerEmailLive, emailSender } from './email.js';
import { sessionSecret, pendingDeviceCookie, requestIsSecure, clearPendingCookie } from './quik1-session.js';
import { guardAuth, authIpHash, logAuthAttempt, maxPinAttempts, lockoutMs, deviceMatches, startBorrowerSession, signInWithPin } from './borrower.js';
import { idHmac, phoneHmac, normaliseSaId, normaliseCell, hmacKey } from './sa-id.js';
import { isPin, isLegacyPin, enterPinMessage, pinNotAcceptedMessage } from './pin.js';
import { smsTransport, smsTtlMs, newSmsCode, SMS_CODE_LENGTH, SMS_UNAVAILABLE } from './sms.js';

const LOCKED_PLACEHOLDER = 'locked';
const SIGNIN_CLOSED = 'Sign in with your email for now';
const EMAIL_OFF = "This phone isn't linked yet. Please contact EcoLoans and we'll reset your access.";
export const SIGNIN_PAD_MS = 800;
export const SMS_NEUTRAL = 'If we have this account, we sent a code by SMS. It works once.';
export const SMS_REFUSED = 'Those details were not accepted.';
export { SMS_UNAVAILABLE };

export function neutralSignIn() {
  return {
    sent: true,
    message: 'If we have this account, we sent a link to the email on file. Open it on this phone. It works once.'
  };
}

export async function padSignIn(started) {
  const wait = SIGNIN_PAD_MS - (Date.now() - started);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

function otpTtlMs() {
  const n = parseInt(process.env.QUIK1_OTP_TTL_MINUTES, 10);
  const minutes = Number.isFinite(n) && n >= 1 && n <= 60 ? n : 15;
  return minutes * 60 * 1000;
}

function cooldownMs() {
  const n = parseInt(process.env.QUIK1_SIGNIN_COOLDOWN_SECONDS, 10);
  const seconds = Number.isFinite(n) && n >= 30 && n <= 300 ? n : 60;
  return seconds * 1000;
}

function hourlyCap(kind) {
  const name = kind === 'id_phone' ? 'QUIK1_ID_PHONE_HOURLY_CAP' : 'QUIK1_SIGNIN_HOURLY_CAP';
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? n : 5;
}

function subjectHash(kind, value) {
  return createHash('sha256').update(`q1-${kind}|${sessionSecret() || 'unset'}|${value}`).digest('hex');
}

function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function missingColumn(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42703' || code === 'PGRST204' || /42703|PGRST204/.test(msg);
}

function isLocked(borrower, now = Date.now()) {
  if (!borrower) return false;
  if (borrower.pin_hash === LOCKED_PLACEHOLDER) return true;
  if ((borrower.failed_attempts || 0) >= maxPinAttempts() && !borrower.locked_at) return true;
  if (borrower.locked_at && new Date(borrower.locked_at).getTime() + lockoutMs() > now) return true;
  return false;
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

function pendingCookies(req, pending) {
  return [pendingDeviceCookie(pending, Math.ceil(otpTtlMs() / 1000), requestIsSecure(req))];
}

async function assertSubjectBudget(kind, subject, res) {
  const latest = await selectOne('q1_auth_attempts', {
    select: 'id,created_at',
    subject_hash: eq(subject),
    kind: eq(kind),
    order: 'created_at.desc'
  });
  if (latest && latest.created_at && Date.now() - new Date(latest.created_at).getTime() < cooldownMs()) {
    if (res) res.setHeader('Retry-After', String(Math.ceil(cooldownMs() / 1000)));
    throw new HttpError(429, 'Too many attempts');
  }
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const n = await count('q1_auth_attempts', {
    subject_hash: eq(subject),
    kind: eq(kind),
    created_at: 'gte.' + since
  });
  if (n >= hourlyCap(kind)) {
    if (res) res.setHeader('Retry-After', '3600');
    throw new HttpError(429, 'Too many attempts');
  }
}

async function assertIdPhoneIp(req, res) {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const n = await count('q1_auth_attempts', {
    ip_hash: eq(authIpHash(clientIp(req) || 'unknown')),
    kind: eq('id_phone'),
    created_at: 'gte.' + since
  });
  if (n >= hourlyCap('id_phone')) {
    if (res) res.setHeader('Retry-After', '3600');
    throw new HttpError(429, 'Too many attempts');
  }
}

async function borrowerFromClient(client) {
  if (!client || client.deleted_at) return null;
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    client_id: eq(client.id)
  });
  if (!borrower || borrower.client_id !== client.id) return null;
  if (typeof borrower.pin_hash !== 'string' || !borrower.pin_hash.startsWith('scrypt$')) return null;
  if (isLocked(borrower)) return null;
  const to = cleanEmail(client.email);
  if (!to) return null;
  return { borrower, email: to };
}

async function findByEmail(email) {
  if (!email || /[%_\\]/.test(email)) return null;
  const rows = await select('clients', {
    select: 'id,email,deleted_at',
    email: 'ilike.' + email,
    deleted_at: 'is.null',
    limit: 2
  });
  if (!rows || rows.length !== 1) return null;
  return borrowerFromClient(rows[0]);
}

function signInClosed() {
  return new HttpError(503, SIGNIN_CLOSED);
}

async function assertClientHmacColumns() {
  for (const column of ['id_hmac', 'phone_hmac']) {
    try {
      await select('clients', { select: column, limit: 1 });
    } catch (err) {
      if (missingColumn(err)) throw signInClosed();
      throw err;
    }
  }
}

async function findByIdPhone(idMac, phoneMac) {
  if (!idMac || !phoneMac) return null;
  let rows;
  try {
    rows = await select('clients', {
      select: 'id,email,deleted_at',
      id_hmac: eq(idMac),
      phone_hmac: eq(phoneMac),
      deleted_at: 'is.null',
      limit: 2
    });
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    throw err;
  }
  if (!rows || rows.length !== 1) return null;
  return borrowerFromClient(rows[0]);
}

async function issueLink(req, borrower, to, pending) {
  const mail = emailSender(req);
  if (!mail.enabled || !to) return;
  const nowIso = new Date().toISOString();
  await patchWhere('q1_otp_challenges', {
    borrower_id: eq(borrower.id),
    consumed_at: 'is.null'
  }, { consumed_at: nowIso });
  const token = randomBytes(32).toString('hex');
  const id = 'qo_' + randomBytes(8).toString('hex');
  const minutes = Math.max(1, Math.round(otpTtlMs() / 60000));
  await insert('q1_otp_challenges', [{
    id,
    borrower_id: borrower.id,
    channel: 'email',
    purpose: 'signin',
    token_hash: hashToken(token),
    device_hash: hashToken(pending),
    expires_at: new Date(Date.now() + otpTtlMs()).toISOString(),
    consumed_at: null
  }]);
  const link = verifyPageLink(req, token);
  const text = `Open this link on the phone that asked for it. It expires in ${minutes} minutes and works once.\n${link}`;
  Promise.resolve()
    .then(() => mail.send(to, 'Your Quik1 sign-in link', text))
    .then(sent => {
      if (!sent || !sent.sent) {
        return update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() });
      }
    })
    .catch(() => update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() }).catch(() => {}));
}

function ready(req) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  if (!borrowerEmailLive(req)) throw new HttpError(403, EMAIL_OFF, { code: 'device_not_linked' });
}

export async function requestEmailSignIn(req, body, res) {
  ready(req);
  await guardAuth(req, res);
  const email = cleanEmail(body && body.email).toLowerCase();
  const subject = subjectHash('email', email || 'none');
  await assertSubjectBudget('email', subject, res);
  const found = await findByEmail(email);
  await logAuthAttempt(found ? found.borrower.id : null, 'email', req, subject);
  const pending = randomBytes(32).toString('hex');
  if (found) await issueLink(req, found.borrower, found.email, pending);
  return { body: neutralSignIn(), cookies: pendingCookies(req, pending) };
}

function hashSmsCode(code) {
  return createHash('sha256').update('q1-sms-code|' + String(code), 'utf8').digest('hex');
}

function neutralSmsBody() {
  return { sent: true, message: SMS_NEUTRAL };
}

function smsMinutes() {
  return Math.max(5, Math.round(smsTtlMs() / 60000));
}

function smsText(code) {
  return 'Your Quik1 code is ' + code + '. It expires in ' + smsMinutes() + ' minutes and works once.';
}

async function issueSms(req, borrower, destination, pending) {
  const transport = smsTransport(req);
  if (!transport.enabled || !destination) return false;
  const nowIso = new Date().toISOString();
  await patchWhere('q1_otp_challenges', {
    borrower_id: eq(borrower.id),
    consumed_at: 'is.null'
  }, { consumed_at: nowIso });
  const code = newSmsCode();
  const id = 'qo_' + randomBytes(8).toString('hex');
  await insert('q1_otp_challenges', [{
    id,
    borrower_id: borrower.id,
    channel: 'email',
    purpose: 'signin',
    token_hash: hashSmsCode(code),
    device_hash: hashToken(pending),
    expires_at: new Date(Date.now() + smsTtlMs()).toISOString(),
    consumed_at: null
  }]);
  const text = smsText(code);
  Promise.resolve()
    .then(() => transport.send(destination, text))
    .then(sent => {
      if (!sent || !sent.sent) return update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() });
    })
    .catch(() => update('q1_otp_challenges', { id }, { consumed_at: new Date().toISOString() }).catch(() => {}));
  return true;
}

function missingRelation(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}

function usableBorrower(borrower, clientId) {
  if (!borrower || borrower.client_id !== clientId) return null;
  if (typeof borrower.pin_hash !== 'string' || !borrower.pin_hash.startsWith('scrypt$')) return null;
  if (isLocked(borrower)) return null;
  return borrower;
}

async function borrowerOnClient(clientId) {
  try {
    const borrower = await selectOne('q1_borrowers', {
      select: 'id,client_id,pin_hash,failed_attempts,locked_at',
      client_id: eq(clientId)
    });
    return usableBorrower(borrower, clientId);
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    if (missingRelation(err)) return null;
    throw err;
  }
}

async function borrowerForSms(idMac, phoneMac) {
  if (!idMac || !phoneMac) return null;
  let rows;
  try {
    rows = await select('clients', {
      select: 'id,deleted_at',
      id_hmac: eq(idMac),
      phone_hmac: eq(phoneMac),
      deleted_at: 'is.null',
      limit: 2
    });
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    if (missingRelation(err)) return null;
    throw err;
  }
  if (!rows || rows.length !== 1 || rows[0].deleted_at) return null;
  return borrowerOnClient(rows[0].id);
}

async function borrowerByPhone(phoneMac) {
  if (!phoneMac) return null;
  let rows;
  try {
    rows = await select('clients', {
      select: 'id,deleted_at',
      phone_hmac: eq(phoneMac),
      deleted_at: 'is.null',
      limit: 2
    });
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    if (missingRelation(err)) return null;
    throw err;
  }
  if (!rows || rows.length !== 1 || rows[0].deleted_at) return null;
  return borrowerOnClient(rows[0].id);
}

function assertSmsTransport(req) {
  if (!smsTransport(req).enabled) throw new HttpError(503, SMS_UNAVAILABLE);
}

async function beginSms(req, res, subject, borrower, destination) {
  assertSmsTransport(req);
  await assertSubjectBudget('id_phone', subject, res);
  await logAuthAttempt(borrower ? borrower.id : null, 'id_phone', req, subject);
  const pending = randomBytes(32).toString('hex');
  const to = destination && String(destination).startsWith('27') ? '+' + destination : destination;
  if (borrower && to) await issueSms(req, borrower, to, pending);
  return { body: neutralSmsBody(), cookies: pendingCookies(req, pending) };
}

// q1_auth_attempts.kind only allows pin, email, id_phone, and passkey.
// SMS rows use id_phone. The code and the phone number are not stored on the row.
export async function verifySmsSignIn(req, body, res) {
  assertSmsTransport(req);
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  await guardAuth(req, res);
  await assertIdPhoneIp(req, res);
  const code = body && typeof body.code === 'string' ? body.code.trim() : '';
  const subject = subjectHash('id_phone', 'sms-verify');
  await assertSubjectBudget('id_phone', subject, res);
  const shape = new RegExp('^\\d{' + SMS_CODE_LENGTH + '}$').test(code);
  let challenge = null;
  if (shape) {
    let rows = [];
    try {
      rows = await select('q1_otp_challenges', {
        select: 'id,borrower_id,token_hash,device_hash,expires_at,consumed_at,channel',
        token_hash: eq(hashSmsCode(code)),
        consumed_at: 'is.null',
        limit: 5
      }) || [];
    } catch (err) {
      if (!missingRelation(err)) throw err;
      rows = [];
    }
    challenge = rows.find(row => row && row.channel === 'email' && !row.consumed_at && deviceMatches(req, row) && new Date(row.expires_at).getTime() > Date.now()) || null;
  }
  await logAuthAttempt(challenge ? challenge.borrower_id : null, 'id_phone', req, subject);
  if (!challenge) throw new HttpError(401, SMS_REFUSED);
  const borrower = await selectOne('q1_borrowers', {
    select: 'id,client_id,pin_hash,failed_attempts,locked_at',
    id: eq(challenge.borrower_id)
  });
  if (!usableBorrower(borrower, borrower && borrower.client_id)) throw new HttpError(401, SMS_REFUSED);
  const consumed = await patchWhere('q1_otp_challenges', {
    id: eq(challenge.id),
    consumed_at: 'is.null'
  }, { consumed_at: new Date().toISOString() });
  if (!consumed.length) throw new HttpError(401, SMS_REFUSED);
  const session = await startBorrowerSession(borrower, req);
  return {
    accountRef: session.accountRef,
    cookies: [...session.cookies, clearPendingCookie(requestIsSecure(req))]
  };
}

const ID_PIN_BUDGET = 5;
const ID_PIN_WINDOW_MS = 15 * 60 * 1000;

function idPinSubject(mac, rawId) {
  if (mac) return mac;
  const normalised = String(rawId == null ? '' : rawId).trim().toLowerCase().replace(/[\s-]/g, '');
  return subjectHash('id_phone', 'bad|' + normalised);
}

function budgetIpHash(req) {
  const ip = clientIp(req) || 'unknown';
  return createHash('sha256').update(`q1-id-pin-budget|${sessionSecret() || 'unset'}|${ip}`).digest('hex');
}

async function assertIdPinBudget(subject, res) {
  const since = new Date(Date.now() - ID_PIN_WINDOW_MS).toISOString();
  let n = 0;
  try {
    n = await count('q1_auth_attempts', {
      subject_hash: eq(subject),
      kind: eq('id_phone'),
      created_at: 'gte.' + since
    });
  } catch {
    throw new HttpError(503, 'Server not configured');
  }
  if (n >= ID_PIN_BUDGET) {
    if (res) res.setHeader('Retry-After', '900');
    throw new HttpError(429, 'Too many attempts');
  }
}

async function borrowerForId(idMac) {
  if (!idMac) return null;
  let rows;
  try {
    rows = await select('clients', {
      select: 'id,deleted_at',
      id_hmac: eq(idMac),
      deleted_at: 'is.null',
      limit: 2
    });
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    if (missingRelation(err)) return null;
    throw err;
  }
  if (!rows || rows.length !== 1 || rows[0].deleted_at) return null;
  try {
    const borrower = await selectOne('q1_borrowers', {
      select: 'id,client_id,pin_hash,failed_attempts,locked_at,device_reset_until',
      client_id: eq(rows[0].id)
    });
    if (!borrower || borrower.client_id !== rows[0].id) return null;
    return borrower;
  } catch (err) {
    if (missingColumn(err)) throw signInClosed();
    if (missingRelation(err)) return null;
    throw err;
  }
}

// SA ID plus the live PIN. A phone number on the same body is the SMS path and
// must not reach here. A 5- or 6-digit PIN is the staff-reset refusal.
async function signInByIdPin(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  if (!hmacKey()) throw signInClosed();
  const pin = body && typeof body.pin === 'string' ? body.pin : '';
  await guardAuth(req, res);
  if (isLegacyPin(pin)) throw new HttpError(401, pinNotAcceptedMessage());
  if (!isPin(pin)) throw new HttpError(400, enterPinMessage());
  await assertClientHmacColumns();
  const rawId = body && (body.idNumber || body.id) ? String(body.idNumber || body.id) : '';
  const digits = normaliseSaId(rawId);
  const mac = digits ? idHmac(digits) : null;
  const subject = idPinSubject(mac, rawId);
  const borrower = mac ? await borrowerForId(mac) : null;
  await assertIdPinBudget(subject, res);
  const ipHash = budgetIpHash(req);
  try {
    const out = await signInWithPin(req, borrower, pin, { accountLock: false });
    await logAuthAttempt(borrower && borrower.id, 'id_phone', req, subject, ipHash);
    return out;
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 400) {
      await logAuthAttempt(borrower && borrower.id, 'id_phone', req, subject, ipHash);
    }
    throw err;
  }
}

export async function requestIdPhoneSignIn(req, body, res) {
  const pin = body && typeof body.pin === 'string' ? body.pin : '';
  const rawPhone = body && (body.phone || body.cellphone) ? String(body.phone || body.cellphone).trim() : '';
  if (pin && !rawPhone) return signInByIdPin(req, body, res);
  assertSmsTransport(req);
  if (body && typeof body.code === 'string' && body.code.trim()) return verifySmsSignIn(req, body, res);
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  if (!hmacKey()) throw signInClosed();
  await guardAuth(req, res);
  await assertIdPhoneIp(req, res);
  await assertClientHmacColumns();
  const rawId = body && (body.idNumber || body.id) ? String(body.idNumber || body.id) : '';
  const digits = normaliseSaId(rawId);
  const cell = normaliseCell(rawPhone);
  const subject = subjectHash('id_phone', (digits || 'x') + '|' + (cell || 'x'));
  const borrower = await borrowerForSms(digits ? idHmac(digits) : null, cell ? phoneHmac(rawPhone) : null);
  return beginSms(req, res, subject, borrower, cell);
}

export async function requestPhoneSms(req, body, res) {
  assertSmsTransport(req);
  if (body && typeof body.code === 'string' && body.code.trim() && !(body.phone || body.cellphone)) {
    return verifySmsSignIn(req, body, res);
  }
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  if (!hmacKey()) throw signInClosed();
  await guardAuth(req, res);
  await assertIdPhoneIp(req, res);
  await assertClientHmacColumns();
  const rawPhone = body && (body.phone || body.cellphone) ? String(body.phone || body.cellphone) : '';
  const cell = normaliseCell(rawPhone);
  const subject = subjectHash('id_phone', 'phone|' + (cell || 'x'));
  const borrower = await borrowerByPhone(cell ? phoneHmac(rawPhone) : null);
  return beginSms(req, res, subject, borrower, cell);
}
