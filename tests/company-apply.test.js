// Company apply is a public check only. It must not write the EcoLoans book,
// staff list, or any payment. Fixture text below is not a real company.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../api/company.js', import.meta.url), 'utf8');
const handler = (await import('../api/company.js')).default;

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}

async function call({ method = 'POST', path = ['apply'], headers = {}, body }) {
  const req = {
    method,
    query: { path },
    url: '/api/company/' + path.join('/'),
    headers,
    body
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

const same = { origin: 'https://quik1ledger.com', host: 'quik1ledger.com', 'sec-fetch-site': 'same-origin' };
const company = { company: 'Northwind Lending', contact: 'Ada Admin', email: 'ada@northwind.test', phone: '0820000000' };

test('the company route has no book, staff, or payment integration', () => {
  assert.doesNotMatch(source, /supabase|employees|applications|stripe|service_role|LEDGER_KEY/i);
  assert.match(source, /saved: false/);
  assert.match(source, /charged: false/);
  assert.match(source, /Company onboarding is not configured/);
});

test('status and a valid application are not stored or charged', async () => {
  globalThis.fetch = async () => { throw new Error('company route must not touch the network'); };
  const status = await call({ method: 'GET', path: ['status'], headers: same });
  assert.equal(status.statusCode, 200);
  assert.deepEqual(status.json(), {
    configured: false, persistence: false, billing: false, saved: false, charged: false
  });

  const cross = await call({ headers: { origin: 'https://evil.example', host: 'quik1ledger.com', 'sec-fetch-site': 'cross-site' }, body: company });
  assert.equal(cross.statusCode, 403);

  const missing = await call({ headers: same, body: { company: 'A', contact: '', email: 'nope' } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().saved, false);
  assert.equal(missing.json().charged, false);

  const card = await call({ headers: same, body: { ...company, cardNumber: 'card-value-should-not-echo' } });
  assert.equal(card.statusCode, 400);
  assert.equal(card.body.includes('card-value-should-not-echo'), false);
  assert.match(card.json().error, /Card details/);

  const okShape = await call({ headers: same, body: company });
  assert.equal(okShape.statusCode, 503);
  assert.equal(okShape.json().error, 'Company onboarding is not configured');
  assert.equal(okShape.json().saved, false);
  assert.equal(okShape.json().charged, false);
  assert.equal(okShape.json().configured, false);
  assert.equal(okShape.body.includes('northwind.test'), false);
  assert.equal(okShape.body.includes('Ada Admin'), false);
});
