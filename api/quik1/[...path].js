// Public customer endpoints for the Quik1 app. No auth: insert-only plus read-own-by-id with
// unguessable ids. Rate limited, JSON only, 16 KB body cap, everything validated and whitelisted.
//   POST /api/quik1/applications        GET /api/quik1/applications/:id
//   POST /api/quik1/signups             GET /api/quik1/signups/:id
//   POST /api/quik1/requests            GET /api/quik1/repayments/:key
import { randomBytes } from 'node:crypto';
import { wrap, json, readBody, pathParts, requireEnv, HttpError, PUBLIC_BODY_CAP } from '../_lib/http.js';
import { publicLimiter, clientIp } from '../_lib/ratelimit.js';
import { selectOne, count, upsert, eq } from '../_lib/supabase.js';
import {
  wellFormedClientId, isSafeId, cleanText, cleanPhone, cleanEmail, parseAmount, parseTerm, num, toMs,
  quik1StatusLabel
} from '../_lib/validate.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const REF_BASE = 1085; // the local Quik1Link numbered applications from AP-1085
const AUTO_NOTE = 'Auto-approved by Quik1 bridge';
const DEFAULT_REVIEWER = 'applications@ecoloans.co.za';
// Extra fields from the app record we keep (whitelisted) under meta.raw for staff context.
const RAW_KEYS = ['source', 'status', 'employment', 'payday', 'estIncome', 'estExpenses', 'idnum'];
const RAW_MAX = 60;      // short labels only; the row must stay small (it rides in every /state)
const DOCS_MAX = 5;
const DOC_NAME_MAX = 80;
// Server-side throttles that survive cold starts and horizontal scaling (the in-memory limiter
// does not): a global cap on new app applications per hour and a per-phone cap per day. A hit
// is a 429, which the app's outbox retries later rather than dropping.
const HOURLY_CAP = Math.max(1, parseInt(process.env.QUIK1_HOURLY_CAP, 10) || 60);
const PHONE_DAILY_CAP = Math.max(1, parseInt(process.env.QUIK1_PHONE_DAILY_CAP, 10) || 3);
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export function newId(prefix) { return `${prefix}_${randomBytes(6).toString('hex')}`; }

function rawExtras(body) {
  const out = {};
  for (const k of RAW_KEYS) if (body[k] != null && body[k] !== '') out[k] = typeof body[k] === 'number' ? body[k] : cleanText(body[k], RAW_MAX);
  return out;
}
function docsOf(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, DOCS_MAX).map(d => (typeof d === 'string' ? cleanText(d, DOC_NAME_MAX) : (d && typeof d === 'object' && d.name ? cleanText(d.name, DOC_NAME_MAX) : ''))).filter(Boolean);
}
function decisionOf(row) {
  const d = row.decision && typeof row.decision === 'object' ? row.decision : null;
  if (d && (d.verdict === 'approved' || d.verdict === 'declined')) {
    return { verdict: d.verdict, amount: num(d.amount, num(row.amount)), by: cleanText(d.by || 'Ecoloans', 80), note: cleanText(d.note, 400), at: toMs(d.at) || toMs(row.decided_at) || Date.now() };
  }
  // Decided through another path (e.g. the console's own UI) without a decision blob. The note
  // stays empty: `decline_reason` is a staff-internal column and must never reach the customer.
  if (row.status === 'approved' || row.status === 'declined') {
    return { verdict: row.status, amount: num(row.amount), by: 'Ecoloans', note: '', at: toMs(row.decided_at) || toMs(row.updated_at) || Date.now() };
  }
  return null;
}

// ---- applications ---------------------------------------------------------------------------------
async function postApplication(req, res, body) {
  const name = cleanText(body.name, 120);
  if (!name) throw new HttpError(400, 'name is required');
  const phone = cleanPhone(body.phone);
  if (!phone) throw new HttpError(400, 'phone is required');
  const amount = parseAmount(body.amount);
  const id = wellFormedClientId(body.id, 'ap') || newId('ap');
  // A retried submit (client timeout, outbox resend) must answer from the stored row: its ref is
  // already assigned and staff may already have decided it.
  const saved = await selectOne('applications', { select: APP_VIEW, id: eq(id), source: eq('quik1') });
  if (saved) { json(res, 200, { id: saved.id, ref: saved.ref, status: quik1StatusLabel(saved.status), decision: decisionOf(saved) }, req); return; }
  const since = ms => new Date(Date.now() - ms).toISOString();
  const [lastHour, samePhone] = await Promise.all([
    count('applications', { source: eq('quik1'), created_at: 'gte.' + since(HOUR_MS) }),
    count('applications', { source: eq('quik1'), phone: eq(phone), created_at: 'gte.' + since(DAY_MS) })
  ]);
  if (lastHour >= HOURLY_CAP || samePhone >= PHONE_DAILY_CAP) { res.setHeader('Retry-After', '900'); throw new HttpError(429, 'Too many applications right now — please try again later'); }
  const existing = await count('applications', {}); // sequence-free ref like the local link did
  const row = {
    id,
    ref: `AP-${REF_BASE + existing}`,
    name,
    phone,
    email: cleanEmail(body.email) || null,
    id_number: cleanText(body.idNumber ?? body.id_number ?? body.idnum, 20) || null,
    amount,
    term_months: parseTerm(body.term ?? body.term_months),
    purpose: cleanText(body.purpose, 120) || 'Personal',
    net_income: Math.max(0, num(body.income ?? body.net_income, 0)),
    employer: cleanText(body.employer, 120) || null,
    job_title: cleanText(body.jobTitle ?? body.job_title, 120) || null,
    bank: cleanText(body.bank, 80) || null,
    source: 'quik1',
    status: 'new',
    meta: {
      surplus: num(body.surplus, 0),
      submittedAt: toMs(body.submittedAt) || Date.now(),
      client: 'quik1',
      docs: docsOf(body.docs),
      raw: rawExtras(body)
    }
  };
  // ignore-duplicates makes a retried submit with the same client id idempotent.
  await upsert('applications', [row], 'id', { ignoreDuplicates: true, returning: false });
  json(res, 201, { id, ref: row.ref, status: 'Needs decision' }, req);
}

const APP_VIEW = 'id,ref,status,amount,decision,decided_at,updated_at'; // never decline_reason

async function getApplication(req, res, id) {
  if (!isSafeId(id)) throw new HttpError(400, 'bad id');
  const row = await selectOne('applications', { select: APP_VIEW, id: eq(id), source: eq('quik1') });
  if (!row) throw new HttpError(404, 'Application not found');
  json(res, 200, { id: row.id, status: quik1StatusLabel(row.status), decision: decisionOf(row) }, req);
}

// ---- signups --------------------------------------------------------------------------------------
async function postSignup(req, res, body) {
  const name = cleanText(body.name, 120);
  if (!name) throw new HttpError(400, 'name is required');
  const id = wellFormedClientId(body.id, 'su') || newId('su');
  const now = new Date().toISOString();
  const row = {
    id,
    status: 'Approved', // auto-approval policy: the customer proceeds immediately
    name,
    id_number: cleanText(body.idnum ?? body.idNumber ?? body.id_number, 20) || null,
    phone: cleanPhone(body.phone) || null,
    email: cleanEmail(body.email) || null,
    employment: cleanText(body.employment, 80) || null,
    employer: cleanText(body.employer, 120) || null,
    income: Math.max(0, num(body.income, 0)),
    payday: cleanText(body.payday, 40) || null,
    reviewer: DEFAULT_REVIEWER,
    decided_at: now,
    decided_by: 'auto',
    note: AUTO_NOTE,
    meta: { submittedAt: toMs(body.submittedAt) || Date.now(), client: 'quik1' }
  };
  await upsert('q1_signups', [row], 'id', { ignoreDuplicates: true, returning: false });
  json(res, 201, { id, status: row.status, decidedAt: toMs(now), by: row.decided_by, note: row.note }, req);
}

async function getSignup(req, res, id) {
  if (!isSafeId(id)) throw new HttpError(400, 'bad id');
  const row = await selectOne('q1_signups', { select: 'id,status,decided_at,decided_by,note', id: eq(id) });
  if (!row) throw new HttpError(404, 'Signup not found');
  json(res, 200, { id: row.id, status: row.status, decidedAt: toMs(row.decided_at), by: row.decided_by || null, note: row.note || '' }, req);
}

// ---- requests -------------------------------------------------------------------------------------
async function postRequest(req, res, body) {
  const type = cleanText(body.type, 80);
  if (!type) throw new HttpError(400, 'type is required');
  const id = wellFormedClientId(body.id, 'rq') || newId('rq');
  const row = {
    id, type,
    detail: cleanText(body.detail, 400),
    name: cleanText(body.name, 120),
    to: cleanEmail(body.to) || DEFAULT_REVIEWER,
    status: 'New',
    meta: { submittedAt: toMs(body.at ?? body.submittedAt) || Date.now(), client: 'quik1' }
  };
  await upsert('q1_requests', [row], 'id', { ignoreDuplicates: true, returning: false });
  json(res, 201, { id, status: 'New' }, req);
}

// ---- repayments -----------------------------------------------------------------------------------
// Keys are scoped to one customer record (`app:<applicationId>`, written by staff); the bare
// `app` the local original used would be one global flag shown to every customer, so it is
// answered with null without touching the table.
async function getRepayment(req, res, key) {
  if (!isSafeId(key)) throw new HttpError(400, 'bad key');
  if (key.indexOf(':') < 0) { json(res, 200, null, req); return; }
  const row = await selectOne('q1_repayments', { select: 'key,ok,by,at', key: eq(key) });
  json(res, 200, row ? { ok: !!row.ok, by: row.by || 'Admin', at: toMs(row.at) } : null, req);
}

export default wrap('quik1', async (req, res) => {
  requireEnv(ENV);
  const rl = publicLimiter.check(clientIp(req));
  res.setHeader('X-RateLimit-Limit', String(publicLimiter.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); throw new HttpError(429, 'Too many requests'); }

  const [head, id, ...rest] = pathParts(req, 'quik1');
  if (rest.length) throw new HttpError(404, 'Not found');
  const method = req.method;

  if (head === 'applications') {
    if (!id && method === 'POST') return postApplication(req, res, await readBody(req, PUBLIC_BODY_CAP));
    if (id && method === 'GET') return getApplication(req, res, id);
  } else if (head === 'signups') {
    if (!id && method === 'POST') return postSignup(req, res, await readBody(req, PUBLIC_BODY_CAP));
    if (id && method === 'GET') return getSignup(req, res, id);
  } else if (head === 'requests') {
    if (!id && method === 'POST') return postRequest(req, res, await readBody(req, PUBLIC_BODY_CAP));
  } else if (head === 'repayments') {
    if (id && method === 'GET') return getRepayment(req, res, id);
  } else {
    throw new HttpError(404, 'Not found');
  }
  throw new HttpError(405, 'Method not allowed');
});
