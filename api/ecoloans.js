// Public ingest for the EcoLoans marketing site (ecoloan.co.za / ecoloans.co.za).
// No auth, no LEDGER_KEY. Insert-only into the same `applications` table Quik1 uses,
// with its own source, id/ref prefixes, rate caps and CORS allowlist.
//   POST /api/ecoloans/applications
//   OPTIONS /api/ecoloans/applications
import { randomBytes } from 'node:crypto';
import { wrap, json, readBody, pathParts, requireEnv, HttpError, PUBLIC_BODY_CAP } from './_lib/http.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';
import { selectOne, count, upsert, eq } from './_lib/supabase.js';
import {
  wellFormedClientId, cleanText, cleanPhone, cleanEmail, parseAmount, parseTerm, num, toMs
} from './_lib/validate.js';

const ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const SOURCE = 'ecoloan_web';
const REF_BASE = 1085; // same neighbourhood as Quik1's AP- refs; the EW- prefix keeps them distinct
const RAW_MAX = 60;
const DOCS_MAX = 5;
const DOC_NAME_MAX = 80;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

// Exact browser origins. Live site is ecoloan.co.za; GoDaddy will also serve ecoloans.co.za.
export const CORS_ORIGINS = Object.freeze([
  'https://ecoloan.co.za',
  'https://www.ecoloan.co.za',
  'https://ecoloans.co.za',
  'https://www.ecoloans.co.za'
]);

// Own in-memory bucket. Quik1's publicLimiter is a poller (default 120/min); this route is a
// form post, so the default is lower and the key prefix keeps the two maps from coupling
// even if a later change shared the limiter object.
const RATE_LIMIT = Math.max(1, parseInt(process.env.ECOLOANS_RATE_LIMIT, 10) || 30);
export const ecoloansLimiter = createLimiter({ limit: RATE_LIMIT, windowMs: 60_000 });

function cap(name, dflt) {
  return Math.max(1, parseInt(process.env[name], 10) || dflt);
}
function newId() { return `ew_${randomBytes(6).toString('hex')}`; }

function present(v) { return !(v == null || (typeof v === 'string' && v.trim() === '')); }
function first(...vals) {
  for (const v of vals) if (present(v)) return v;
  return undefined;
}

function loanTypeOf(body) {
  const s = cleanText(first(body.loanType, body.type, body.atype), 20).toLowerCase();
  return s === 'personal' || s === 'business' ? s : '';
}

// Numeric income wins. A marketing-site band ("R5 000 to R10 000", "Under R5 000") is not a
// salary figure — callers keep it on meta.takeHome instead of coercing it to 0.
function numericIncome(v) {
  if (!present(v)) return null;
  const stripped = String(v).replace(/[R\s,]/g, '');
  if (!/^[\d.]+$/.test(stripped)) return null;
  const n = num(v, NaN);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}
function netIncomeOf(body) {
  for (const v of [body.income, body.net_income, body.takeHome, body.aTake]) {
    const n = numericIncome(v);
    if (n != null) return n;
  }
  return null;
}
function takeHomeBand(body) {
  const v = first(body.takeHome, body.aTake);
  if (v == null || numericIncome(v) != null) return '';
  return cleanText(v, RAW_MAX);
}

function rawExtras(body, loanType) {
  const out = {};
  if (loanType) out.loanType = loanType;
  const extras = {
    employment: body.employment,
    payday: first(body.payday, body.aPay),
    business: first(body.business, body.aWork),
    cipc: first(body.cipc, body.aReg, body.reg),
    industry: first(body.industry, body.aInd),
    trading: first(body.trading, body.ayears),
    incomeType: first(body.incomeType, body.ainc)
  };
  for (const [k, v] of Object.entries(extras)) {
    if (!present(v)) continue;
    const t = typeof v === 'number' ? v : cleanText(v, RAW_MAX);
    if (t !== '' && t != null) out[k] = t;
  }
  return out;
}

function docsOf(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, DOCS_MAX).map(d => (typeof d === 'string' ? cleanText(d, DOC_NAME_MAX) : (d && typeof d === 'object' && d.name ? cleanText(d.name, DOC_NAME_MAX) : ''))).filter(Boolean);
}

function amountOf(body) {
  const raw = first(body.amount, body.aAmt);
  if (raw == null) return null;
  return parseAmount(raw);
}

async function postApplication(req, res, body) {
  const name = cleanText(first(body.name, body.aName), 120);
  if (!name) throw new HttpError(400, 'name is required');
  const phone = cleanPhone(first(body.phone, body.aCell));
  if (!phone) throw new HttpError(400, 'phone is required');
  const amount = amountOf(body);
  const id = wellFormedClientId(body.id, 'ew') || newId();
  // A retried submit with the same client id answers from the stored row. Its ref is already
  // assigned and staff may already have moved it on; we never reset status or mint a second ref.
  const saved = await selectOne('applications', { select: 'id,ref,status', id: eq(id), source: eq(SOURCE) });
  if (saved) { json(res, 200, { id: saved.id, ref: saved.ref, status: saved.status || 'new' }, req); return; }
  const since = ms => new Date(Date.now() - ms).toISOString();
  const [lastHour, samePhone] = await Promise.all([
    count('applications', { source: eq(SOURCE), created_at: 'gte.' + since(HOUR_MS) }),
    count('applications', { source: eq(SOURCE), phone: eq(phone), created_at: 'gte.' + since(DAY_MS) })
  ]);
  if (lastHour >= cap('ECOLOANS_HOURLY_CAP', 60) || samePhone >= cap('ECOLOANS_PHONE_DAILY_CAP', 3)) {
    res.setHeader('Retry-After', '900');
    throw new HttpError(429, 'Too many applications right now — please try again later');
  }
  const existing = await count('applications', {});
  const loanType = loanTypeOf(body);
  const band = takeHomeBand(body);
  const province = cleanText(first(body.province, body.aProv), 40);
  const employerName = cleanText(first(body.employer, body.aEmp, body.aWork), 120);
  const employment = cleanText(body.employment, 120);
  const row = {
    id,
    ref: `EW-${REF_BASE + existing}`,
    name,
    phone,
    email: cleanEmail(first(body.email, body.aEmail)) || null,
    id_number: cleanText(first(body.idNumber, body.id_number, body.idnum), 20) || null,
    amount,
    term_months: parseTerm(first(body.term, body.term_months, body.aterm)),
    purpose: cleanText(first(body.purpose, body.why, body.awhy), 120) || 'Personal',
    net_income: netIncomeOf(body),
    employer: employerName || employment || null,
    bank: cleanText(first(body.bank, body.aBank), 80) || null,
    source: SOURCE,
    status: 'new',
    meta: {
      submittedAt: toMs(body.submittedAt) || Date.now(),
      client: SOURCE,
      docs: docsOf(body.docs),
      ...(province ? { province } : {}),
      ...(band ? { takeHome: band } : {}),
      raw: rawExtras(body, loanType)
    }
  };
  await upsert('applications', [row], 'id', { ignoreDuplicates: true, returning: false });
  json(res, 201, { id, ref: row.ref, status: 'new' }, req);
}

const inner = wrap('ecoloans', async (req, res) => {
  requireEnv(ENV);
  const rl = ecoloansLimiter.check('ecoloans:' + clientIp(req));
  res.setHeader('X-RateLimit-Limit', String(ecoloansLimiter.limit));
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  if (!rl.ok) { res.setHeader('Retry-After', String(rl.retryAfter)); throw new HttpError(429, 'Too many requests'); }

  const [head, id, ...rest] = pathParts(req, 'ecoloans');
  if (rest.length) throw new HttpError(404, 'Not found');
  if (head === 'applications' && !id && req.method === 'POST') {
    return postApplication(req, res, await readBody(req, PUBLIC_BODY_CAP));
  }
  if (head !== 'applications') throw new HttpError(404, 'Not found');
  throw new HttpError(405, 'Method not allowed');
});

export default function handler(req, res) {
  if (req) {
    req.corsAllowlist = CORS_ORIGINS;
    req.corsAllowMethods = 'POST, OPTIONS';
    req.corsAllowHeaders = 'Content-Type';
  }
  return inner(req, res);
}
