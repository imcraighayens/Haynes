// HttpOnly session for a Quik1 borrower. The secret is QUIK1_SESSION_SECRET (32+ chars).
// The cookie names a session row. It is not a PIN and it is not a Ledger client lookup key
// on its own: /me loads the book only when the session row is still open and the borrower
// is still bound to that client.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { header } from './http.js';

export const SESSION_COOKIE = 'q1_session';
export const DEVICE_COOKIE = 'q1_device';
export const KNOWN_COOKIE = 'q1_known';
export const PENDING_COOKIE = 'q1_pending';
export const KNOWN_TTL_SECONDS = 90 * 24 * 3600;

export function sessionSecret() {
  const s = process.env.QUIK1_SESSION_SECRET;
  if (typeof s !== 'string') return '';
  const trimmed = s.trim();
  // Whitespace-only is missing. Fewer than 32 characters stays off.
  if (trimmed.length < 32) return '';
  return trimmed;
}

export function sessionTtlMs() {
  const h = parseInt(process.env.QUIK1_SESSION_TTL_HOURS, 10);
  const hours = Number.isFinite(h) && h >= 1 && h <= 24 * 14 ? h : 12;
  return hours * 3600 * 1000;
}

function sigEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function newSessionId() {
  return 'qs_' + randomBytes(16).toString('hex');
}

export function mintBorrowerToken({ sid, bid, cid }, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !sid || !bid || !cid) return null;
  const exp = now + sessionTtlMs();
  const body = Buffer.from(JSON.stringify({ v: 1, s: sid, b: bid, c: cid, e: exp })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `v1.${body}.${sig}`, exp };
}

export function readBorrowerToken(token, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const expected = createHmac('sha256', secret).update(parts[1]).digest('base64url');
  if (!sigEqual(parts[2], expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || payload.v !== 1) return null;
  if (typeof payload.e !== 'number' || payload.e < now) return null;
  if (typeof payload.s !== 'string' || typeof payload.b !== 'string' || typeof payload.c !== 'string') return null;
  return { sid: payload.s, bid: payload.b, cid: payload.c, exp: payload.e };
}

export function cookies(req) {
  const raw = header(req, 'cookie') || '';
  const out = {};
  raw.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = ''; }
  });
  return out;
}

export function readSession(req, now = Date.now()) {
  return readBorrowerToken(cookies(req)[SESSION_COOKIE] || '', now);
}

export function readDeviceRef(req) {
  const v = cookies(req)[DEVICE_COOKIE] || '';
  return /^qb_[0-9a-f]{32}$/.test(v) ? v : '';
}

export function readKnownDevice(req) {
  const v = cookies(req)[KNOWN_COOKIE] || '';
  return /^[0-9a-f]{64}$/.test(v) ? v : '';
}

export function readPendingDevice(req) {
  const v = cookies(req)[PENDING_COOKIE] || '';
  return /^[0-9a-f]{64}$/.test(v) ? v : '';
}

export function requestIsSecure(req) {
  const proto = (header(req, 'x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  if (proto === 'http') return false;
  return !!(req && req.socket && req.socket.encrypted);
}

function cookie(name, value, { maxAge, clear = false, secure = true } = {}) {
  const parts = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : maxAge}`
  ];
  return parts.join('; ');
}

export function sessionCookie(token, exp, secure = true) {
  const maxAge = Math.max(0, Math.floor((exp - Date.now()) / 1000));
  return cookie(SESSION_COOKIE, token, { maxAge, secure });
}

export function clearSessionCookie(secure = true) {
  return cookie(SESSION_COOKIE, '', { clear: true, secure });
}

export const DEVICE_MAX_AGE = 90 * 24 * 3600;

export function deviceCookie(accountRef, secure = true) {
  return cookie(DEVICE_COOKIE, accountRef, { maxAge: DEVICE_MAX_AGE, secure });
}

export function knownDeviceCookie(token, secure = true) {
  return cookie(KNOWN_COOKIE, token, { maxAge: KNOWN_TTL_SECONDS, secure });
}

export function clearKnownCookie(secure = true) {
  return cookie(KNOWN_COOKIE, '', { clear: true, secure });
}

export function pendingDeviceCookie(token, maxAge, secure = true) {
  return cookie(PENDING_COOKIE, token, { maxAge: Math.max(1, maxAge | 0), secure });
}

export function clearPendingCookie(secure = true) {
  return cookie(PENDING_COOKIE, '', { clear: true, secure });
}
