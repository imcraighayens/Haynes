// Signed session cookie for a future Ledger-backed sign-in.
// Minting is not wired to PIN checks. Production PIN verification stays off.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { header } from './http.js';

export const SESSION_COOKIE = 'q1_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function digest(s) {
  return createHmac('sha256', 'quik1-session').update(String(s)).digest();
}

function sigEqual(a, b) {
  return timingSafeEqual(digest(a), digest(b));
}

export function sessionSecret() {
  const s = process.env.QUIK1_SESSION_SECRET;
  return typeof s === 'string' && s.length >= 32 ? s : '';
}

export function signSession(clientId, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || !clientId) return '';
  const body = Buffer.from(JSON.stringify({ v: 1, c: String(clientId), e: now + MAX_AGE_MS })).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function clientIdFromToken(token, now = Date.now()) {
  const secret = sessionSecret();
  if (!secret || typeof token !== 'string' || !token.includes('.')) return '';
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (!sig || !sigEqual(sig, expected)) return '';
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return ''; }
  if (!payload || payload.v !== 1 || typeof payload.c !== 'string') return '';
  if (typeof payload.e !== 'number' || payload.e < now) return '';
  return payload.c;
}

export function readSessionClientId(req, now = Date.now()) {
  const raw = header(req, 'cookie') || '';
  let token = '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === SESSION_COOKIE) {
      try { token = decodeURIComponent(part.slice(eq + 1).trim()); } catch { token = ''; }
      break;
    }
  }
  return clientIdFromToken(token, now);
}
