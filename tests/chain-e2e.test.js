// API chain through the real handlers on tools/mock-api.js (in-memory PostgREST, no network).
// What works today is asserted. Each known break is a todo whose reason names the break id
// and the later PR that flips it on, so this file stays green on master.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startMockApi, loadFixture } from '../tools/mock-api.js';
import { mintBorrowerToken, SESSION_COOKIE } from '../api/_lib/quik1-session.js';
import { publicLimiter } from '../api/_lib/ratelimit.js';
import { ecoloansLimiter } from '../api/ecoloans.js';

const LEDGER_KEY = 'test-ledger-key';
const SESSION_SECRET = 'test-quik1-session-secret-not-real';
const BORROWER_ID = 'qb_chain_fixture_1';
const SESSION_ID = 'qs_chain_fixture_1';
const CLIENT_ID = 'c_test_1';
const SEEDED_LOAN_ID = 'l_chain_sync_1';
const SEEDED_REF = 'ECL-9901';
const SEEDED_SCHEDULE = ['2026-12-24', '2027-01-25', '2027-02-24'];
const FIXTURE_LOAN_COUNT = 5;

process.env.QUIK1_SESSION_SECRET = SESSION_SECRET;

function chainSeed() {
  const seed = loadFixture();
  const extra = JSON.parse(fs.readFileSync(new URL('./fixtures/chain-session.json', import.meta.url), 'utf8'));
  seed.q1_borrowers = extra.q1_borrowers;
  seed.q1_sessions = extra.q1_sessions;
  return seed;
}

// submitPublicApplication JSON.stringifies exactly these keys (quik1/index.html).
// term is activeTerm(): state.term (default 3) when longer terms are unlocked, otherwise 1.
// income is num(income) || num(estIncome). amount defaults to 2500.
function applicationBody({ name, phone, amount = 2500, purpose = 'Groceries', income = 9000, term = 1 }) {
  const body = { name, phone, amount, purpose: purpose || 'Personal', income, term };
  assert.deepEqual(Object.keys(body), ['name', 'phone', 'amount', 'purpose', 'income', 'term']);
  return body;
}

describe('loan chain over the mock API', { concurrency: false }, () => {
  let api;

  before(async () => {
    api = await startMockApi({ key: LEDGER_KEY, fixture: chainSeed(), quiet: true });
  });

  after(async () => {
    if (api) await api.close();
  });

  beforeEach(async () => {
    const reset = await fetch(api.origin + '/__mock/reset', { method: 'POST' });
    assert.equal(reset.status, 200);
    publicLimiter.reset();
    ecoloansLimiter.reset();
  });

  function staff(extra = {}) {
    return { authorization: 'Bearer ' + LEDGER_KEY, accept: 'application/json', ...extra };
  }

  function borrowerCookie() {
    const minted = mintBorrowerToken({ sid: SESSION_ID, bid: BORROWER_ID, cid: CLIENT_ID });
    assert.ok(minted && minted.token);
    return SESSION_COOKIE + '=' + encodeURIComponent(minted.token);
  }

  async function call(path, { method = 'GET', headers = {}, body, cookie } = {}) {
    const res = await fetch(api.origin + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    return { status: res.status, json, text };
  }

  async function table(name) {
    const res = await call('/__mock/db/' + name);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    return res.json;
  }

  async function apply(fields, { cookie } = {}) {
    const body = applicationBody(fields);
    const res = await call('/api/quik1/applications', { method: 'POST', body, cookie });
    assert.equal(res.status, 201, res.text);
    assert.match(res.json.id, /^ap_[0-9a-f]{12}$/);
    assert.match(res.json.ref, /^AP-\d+$/);
    assert.equal(res.json.status, 'Needs decision');
    return { body, res: res.json };
  }

  test('a public application is stored and the ledger feed returns every field that was sent', async () => {
    const anon = await call('/api/ledger/quik1-feed');
    assert.equal(anon.status, 401);

    const wrong = await call('/api/ledger/quik1-feed', { headers: staff({ authorization: 'Bearer wrong-key' }) });
    assert.equal(wrong.status, 401);

    const sent = await apply({
      name: 'Test Applicant',
      phone: '0820000091',
      amount: 2500,
      purpose: 'Groceries',
      income: 9000,
      term: 3
    }, { cookie: borrowerCookie() });

    const feed = await call('/api/ledger/quik1-feed', { headers: staff() });
    assert.equal(feed.status, 200);
    const row = feed.json.applications.find(a => a.extId === sent.res.id);
    assert.ok(row);
    assert.equal(row.id, 'qk_' + sent.res.id);
    assert.equal(row.name, sent.body.name);
    assert.equal(row.phone, sent.body.phone);
    assert.equal(row.amount, sent.body.amount);
    assert.equal(row.purpose, sent.body.purpose);
    assert.equal(row.income, sent.body.income);
    assert.equal(row.term, sent.body.term);
    assert.equal(row.status, 'new');
    assert.equal(row.source, 'Quik1 app');
    assert.equal(typeof row.submitted, 'string');
    assert.ok(row.submitted.length > 0);

    const stored = (await table('applications')).find(a => a.id === sent.res.id);
    assert.equal(stored.source, 'quik1');
    assert.equal(stored.status, 'new');
    assert.equal(stored.ref, 'AP-1085');
    assert.equal(stored.term_months, 3);
    assert.equal(stored.net_income, 9000);

    const log = await call('/__mock/log');
    assert.equal(log.status, 200);
    assert.ok(log.json.some(entry => entry.table === 'applications' && entry.method === 'POST'));
  });

  test('staff can approve one application and decline another, and the feed shows both decisions', async () => {
    const approve = await apply({
      name: 'Test Approve',
      phone: '0820000091',
      amount: 2500,
      purpose: 'Groceries',
      income: 9000,
      term: 3
    });
    const decline = await apply({
      name: 'Test Decline',
      phone: '0820000092',
      amount: 800,
      purpose: 'School fees',
      income: 7000,
      term: 1
    });
    assert.equal(decline.res.ref, 'AP-1086');

    const anon = await call('/api/ledger/quik1-applications/' + approve.res.id, {
      method: 'POST',
      body: { status: 'approved', amount: approve.body.amount }
    });
    assert.equal(anon.status, 401);

    const bad = await call('/api/ledger/quik1-applications/' + approve.res.id, {
      method: 'POST',
      headers: staff(),
      body: { status: 'maybe', amount: approve.body.amount }
    });
    assert.equal(bad.status, 400);

    const missing = await call('/api/ledger/quik1-applications/ap_000000000000', {
      method: 'POST',
      headers: staff(),
      body: { status: 'approved', amount: 2500 }
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'Application not found');

    const approved = await call('/api/ledger/quik1-applications/' + approve.res.id, {
      method: 'POST',
      headers: staff(),
      body: { status: 'approved', amount: approve.body.amount }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.json.status, 'approved');
    assert.equal(approved.json.verdict, 'approved');
    assert.equal(approved.json.amount, approve.body.amount);
    assert.equal(approved.json.id, approve.res.id);

    const declined = await call('/api/ledger/quik1-applications/' + decline.res.id, {
      method: 'POST',
      headers: staff(),
      body: { status: 'declined', amount: decline.body.amount }
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.json.status, 'declined');
    assert.equal(declined.json.verdict, 'declined');
    assert.equal(declined.json.id, decline.res.id);

    const feed = await call('/api/ledger/quik1-feed', { headers: staff() });
    assert.equal(feed.json.applications.find(a => a.extId === approve.res.id).status, 'approved');
    assert.equal(feed.json.applications.find(a => a.extId === decline.res.id).status, 'declined');

    const own = await call('/api/quik1/applications/' + approve.res.id);
    assert.equal(own.status, 200);
    assert.equal(own.json.status, 'Approved');
    assert.equal(own.json.decision.verdict, 'approved');
  });

  test('current behaviour (B1, B3, B4, B5, B10): approve does not link a loan, a login, or an audit row', async () => {
    const sent = await apply({
      name: 'Test Applicant',
      phone: '0820000091',
      amount: 2500,
      purpose: 'Groceries',
      income: 9000,
      term: 3
    }, { cookie: borrowerCookie() });
    const auditBefore = (await table('audit_log')).map(row => row.id);
    const borrowersBefore = (await table('q1_borrowers')).map(row => row.id);
    const invitesBefore = await table('q1_invites');

    const approved = await call('/api/ledger/quik1-applications/' + sent.res.id, {
      method: 'POST',
      headers: staff(),
      body: { status: 'approved', amount: sent.body.amount }
    });
    assert.equal(approved.status, 200);

    const again = await call('/api/ledger/quik1-applications/' + sent.res.id, {
      method: 'POST',
      headers: staff(),
      body: { status: 'approved', amount: sent.body.amount }
    });
    assert.equal(again.status, 200, 'current behaviour (B10): a second decision is accepted');

    const stored = (await table('applications')).find(a => a.id === sent.res.id);
    assert.equal(stored.status, 'approved');
    assert.equal(stored.decided_by, 'ledger', 'current behaviour (B3): decided_by is the literal ledger');
    assert.equal(stored.decision.verdict, 'approved');
    assert.equal(stored.client_id == null, true, 'current behaviour (B5): public apply never sets client_id');
    assert.equal(stored.loan_id == null, true, 'current behaviour (B1): applications.loan_id is never written');

    const loans = await table('loans');
    assert.equal(loans.length, FIXTURE_LOAN_COUNT, 'current behaviour (B1): approving does not create a loan');
    assert.equal(loans.some(loan => loan.application_id === sent.res.id), false);

    assert.deepEqual((await table('q1_borrowers')).map(row => row.id), borrowersBefore, 'current behaviour (B4): no q1_borrowers row is created');
    assert.equal((await table('q1_invites')).length, invitesBefore.length, 'current behaviour (B4): no invite is created');
    assert.deepEqual((await table('audit_log')).map(row => row.id), auditBefore, 'current behaviour (B3): no server-side audit row');

    const book = await call('/api/quik1/applications', { cookie: borrowerCookie() });
    assert.equal(book.status, 200);
    assert.equal(book.json.applications.some(a => a.id === sent.res.id), false, 'current behaviour (B5): the signed-in book does not list the application');
    const home = await call('/api/quik1/me', { cookie: borrowerCookie() });
    assert.equal(home.status, 200);
    assert.equal(home.json.identified, true);
    assert.equal(home.json.applications.some(a => a.id === sent.res.id), false);
  });

  test('a loan seeded by the sync insert the console sends is the active loan on GET /api/quik1/me', async () => {
    // Same live row dbPush's insert becomes after ledjaa-db toLive (instalment → instalment_amount,
    // application_id null). The wire op exercised here is POST /sync insert, which gives a new
    // loan the server's issued defaults. No paid dates, so the open schedule is the stored dates
    // and does not depend on PR #62's paid-versus-open reader.
    const row = {
      id: SEEDED_LOAN_ID,
      ref: SEEDED_REF,
      client_id: CLIENT_ID,
      application_id: null,
      principal: 1800,
      return_rate_pct: 35,
      instalment_amount: 2430,
      schedule: SEEDED_SCHEDULE,
      instalments_paid: 0,
      status: 'issued',
      purpose: 'Groceries',
      issued_on: '2026-11-25',
      issued_by: 'Test Admin',
      mandate_id: '90009901',
      officer_id: null,
      written_off_at: null,
      write_off_reason: null,
      created_at: '2026-11-25T08:00:00.000Z',
      deleted_at: null
    };
    const synced = await call('/api/ledger/sync', {
      method: 'POST',
      headers: staff(),
      body: { ops: [{ table: 'loans', op: 'insert', rows: [row] }] }
    });
    assert.equal(synced.status, 200, synced.text);
    assert.equal(synced.json.ok, true);
    assert.equal(synced.json.results[0].op, 'insert');
    assert.equal(synced.json.results[0].count, 1);
    assert.equal(synced.json.results[0].error, undefined);

    const stored = (await table('loans')).find(loan => loan.id === SEEDED_LOAN_ID);
    assert.ok(stored);
    assert.equal(stored.application_id, null, 'current behaviour (B1): the console insert stores application_id null');
    assert.equal(stored.status, 'issued');
    assert.equal(stored.principal, 1800);
    assert.equal(stored.instalment_amount, 2430);
    assert.deepEqual(stored.schedule, SEEDED_SCHEDULE);
    assert.equal((await table('loans')).length, FIXTURE_LOAN_COUNT + 1);

    const signedOut = await call('/api/quik1/me');
    assert.equal(signedOut.status, 401);

    const home = await call('/api/quik1/me', { cookie: borrowerCookie() });
    assert.equal(home.status, 200);
    assert.equal(home.json.identified, true);
    assert.equal(home.json.profile.name, 'Test Client One');
    assert.equal(home.json.profile.ref, 'EC-901');
    const loan = home.json.account.loans.find(item => item.ref === SEEDED_REF);
    assert.ok(loan);
    assert.equal(loan.id, SEEDED_LOAN_ID);
    assert.equal(loan.status, 'open');
    assert.equal(loan.principal, 1800);
    assert.equal(loan.outstanding_principal, 1800);
    assert.equal(loan.purpose, 'Groceries');
    assert.equal(loan.instalment, 2430);
    assert.deepEqual(loan.schedule, SEEDED_SCHEDULE);
    assert.equal(home.json.account.loans.some(item => item.ref === 'ECL-901' && item.status === 'open'), true);
  });

  test('current behaviour (B11): approving or declining a website application returns 404', async () => {
    const created = await call('/api/ecoloans/applications', {
      method: 'POST',
      body: { name: 'Web Applicant', phone: '0820000093', amount: 1500, purpose: 'Stock', term: 2 }
    });
    assert.equal(created.status, 201, created.text);
    assert.match(created.json.id, /^ew_[0-9a-f]{12}$/);
    assert.match(created.json.ref, /^EW-\d+$/);

    const feed = await call('/api/ledger/quik1-feed', { headers: staff() });
    const row = feed.json.applications.find(a => a.extId === created.json.id);
    assert.ok(row);
    assert.equal(row.id, created.json.id);
    assert.equal(row.source, 'Website');
    assert.equal(row.name, 'Web Applicant');
    assert.equal(row.amount, 1500);
    assert.equal(row.term, 2);
    assert.equal(row.status, 'new');

    for (const status of ['approved', 'declined']) {
      const decided = await call('/api/ledger/quik1-applications/' + created.json.id, {
        method: 'POST',
        headers: staff(),
        body: { status, amount: 1500 }
      });
      assert.equal(decided.status, 404, 'current behaviour (B11): ' + status + ' of a website application is 404');
      assert.equal(decided.json.error, 'Application not found');
    }
    const stored = (await table('applications')).find(a => a.id === created.json.id);
    assert.equal(stored.source, 'ecoloan_web');
    assert.equal(stored.status, 'new');
  });

  test('GET /api/ledger/state returns applications_unavailable when the applications relation is missing', async () => {
    const healthy = await call('/api/ledger/state', { headers: staff() });
    assert.equal(healthy.status, 200);
    assert.equal('warnings' in healthy.json, false);
    assert.ok(healthy.json.applications.length >= 0);
    assert.ok(healthy.json.clients.length >= 1);

    delete api.db.applications;
    const broken = await call('/api/ledger/state', { headers: staff() });
    assert.equal(broken.status, 200);
    assert.deepEqual(broken.json.applications, []);
    assert.deepEqual(broken.json.warnings, ['applications_unavailable']);
    assert.ok(broken.json.clients.length >= 1);
    assert.ok(broken.json.loans.length >= 1);
    assert.equal(JSON.stringify(broken.json).includes('schema cache'), false);
  });

  test('approving an application creates and activates a loan linked by application_id and writes applications.loan_id and client_id', {
    todo: 'B1 (C4): approving does not create or activate a loan; application_id stays null on loan insert; applications.loan_id and applications.client_id are never written. Flip this on in C4.'
  });

  test('approving an application generates a term-based instalment schedule and GET /api/quik1/me shows it', {
    todo: 'B2 (C4): no term-based instalment schedule is generated from the application. Reading that schedule on /me also depends on the shared reader in PR #62. Flip this on in C4 after #62.'
  });

  test('a decision writes a server-side audit row, records the staff identity, and rejects a repeat decision', {
    todo: 'B3 (C1): decision errors are swallowed and no server-side audit row is written; decided_by is the literal \'ledger\'; there is no state guard or idempotency (B10). Flip this on in C1.'
  });

  test('an approved applicant receives a Quik1 login path', {
    todo: 'B4 (C6): an approved applicant has no path to a Quik1 login (no invite, temp PIN, or q1_borrowers row is created). Flip this on in C6.'
  });

  test('a signed-in public application is filed on that client and comes back on the book', {
    todo: 'B5 (C3/C5): the public apply route never sets client_id, so the signed-in book never lists that application. Flip this on in C3/C5.'
  });

  test('staff can approve and decline a website application', {
    todo: 'B11 (C1): website (ew_ id, source other than quik1) approve and decline return 404. Flip this on in C1.'
  });

  test('an applications_unavailable warning is shown to staff as a visible notice', {
    todo: 'B12 (C7): /state warnings [\'applications_unavailable\'] are dropped with no visible notice. Flip this on in C7.'
  });
});
