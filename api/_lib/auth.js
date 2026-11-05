// Staff authentication: a single shared secret (LEDGER_KEY) presented as a Bearer token or an
// `apikey` header (the console's native Supabase feature sends both). The compare is constant
// time over SHA-256 digests so neither the length nor the prefix of the secret leaks via timing.
//
// Same-origin staff session (httpOnly cookie) is an alternative after the prototype unlock PIN:
// the browser never holds LEDGER_KEY, and anonymous GETs without the cookie still 401.
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';

export const STAFF_COOKIE = 'ledger_staff';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function digest(s) { return createHash('sha256').update(String(s), 'utf8').digest(); }

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return timingSafeEqual(digest(a), digest(b));
}

export function bearerToken(req) {
  const auth = header(req, 'authorization');
  if (auth) {
    const m = /^\s*Bearer\s+(.+?)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const apikey = header(req, 'apikey');
  return apikey ? apikey.trim() : '';
}

function parseCookies(req) {
  const raw = header(req, 'cookie') || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

export function requestHost(req) {
  const host = header(req, 'x-forwarded-host') || header(req, 'host') || '';
  return String(host).split(',')[0].trim().toLowerCase();
}

export function isSameOrigin(req) {
  const sfs = (header(req, 'sec-fetch-site') || '').toLowerCase();
  if (sfs === 'same-origin') return true;
  const origin = header(req, 'origin');
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.host.toLowerCase() === requestHost(req);
  } catch {
    return false;
  }
}

function sessionSecret() {
  const key = process.env.LEDGER_KEY;
  if (!key) return null;
  return createHmac('sha256', key).update('ledger-staff-session-v1').digest();
}

export function mintStaffSession(now = Date.now()) {
  const secret = sessionSecret();
  if (!secret) throw new HttpError(503, 'Server not configured');
  const exp = now + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString('hex');
  const payload = `v1.${exp}.${nonce}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, exp };
}

export function verifyStaffSession(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return false;
  const secret = sessionSecret();
  if (!secret) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const payload = parts.slice(0, 3).join('.');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const got = parts[3];
  if (expected.length !== got.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  } catch {
    return false;
  }
}

export function staffCookieHeader(token, exp, { clear = false } = {}) {
  const maxAge = clear ? 0 : Math.max(0, Math.floor((exp - Date.now()) / 1000));
  const parts = [
    `${STAFF_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAge}`
  ];
  return parts.join('; ');
}

export function unlockPinExpected() {
  // Prototype unlock PIN lives in the ledger HTML today; mirror via env so production can rotate
  // without a client rebuild. Empty means unlock-session is disabled (Bearer still works).
  return String(process.env.LEDGER_UNLOCK_PIN || '').trim();
}

export function verifyUnlockPin(pin) {
  const expected = unlockPinExpected();
  if (!expected) throw new HttpError(503, 'Unlock PIN not configured');
  if (!safeEqual(String(pin || ''), expected)) throw new HttpError(401, 'Unauthorized');
  return true;
}

export function requireStaff(req) {
  const expected = process.env.LEDGER_KEY;
  if (!expected) throw new HttpError(503, 'Server not configured');
  const token = bearerToken(req);
  // Always run the compare (even for an empty token) so the timing profile is uniform.
  const bearerOk = safeEqual(token || '\u0000', expected);
  if (bearerOk) return true;

  // Same-origin cookie session after prototype unlock — never accepts cross-site cookies alone.
  if (isSameOrigin(req)) {
    const cookies = parseCookies(req);
    if (verifyStaffSession(cookies[STAFF_COOKIE] || '')) return true;
  }
  throw new HttpError(401, 'Unauthorized');
}
