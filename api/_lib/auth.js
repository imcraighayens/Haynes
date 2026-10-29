// Staff authentication: a single shared secret (LEDGER_KEY) presented as a Bearer token or an
// `apikey` header (the console's native Supabase feature sends both). The compare is constant
// time over SHA-256 digests so neither the length nor the prefix of the secret leaks via timing.
import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, header } from './http.js';

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

export function requireStaff(req) {
  const expected = process.env.LEDGER_KEY;
  if (!expected) throw new HttpError(503, 'Server not configured');
  const token = bearerToken(req);
  // Always run the compare (even for an empty token) so the timing profile is uniform.
  const ok = safeEqual(token || '\u0000', expected);
  if (!ok) throw new HttpError(401, 'Unauthorized');
  return true;
}
