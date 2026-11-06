// Document gate for the Ledger console shell.
//
// ledger/index.html is a static design bundle. It embeds historical client rows in the
// page source, so hiding the dashboard with CSS is not a control. This module decides
// whether that document may be sent. Live book rows stay on /api/ledger, which still
// runs requireStaff (LEDGER_KEY or the same cookie, and an active employees row for
// named sessions).
//
// A browser navigation cannot present LEDGER_KEY. The key stays a machine Connect
// secret in localStorage and is never collected on these pages. Staff reach the shell
// with the httpOnly cookie from POST /api/ledger/login.
import { parseStaffToken, STAFF_COOKIE } from './auth.js';
import { isAllowlistedEmployee } from './staff.js';

export function readCookie(header, name) {
  const raw = String(header || '');
  const want = String(name || '');
  if (!want) return '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k !== want) continue;
    const v = part.slice(i + 1).trim();
    try { return decodeURIComponent(v); } catch { return v; }
  }
  return '';
}

// Paths that serve ledger/index.html. Other /ledger assets (fonts, the compiler,
// the empty seed) do not contain the book.
export function isLedgerShellPath(pathname) {
  let p = String(pathname || '/');
  try { p = decodeURIComponent(p); } catch { /* keep the raw path */ }
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p === '/ledger' || p === '/ledger/index.html';
}

// Only the console path is a safe post-login target. Anything else stays on /ledger/.
export function safeConsolePath(next) {
  const value = String(next || '');
  if (value === '/ledger' || value === '/ledger/') return '/ledger/';
  return '/ledger/';
}

export function ledgerLoginRedirect(requestUrl, reason) {
  const dest = new URL('/login/', requestUrl);
  dest.searchParams.set('next', '/ledger/');
  if (reason === 'unavailable' || reason === 'unconfigured') dest.searchParams.set('notice', 'unavailable');
  return dest;
}

// { ok, reason }. Fail closed when the signing secret or the employee check is unavailable.
// v1 is the existing unnamed unlock-PIN session. v2 must still be an active employee,
// the same rule as requireStaff.
export async function staffMayViewLedger(cookieHeader) {
  if (!process.env.LEDGER_KEY) return { ok: false, reason: 'unconfigured' };
  const parsed = parseStaffToken(readCookie(cookieHeader, STAFF_COOKIE) || '');
  if (!parsed) return { ok: false, reason: 'anonymous' };
  if (parsed.version === 'v1') return { ok: true, reason: 'session' };
  try {
    const row = await isAllowlistedEmployee(parsed.email);
    if (!row) return { ok: false, reason: 'anonymous' };
    return { ok: true, reason: 'session' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

// Same continuation header as @vercel/functions next(), without taking a dependency.
export function continueToAsset() {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
