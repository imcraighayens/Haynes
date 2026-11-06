// Prospective companies asking to use Ledger as their own product.
// This is not a borrower loan application and it is not EcoLoans staff sign-up.
// Nothing here is persisted: there is no company table, no tenant, no billing
// provider, and no checkout. The handler never reads or writes the database,
// never inserts a staff row, and never accepts card data.
import { wrap, json, readBody, pathParts, HttpError, PUBLIC_BODY_CAP } from './_lib/http.js';
import { isSameOrigin } from './_lib/auth.js';
import { createLimiter, clientIp } from './_lib/ratelimit.js';

const NOT_CONFIGURED = Object.freeze({
  configured: false,
  persistence: false,
  billing: false,
  saved: false,
  charged: false
});

const limiter = createLimiter({ limit: 10, windowMs: 60_000 });
const PAYMENT_KEYS = ['card', 'cardNumber', 'card_number', 'pan', 'cvv', 'cvc', 'expiry', 'amount', 'price', 'currency', 'plan'];

function clean(value, max) {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s.slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!email || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function validPhone(value) {
  const raw = clean(value, 32);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return raw;
}

function rejectPaymentFields(body) {
  if (!body || typeof body !== 'object') return;
  for (const key of PAYMENT_KEYS) {
    if (body[key] != null && String(body[key]).trim() !== '') {
      throw new HttpError(400, 'Card details and prices are not accepted here.', { ...NOT_CONFIGURED });
    }
  }
}

function readApplication(body) {
  rejectPaymentFields(body);
  const company = clean(body && body.company, 120);
  const contact = clean(body && body.contact, 80);
  const email = validEmail(body && body.email);
  const phone = validPhone(body && body.phone);
  if (company.length < 2 || contact.length < 2 || !email || phone === null) {
    throw new HttpError(400, 'Enter the company name, your name, and a work email.', { ...NOT_CONFIGURED });
  }
  return { company, contact, email, phone };
}

function unavailable() {
  throw new HttpError(503, 'Company onboarding is not configured', { ...NOT_CONFIGURED });
}

export default wrap('company', async (req, res) => {
  if (!isSameOrigin(req)) throw new HttpError(403, 'Same-origin required');
  const [head, ...rest] = pathParts(req, 'company');
  if (rest.length) throw new HttpError(404, 'Not found');

  if (head === 'status') {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    json(res, 200, { ...NOT_CONFIGURED }, req);
    return;
  }

  if (head === 'apply') {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    const burst = limiter.check(clientIp(req));
    if (!burst.ok) {
      res.setHeader('Retry-After', String(burst.retryAfter));
      throw new HttpError(429, 'Too many requests', { ...NOT_CONFIGURED });
    }
    const body = await readBody(req, PUBLIC_BODY_CAP);
    readApplication(body);
    // Valid shape, and still nowhere to put it. Drop the values on the floor.
    unavailable();
  }

  throw new HttpError(404, 'Not found');
});
