// node --test tests/api/   — shared helpers: auth (timing-safe), rate limiter, validation/whitelists.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KEY = 'ledger-test-key-0123456789abcdef';
process.env.LEDGER_KEY = KEY;

const { requireStaff, safeEqual, bearerToken } = await import('../../api/_lib/auth.js');
const { createLimiter, clientIp } = await import('../../api/_lib/ratelimit.js');
const V = await import('../../api/_lib/validate.js');
const { HttpError, readBody, pathParts } = await import('../../api/_lib/http.js');

const here = path.dirname(fileURLToPath(import.meta.url));

describe('lib', () => {
beforeEach(() => { process.env.LEDGER_KEY = KEY; });
test('auth: Bearer or apikey header must equal LEDGER_KEY; mismatch is 401', () => {
  assert.equal(requireStaff({ headers: { authorization: 'Bearer ' + process.env.LEDGER_KEY } }), true);
  assert.equal(requireStaff({ headers: { apikey: process.env.LEDGER_KEY } }), true);
  for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'Bearer ledger-test-key-0123456789abcdeX' }, { authorization: 'Basic abc' }, { apikey: '' }]) {
    assert.throws(() => requireStaff({ headers }), e => e instanceof HttpError && e.status === 401);
  }
  assert.equal(bearerToken({ headers: { authorization: 'bearer   abc  ' } }), 'abc');
});

test('auth: compare is constant-time (timingSafeEqual over digests) and tolerates length mismatch', () => {
  const src = readFileSync(path.join(here, '../../api/_lib/auth.js'), 'utf8');
  assert.match(src, /timingSafeEqual/);
  assert.match(src, /from 'node:crypto'/);
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abcd'), false);     // different lengths must not throw
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'x'), false);
});

test('auth: missing LEDGER_KEY is a 503, never a pass', () => {
  const saved = process.env.LEDGER_KEY; delete process.env.LEDGER_KEY;
  try { assert.throws(() => requireStaff({ headers: { authorization: 'Bearer ' } }), e => e.status === 503); }
  finally { process.env.LEDGER_KEY = saved; }
});

test('ratelimit: allows `limit` hits per window per key, then blocks until the window resets', () => {
  const lim = createLimiter({ limit: 3, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(lim.check('a', t0).ok, true);
  assert.equal(lim.check('a', t0 + 1).ok, true);
  assert.equal(lim.check('a', t0 + 2).remaining, 0);
  const blocked = lim.check('a', t0 + 3);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal(lim.check('b', t0 + 3).ok, true, 'other keys are independent');
  assert.equal(lim.check('a', t0 + 1001).ok, true, 'window reset');
  lim.reset(); assert.equal(lim.size(), 0);
});

test('ratelimit: client ip comes from x-forwarded-for first hop, then x-real-ip, then socket', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-real-ip': '5.6.7.8' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
});

test('validate.pick: unknown columns dropped, NCR/fee settings stripped, values coerced', () => {
  const s = V.pick('settings', { id: 'org', org_name: 'Ecoloans', ncr_reg_no: 'NCRCP123', company_reg_no: '2020/1', default_collection_fee: 99, protection_fee: 12, bank_opening_balance: 'R 12,500.50', bogus: 1 });
  assert.deepEqual(s, { id: 'org', org_name: 'Ecoloans', bank_opening_balance: 12500.5 });
  for (const k of V.SETTINGS_FORBIDDEN) assert.equal(V.COLUMNS.settings.includes(k), false);

  const l = V.pick('loans', { id: 'l1', ref: 'ECL-1', client_id: 'c1', principal: '4050', instalment: 4140.47, status: 'Paid in full', schedule: ['25 Jun 2026', 'garbage'], issued_on: '5 Aug 2026', instalments_paid: '2', due: '25 Jun 2026', employee_id: 'e1', extra: true });
  assert.deepEqual(l, { id: 'l1', ref: 'ECL-1', client_id: 'c1', principal: 4050, schedule: ['2026-06-25'], instalments_paid: 2, status: 'paid', issued_on: '2026-08-05' });

  const c = V.pick('clients', { id: 'c1', ref: 'EC-1', name: 'X', blocked: 'true', score: '7.9', dob: '1975-11-12', net_salary: 'R18 500', expenses: '{"rent":3000}' });
  assert.deepEqual(c, { id: 'c1', ref: 'EC-1', name: 'X', dob: '1975-11-12', net_salary: 18500, score: 7, blocked: true, expenses: { rent: 3000 } });

  const e = V.pick('employees', { id: 'e1', role: 'Manager', active: 'DISABLED', approval_limit: '250000' });
  assert.deepEqual(e, { id: 'e1', role: 'manager', active: false, approval_limit: 250000 });
  assert.equal('status' in V.pick('loans', { status: 'nonsense' }), false, 'unknown enum values are dropped, not sent');
  // live boolean NOT NULL the console never owns: never forwarded (it once reached PostgREST as null → 23502)
  for (const v of [true, false, null, 'true']) assert.equal('principal_derived' in V.pick('loans', { id: 'l1', principal_derived: v }), false, 'principal_derived ' + v);
  assert.equal(V.COLUMNS.loans.includes('principal_derived'), false);
  assert.throws(() => V.pick('nope', {}), e => e.status === 400);
  assert.throws(() => V.pick('loans', [1]), e => e.status === 400);
});

test('validate: status maps and date parsing', () => {
  assert.equal(V.loanStatusToDb('SETTLED EARLY'), 'settled_early');
  assert.equal(V.loanStatusToDb('written-off'), 'written_off');
  assert.equal(V.loanStatusToDb('active'), 'issued');
  assert.equal(V.applicationStatusToDb('Needs decision'), 'new');
  assert.equal(V.applicationStatusToDb('Docs pending'), 'reviewing');
  assert.equal(V.applicationStatusToDb('REJECTED'), 'declined');
  assert.equal(V.quik1StatusLabel('reviewing'), 'Needs decision');
  assert.equal(V.quik1StatusLabel('approved'), 'Approved');
  assert.equal(V.toIsoDate('25 Jun 2026'), '2026-06-25');
  assert.equal(V.toIsoTs(1793232000000), '2026-10-29T00:00:00.000Z');
  assert.equal(V.toIsoDate('not a date'), null);
  assert.equal(V.parseTerm('3 mo'), 3); assert.equal(V.parseTerm('x'), 1); assert.equal(V.parseTerm(0), 1);
  assert.equal(V.parseAmount('2 500'), 2500);
  assert.throws(() => V.parseAmount(0), e => e.status === 400);
  assert.throws(() => V.parseAmount(50001), e => e.status === 400);
  assert.equal(V.wellFormedClientId('ap_0123456789ab', 'ap'), 'ap_0123456789ab');
  assert.equal(V.wellFormedClientId('ap_0123456789ab', 'su'), null);
  assert.equal(V.wellFormedClientId("ap_'; drop", 'ap'), null);
  assert.equal(V.cleanPhone('082 441 0912'), '082 441 0912'); assert.equal(V.cleanPhone('12'), '');
});

test('http.readBody: parsed objects, strings, streams, and the size cap', async () => {
  assert.deepEqual(await readBody({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(await readBody({ body: '{"a":2}' }), { a: 2 });
  assert.deepEqual(await readBody({ body: '' }), {});
  await assert.rejects(readBody({ body: 'nope' }), e => e.status === 400);
  await assert.rejects(readBody({ body: '"str"' }), e => e.status === 400);
  await assert.rejects(readBody({ body: 'x'.repeat(20_000) }), e => e.status === 413);
  await assert.rejects(readBody({ body: { pad: 'x'.repeat(17_000) } }), e => e.status === 413);
  const { Readable } = await import('node:stream');
  const stream = Readable.from([Buffer.from('{"s":'), Buffer.from('true}')]);
  assert.deepEqual(await readBody(stream), { s: true });
});

test('http.pathParts: Vercel query array, single string, or URL fallback', () => {
  assert.deepEqual(pathParts({ query: { path: ['applications', 'ap_1'] } }), ['applications', 'ap_1']);
  assert.deepEqual(pathParts({ query: { path: 'state' } }), ['state']);
  assert.deepEqual(pathParts({ url: '/api/ledger/rest/v1/ledger_book?id=eq.main' }, 'ledger'), ['rest', 'v1', 'ledger_book']);
});
});
