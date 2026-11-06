// Vercel Routing Middleware (Node). Runs before the static file is served.
// Unsigned requests for the Ledger shell are redirected to /login/ and never
// receive ledger/index.html. Quik1, /api, and the public landing are not matched.
import { continueToAsset, isLedgerShellPath, ledgerLoginRedirect, staffMayViewLedger } from './api/_lib/gate.js';

export const config = {
  runtime: 'nodejs',
  matcher: ['/ledger', '/ledger/', '/ledger/index.html']
};

export default async function middleware(request) {
  const url = new URL(request.url);
  if (!isLedgerShellPath(url.pathname)) return continueToAsset();
  let decision;
  try {
    decision = await staffMayViewLedger(request.headers.get('cookie') || '');
  } catch {
    decision = { ok: false, reason: 'unavailable' };
  }
  if (decision.ok) return continueToAsset();
  return Response.redirect(ledgerLoginRedirect(request.url, decision.reason), 302);
}
