// Answers a staff host's "/" before the CDN serves the cached Ledger file.
// Matcher is only "/", so /ledger/ and borrower hosts fall through.
import { staffRootRedirect } from './api/_lib/staff-root.js';

export default function proxy(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || url.hostname;
  const decision = staffRootRedirect(host, url.pathname, url.search);
  if (decision) {
    return new Response(null, {
      status: decision.status,
      headers: {
        Location: decision.location,
        'Cache-Control': decision.cacheControl
      }
    });
  }
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
