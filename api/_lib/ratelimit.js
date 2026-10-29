// Best-effort in-memory per-key limiter for the public customer routes. Vercel functions are
// short-lived and horizontally scaled, so this only blunts bursts from one client against one
// warm instance; it is a courtesy limit, not a security boundary (ids are unguessable anyway).
import { header } from './http.js';

export function createLimiter({ limit = 30, windowMs = 60_000, maxKeys = 10_000 } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  function prune(now) {
    if (hits.size < maxKeys) return;
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    if (hits.size >= maxKeys) hits.clear(); // pathological: start over rather than grow unbounded
  }
  return {
    limit, windowMs,
    check(key, now = Date.now()) {
      prune(now);
      let e = hits.get(key);
      if (!e || e.resetAt <= now) { e = { count: 0, resetAt: now + windowMs }; hits.set(key, e); }
      e.count += 1;
      const ok = e.count <= limit;
      return { ok, remaining: Math.max(0, limit - e.count), retryAfter: Math.max(1, Math.ceil((e.resetAt - now) / 1000)), resetAt: e.resetAt };
    },
    reset() { hits.clear(); },
    size() { return hits.size; }
  };
}

export function clientIp(req) {
  const xff = header(req, 'x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = header(req, 'x-real-ip');
  if (real) return real.trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// The Quik1 app polls two endpoints every 6 s per pending record (20 req/min per record), so the
// default leaves headroom for a couple of pending records or tabs; QUIK1_RATE_LIMIT overrides it.
const PUBLIC_LIMIT = Math.max(1, parseInt(process.env.QUIK1_RATE_LIMIT, 10) || 120);
export const publicLimiter = createLimiter({ limit: PUBLIC_LIMIT, windowMs: 60_000 });
