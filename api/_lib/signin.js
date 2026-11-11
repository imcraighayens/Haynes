// Email sign-in, and ID plus cellphone that always continues by email.
// The HTTP body is the same whether or not an account matches. ID and phone
// are compared as keyed HMACs. A session is created only after the email link
// is opened on the same phone. ID and phone alone never sign anyone in.
import { createHash, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { select, selectOne, insert, update, patchWhere, count, eq } from './supabase.js';
import { cleanEmail } from './validate.js';
import { borrowerPinLive } from './quik1-flags.js';
import { apiRole } from './hosts.js';
import { clientIp } from './ratelimit.js';
import { borrowerEmailLive, emailSender } from './email.js';
import { sessionSecret, pendingDeviceCookie, requestIsSecure } from './quik1-session.js';
import { guardAuth, authIpHash, logAuthAttempt, maxPinAttempts, lockoutMs, signInWithPin } from './borrower.js';
import { idHmac, phoneHmac, normaliseSaId, normaliseCell, hmacKey } from './sa-id.js';

const LOCKED_PLACEHOLDER = 'locked';
const SIGNIN_CLOSED = 'Sign in with your email for now';
const EMAIL_OFF = "This phone isn't linked yet. Please contact EcoLoans and we'll reset your access.";
export const SIGNIN_PAD_MS = 800;

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

// A submitted PIN uses the same order as loginBorrower: lock (423), acceptTemporaryPin, device_not_linked.
// The email-link path below is unchanged and does not check a PIN.
async function signInByIdPhone(req, body, res) {
  if (!borrowerPinLive(req)) throw new HttpError(503, 'Sign-in is not available');
  if (!sessionSecret()) throw new HttpError(503, 'Server not configured');
  if (!hmacKey()) throw signInClosed();
  await guardAuth(req, res);
  await assertClientHmacColumns();
  const rawId = body && (body.idNumber || body.id) ? String(body.idNumber || body.id) : '';
  const rawPhone = body && (body.phone || body.cellphone) ? String(body.phone || body.cellphone) : '';
  const digits = normaliseSaId(rawId);
  const cell = normaliseCell(rawPhone);
  const borrower = await borrowerForPin(digits ? idHmac(digits) : null, cell ? phoneHmac(rawPhone) : null);
  return signInWithPin(req, borrower, body.pin);
}

async function borrowerForPin(idMac, phoneMac) {
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

function missingRelation(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = String((err && err.message) || '');
  return code === '42P01' || code === 'PGRST205' || /42P01|PGRST205/.test(msg);
}

export async function requestIdPhoneSignIn(req, body, res) {
  if (body && typeof body.pin === 'string' && body.pin) return signInByIdPhone(req, body, res);
  ready(req);
  if (!hmacKey()) throw signInClosed();
  await guardAuth(req, res);
  await assertIdPhoneIp(req, res);
  await assertClientHmacColumns();
  const rawId = body && (body.idNumber || body.id) ? String(body.idNumber || body.id) : '';
  const rawPhone = body && (body.phone || body.cellphone) ? String(body.phone || body.cellphone) : '';
  const digits = normaliseSaId(rawId);
  const cell = normaliseCell(rawPhone);
  const subject = subjectHash('id_phone', (digits || 'x') + '|' + (cell || 'x'));
  await assertSubjectBudget('id_phone', subject, res);
  const found = await findByIdPhone(digits ? idHmac(digits) : null, cell ? phoneHmac(rawPhone) : null);
  await logAuthAttempt(found ? found.borrower.id : null, 'id_phone', req, subject);
  const pending = randomBytes(32).toString('hex');
  if (found) await issueLink(req, found.borrower, found.email, pending);
  return { body: neutralSignIn(), cookies: pendingCookies(req, pending) };
}
