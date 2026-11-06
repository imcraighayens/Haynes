// Staff authentication: a single shared secret (LEDGER_KEY) presented as a Bearer token or an
// `apikey` header (the console's native Supabase feature sends both). The compare is constant
// time over SHA-256 digests so neither the length nor the prefix of the secret leaks via timing.
// LEDGER_KEY is a machine Connect secret. Staff sign in with POST /api/ledger/login, which mints
// the same httpOnly cookie (v2 payload names the user). Anonymous GETs without either still 401.
import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { HttpError, header } from './http.js';
import { isAllowlistedEmployee } from './staff.js';

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

// v1.{exp}.{nonce}.{sig} is an unnamed session (legacy unlock PIN).
// v2.{exp}.{nonce}.{claims}.{sig} records the Supabase staff user. `claims` is base64url JSON
// {email, name} and is covered by the HMAC, so it cannot be swapped without LEDGER_KEY.
export function mintStaffSession(now = Date.now(), staff = null) {
  const secret = sessionSecret();
  if (!secret) throw new HttpError(503, 'Server not configured');
  const exp = now + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString('hex');
  const email = staff && staff.email ? String(staff.email).trim().toLowerCase() : '';
  let payload = `v1.${exp}.${nonce}`;
  if (email) {
    const name = String(staff.displayName || '').trim().slice(0, 80);
    const claims = Buffer.from(JSON.stringify({ email, name }), 'utf8').toString('base64url');
    payload = `v2.${exp}.${nonce}.${claims}`;
  }
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, exp, email: email || null };
}

export function parseStaffToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const parts = token.split('.');
  const version = parts[0];
  if (version !== 'v1' && version !== 'v2') return null;
  const expectLen = version === 'v1' ? 4 : 5;
  if (parts.length !== expectLen) return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return null;
  const payload = parts.slice(0, expectLen - 1).join('.');
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const got = parts[expectLen - 1];
  if (expected.length !== got.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return null;
  } catch {
    return null;
  }
  if (version === 'v1') return { version, exp, email: null, displayName: '' };
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[3], 'base64url').toString('utf8')); } catch { return null; }
  const email = claims && typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!email || email.length > 254) return null;
  const displayName = claims && typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) : '';
  return { version, exp, email, displayName };
}

export function verifyStaffSession(token, now = Date.now()) {
  return !!parseStaffToken(token, now);
}

// Named user from a same-origin v2 cookie. Bearer LEDGER_KEY is machine access and returns null.
export function staffIdentity(req) {
  if (!isSameOrigin(req)) return null;
  const parsed = parseStaffToken(parseCookies(req)[STAFF_COOKIE] || '');
  if (!parsed || !parsed.email) return null;
  return { email: parsed.email, displayName: parsed.displayName || parsed.email };
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
  // Server-only PIN for POST /unlock. The Admin screen signs in with email and password
  // and does not send this. Empty disables the unlock session (Bearer LEDGER_KEY still works).
  // The value is never rendered in the staff UI.
  return String(process.env.LEDGER_UNLOCK_PIN || '').trim();
}

export function verifyUnlockPin(pin) {
  const expected = unlockPinExpected();
  if (!expected) throw new HttpError(503, 'Unlock PIN not configured');
  if (!safeEqual(String(pin || '').slice(0, 128), expected)) throw new HttpError(401, 'Unauthorized');
  return true;
}

const PRODUCTION_HOSTS = new Set(['quik1ledger.com', 'www.quik1ledger.com', 'ecoloans-six.vercel.app']);

// Fixed recovery pages. The client cannot choose a redirect. Preview hosts are
// not listed: a reset link always returns to one of these two origins.
const RECOVERY_REDIRECTS = {
  'www.quik1ledger.com': 'https://www.quik1ledger.com/login/reset/',
  'quik1ledger.com': 'https://quik1ledger.com/login/reset/'
};

export function recoveryRedirectUrl(req) {
  return RECOVERY_REDIRECTS[requestHostname(req)] || RECOVERY_REDIRECTS['quik1ledger.com'];
}

export function requestHostname(req) {
  return requestHost(req).replace(/:\d+$/, '');
}

// Demo reset stays off unless an operator explicitly opts in, and never on a production host
// or when NODE_ENV=production. The flag is not a secret; it only reveals a non-production control.
export function demoResetAllowed(req) {
  const flag = String(process.env.LEDGER_ALLOW_DEMO_RESET || '').trim().toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return false;
  if (PRODUCTION_HOSTS.has(requestHostname(req))) return false;
  return true;
}

// LEDGER_MANAGER_PIN is a server env secret. Prefix sha256: stores only the hex digest.
// The submitted value is never echoed and is never compared in the browser.
export function verifyManagerPin(pin) {
  const stored = String(process.env.LEDGER_MANAGER_PIN || '').trim();
  if (!stored) throw new HttpError(503, 'Manager PIN not configured');
  const given = String(pin ?? '').slice(0, 128);
  let ok = false;
  if (stored.startsWith('sha256:')) {
    const expectHex = stored.slice('sha256:'.length).trim().toLowerCase();
    const gotHex = createHash('sha256').update(given, 'utf8').digest('hex');
    try {
      ok = /^[a-f0-9]{64}$/.test(expectHex) && timingSafeEqual(Buffer.from(expectHex, 'hex'), Buffer.from(gotHex, 'hex'));
    } catch {
      ok = false;
    }
  } else {
    ok = safeEqual(given, stored);
  }
  if (!ok) throw new HttpError(401, 'Unauthorized');
  return true;
}

export async function requireStaff(req) {
  const expected = process.env.LEDGER_KEY;
  if (!expected) throw new HttpError(503, 'Server not configured');
  const token = bearerToken(req);
  // Always run the compare (even for an empty token) so the timing profile is uniform.
  const bearerOk = safeEqual(token || '\u0000', expected);
  if (bearerOk) return true;

  // Same-origin cookie session. v1 is the legacy unlock PIN. v2 is a named staff user who must
  // still be an active public.employees row. Cross-site cookies are never enough on their own.
  if (isSameOrigin(req)) {
    const parsed = parseStaffToken(parseCookies(req)[STAFF_COOKIE] || '');
    if (parsed && parsed.version === 'v1') return true;
    if (parsed && parsed.email && await isAllowlistedEmployee(parsed.email)) return true;
  }
  throw new HttpError(401, 'Unauthorized');
}
