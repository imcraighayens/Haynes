// HTTP plumbing shared by every function: JSON responses, body parsing with a size cap,
// path parsing for Vercel catch-all routes, and the error wrapper that guarantees a caller
// only ever sees `{error}` with a 4xx/5xx — never a stack trace, never the service key.
import { apiRole, apiSideAllowed } from './hosts.js';

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    if (extra) this.extra = extra;
  }
}

export const PUBLIC_BODY_CAP = 16 * 1024;      // customer app payloads are tiny
export const STAFF_BODY_CAP = 2 * 1024 * 1024; // a full console sync can carry hundreds of rows

function baseHeaders(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Opt-in per response. A route sets `req.corsAllowlist` to an array of exact origins
  // (the EcoLoans marketing ingest). That list is the only CORS policy for the response,
  // so the global single-value ALLOWED_ORIGIN — including `*` — stays on its own path
  // for Quik1 and staff routes, which never set the list.
  if (req && Array.isArray(req.corsAllowlist)) {
    res.setHeader('Vary', 'Origin');
    const origin = header(req, 'origin');
    if (origin && req.corsAllowlist.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', req.corsAllowMethods || 'GET,POST,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.corsAllowHeaders || 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    return;
  }
  const allowedRaw = process.env.ALLOWED_ORIGIN;
  if (allowedRaw) {
    // Same-origin deployments never need CORS; ALLOWED_ORIGIN is for a split front-end host.
    // Accept a single origin, `*`, or a comma-separated list of exact origins.
    const origin = header(req, 'origin');
    const allowedList = String(allowedRaw).split(',').map(s => s.trim()).filter(Boolean);
    const star = allowedList.includes('*');
    const match = star || (origin && allowedList.includes(origin));
    if (match) {
      res.setHeader('Access-Control-Allow-Origin', star ? '*' : origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey, Prefer');
      res.setHeader('Access-Control-Max-Age', '600');
    }
  }
}

export function json(res, status, body, req) {
  baseHeaders(req || { headers: {} }, res);
  res.statusCode = status;
  res.end(body === undefined ? '' : JSON.stringify(body));
}

export function header(req, name) {
  const h = (req && req.headers) || {};
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : (v == null ? undefined : String(v));
}

// vercel.json rewrites /api/<area>/<rest> to /api/<area>?path=<rest>, so the sub-path arrives
// as req.query.path (a string, or an array if it was repeated). If req.query is missing we read
// `path` off the URL's query, then fall back to the URL path itself (other runtimes, tests).
export function pathParts(req, prefix) {
  let q = req.query && req.query.path;
  if (q == null) {
    const url = String(req.url || '');
    const i = url.indexOf('?');
    if (i >= 0) q = new URLSearchParams(url.slice(i + 1)).get('path');
  }
  let parts = Array.isArray(q) ? q.join('/').split('/') : (typeof q === 'string' && q ? q.split('/') : null);
  if (!parts) {
    const url = String(req.url || '').split('?')[0];
    parts = url.split('/').filter(Boolean);
    if (parts[0] === 'api') parts.shift();
    if (prefix && parts[0] === prefix) parts.shift();
  }
  return parts.filter(s => s !== '').map(s => { try { return decodeURIComponent(s); } catch { return s; } });
}

export function searchParams(req) {
  const url = String(req.url || '');
  const i = url.indexOf('?');
  const sp = new URLSearchParams(i >= 0 ? url.slice(i + 1) : '');
  // Vercel also exposes the parsed query on req.query; merge for callers that pass only that.
  if (req.query && typeof req.query === 'object') {
    Object.keys(req.query).forEach(k => { if (k !== 'path' && !sp.has(k)) sp.set(k, String(req.query[k])); });
  }
  return sp;
}

async function readRaw(req, cap) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    const onData = c => { size += c.length; if (size > cap) { cleanup(); reject(new HttpError(413, 'Body too large')); return; } chunks.push(c); };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks).toString('utf8')); };
    const onErr = () => { cleanup(); reject(new HttpError(400, 'Could not read body')); };
    const cleanup = () => { req.off?.('data', onData); req.off?.('end', onEnd); req.off?.('error', onErr); };
    if (typeof req.on !== 'function') return resolve('');
    req.on('data', onData); req.on('end', onEnd); req.on('error', onErr);
  });
}

// Returns a plain object or array. Vercel pre-parses JSON into req.body; we also accept string
// bodies (other runtimes, tests) and raw streams. Anything else is a 400.
export async function readBody(req, cap = PUBLIC_BODY_CAP) {
  let raw;
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') {
      if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
      else {
        const size = Buffer.byteLength(JSON.stringify(req.body));
        if (size > cap) throw new HttpError(413, 'Body too large');
        return req.body;
      }
    } else raw = String(req.body);
  } else {
    raw = await readRaw(req, cap);
  }
  if (Buffer.byteLength(raw) > cap) throw new HttpError(413, 'Body too large');
  if (!raw.trim()) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new HttpError(400, 'Body must be JSON'); }
  if (parsed === null || typeof parsed !== 'object') throw new HttpError(400, 'Body must be a JSON object');
  return parsed;
}

export function requireEnv(names) {
  const missing = names.filter(n => !process.env[n]);
  if (missing.length) throw new HttpError(503, 'Server not configured');
}

// Loan-status and sync 4xx are logged as route, status, error code, and an optional
// loan ref. Names, phone numbers, and row ids are not written.
export function logClientError(tag, route, status, code, ref) {
  const safeCode = String(code || ('http_' + status)).replace(/[^\w.-]/g, '').slice(0, 40) || ('http_' + status);
  const safeRef = String(ref || '').replace(/[^\w.-]/g, '').slice(0, 40);
  console.error(`[api:${tag}] ${route} ${status} ${safeCode}${safeRef ? ' ' + safeRef : ''}`);
}

function ledgerWriteRoute(req, tag) {
  if (tag !== 'ledger') return '';
  const head = pathParts(req, 'ledger')[0] || '';
  return head === 'loan-status' || head === 'sync' ? head : '';
}

// Every handler goes through here so a thrown anything becomes `{error}` JSON. We log only a
// route tag, the status and our own short message — request bodies and DB rows (PII) never
// reach the logs.
export function wrap(tag, fn) {
  return async function handler(req, res) {
    try {
      // Same host lists as vercel.json. A borrower host never runs a staff route, and a staff host never runs Quik1.
      if (!apiSideAllowed(apiRole(header(req, 'x-forwarded-host'), header(req, 'host')), tag)) {
        throw new HttpError(404, 'Not found');
      }
      if (req.method === 'OPTIONS') { json(res, 204, undefined, req); return; }
      await fn(req, res);
    } catch (e) {
      const status = e instanceof HttpError && e.status >= 400 && e.status <= 599 ? e.status : 500;
      const message = e instanceof HttpError ? e.message : 'Internal error';
      if (status >= 500) console.error(`[api:${tag}] ${status} ${e instanceof HttpError ? e.message : (e && e.name) || 'error'}`);
      else {
        const route = ledgerWriteRoute(req, tag);
        if (route) logClientError(tag, route, status, e && e.code, e && e.ref);
      }
      const body = { error: message };
      if (e instanceof HttpError && e.extra) Object.assign(body, e.extra);
      if (!res.headersSent) json(res, status, body, req);
      else { try { res.end(); } catch { /* already closed */ } }
    }
  };
}

export function methodNotAllowed(req) {
  throw new HttpError(405, `Method ${req.method} not allowed`);
}
export function notFound(what) {
  throw new HttpError(404, what ? `${what} not found` : 'Not found');
}
