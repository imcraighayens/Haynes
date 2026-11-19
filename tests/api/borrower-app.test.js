// Session-scoped Quik1 book: one client cannot read another, a withdrawal
// reaches the Ledger inbox and comes back, a message does the same, and a
// signed-out request gets none of the book.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { publicLimiter, authLimiter } from '../../api/_lib/ratelimit.js';
import { accountFromLoans } from '../../api/_lib/quik1-book.js';
import { mintBorrowerToken } from '../../api/_lib/quik1-session.js';

const SECRET = 'borrower-session-secret-for-tests-only';
const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const CLIENT_A = 'c_book_a';
const CLIENT_B = 'c_book_b';
const NAME_A = 'Book Client A';
const NAME_B = 'Book Client B';
const PIN_A = '246810';
const PIN_B = '802468';
const LOAN_A = 'l_a_open';
const LOAN_B = 'l_b_open';
const REF_A = 'ECL-901';
const REF_B = 'ECL-902';
const NOTE_A = 'Please check the next due date';
const NOTE_B = 'This note belongs to the other client';
const REPLY = 'Recorded on the ledger';
const PURPOSE = 'School fees';

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;
process.env.QUIK1_SESSION_SECRET = SECRET;

const seed = {
  clients: [
    { id: CLIENT_A, ref: 'EC-901', name: NAME_A, bank: 'Example Bank', deleted_at: null },
    { id: CLIENT_B, ref: 'EC-902', name: NAME_B, bank: 'Other Bank', deleted_at: null }
  ],
  loans: [
    { id: 'l_a_paid', ref: 'ECL-900', client_id: CLIENT_A, principal: 2000, status: 'paid', schedule: ['2026-07-25'], instalment_amount: 2000, issued_on: '2026-06-25', paid_dates: ['2026-07-25'], deleted_at: null },
    { id: LOAN_A, ref: REF_A, client_id: CLIENT_A, principal: 500, status: 'issued', schedule: ['2026-12-25', '2026-11-25'], instalment_amount: 250, instalments_paid: 1, purpose: 'Stock', issued_on: '2026-10-25', paid_dates: [], deleted_at: null },
    { id: LOAN_B, ref: REF_B, client_id: CLIENT_B, principal: 900, status: 'issued', schedule: ['2026-11-25'], instalment_amount: 900, purpose: 'Fees', issued_on: '2026-10-01', deleted_at: null }
  ],
  applications: [],
  q1_messages: [],
  q1_borrowers: [],
  q1_invites: [],
  q1_sessions: [],
  q1_devices: [],
  q1_otp_challenges: [],
  q1_auth_attempts: []
};

const fake = createFakePostgrest(seed);
const quik1 = (await import('../../api/quik1.js')).default;
const ledger = (await import('../../api/ledger.js')).default;

function makeRes() {
  const res = {
    statusCode: 0, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
  };
  res.json = () => (res.body ? JSON.parse(res.body) : undefined);
  return res;
}

let ipSeq = 0;
async function call(handler, { method = 'GET', path = [], headers = {}, body } = {}) {
  const req = {
    method,
    query: { path },
    url: '/api/' + path.join('/'),
    headers: { host: handler === ledger ? 'localhost' : 'quik1.test', 'x-forwarded-proto': 'https', 'x-forwarded-for': '198.51.100.' + (++ipSeq % 200), ...headers },
    body
  };
  const res = makeRes();
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.LEDGER_KEY = STAFF;
  process.env.QUIK1_SESSION_SECRET = SECRET;
  await handler(req, res);
  return res;
}

function cookieHeader(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw || ''];
  return list.map(c => String(c).split(';')[0]).filter(Boolean).join('; ');
}

async function signIn(clientId, pin) {
  const created = await call(ledger, {
    method: 'POST', path: ['quik1-invites'], headers: { authorization: 'Bearer ' + STAFF }, body: { clientId }
  });
  assert.equal(created.statusCode, 201);
  const redeemed = await call(quik1, {
    method: 'POST', path: ['invites', 'redeem'], body: { code: created.json().code, pin, pinConfirm: pin }
  });
  assert.equal(redeemed.statusCode, 200);
  return cookieHeader(redeemed);
}

let restore = () => {};
describe('borrower book', { concurrency: false }, () => {
  beforeEach(() => {
    publicLimiter.reset();
    authLimiter.reset();
    fake.reset();
    process.env.QUIK1_BORROWER_PIN = '1';
    restore();
    restore = install(fake, URL);
  });
  afterEach(() => { restore(); restore = () => {}; });

  test('a signed-out request gets no book, and one client cannot read the other', async () => {
    const loans = await call(quik1, { method: 'GET', path: ['loans'] });
    const statements = await call(quik1, { method: 'GET', path: ['statements'] });
    const messages = await call(quik1, { method: 'GET', path: ['messages'] });
    const apps = await call(quik1, { method: 'GET', path: ['applications'] });
    const home = await call(quik1, { method: 'GET', path: ['me'] });
    for (const res of [loans, statements, messages, apps, home]) {
      assert.equal(res.statusCode, 401);
      const raw = JSON.stringify(res.json());
      assert.equal(raw.includes(NAME_A), false);
      assert.equal(raw.includes(NAME_B), false);
      assert.equal(raw.includes(REF_A), false);
      assert.equal(raw.includes(REF_B), false);
    }

    const stale = mintBorrowerToken({ sid: 'qs_missing', bid: 'qb_missing', cid: CLIENT_A });
    delete fake.db.q1_sessions;
    delete fake.db.q1_borrowers;
    delete fake.db.q1_invites;
    const quiet = await call(quik1, {
      method: 'GET', path: ['me'], headers: { cookie: 'q1_session=' + encodeURIComponent(stale.token) }
    });
    assert.equal(quiet.statusCode, 200);
    assert.equal(quiet.json().identified, false);
    fake.reset();

    const cookieA = await signIn(CLIENT_A, PIN_A);
    const cookieB = await signIn(CLIENT_B, PIN_B);
    const own = await call(quik1, { method: 'GET', path: ['loans'], headers: { cookie: cookieA } });
    assert.equal(own.statusCode, 200);
    const refs = own.json().loans.map(l => l.ref);
    assert.equal(refs.includes(REF_A), true);
    assert.equal(refs.includes(REF_B), false);
    assert.equal(JSON.stringify(own.json()).includes(NAME_B), false);
    assert.equal(JSON.stringify(own.json()).includes(CLIENT_B), false);

    const other = await call(quik1, { method: 'GET', path: ['loans', LOAN_B], headers: { cookie: cookieA } });
    assert.equal(other.statusCode, 404);
    assert.equal(JSON.stringify(other.json()).includes(REF_B), false);

    const sheet = await call(quik1, { method: 'GET', path: ['statements'], headers: { cookie: cookieA } });
    assert.equal(sheet.statusCode, 200);
    assert.equal(JSON.stringify(sheet.json()).includes(REF_B), false);
    assert.equal(sheet.json().statements.some(s => s.ref === REF_A), true);

    const crossed = await call(quik1, { method: 'GET', path: ['messages'], headers: { cookie: cookieB } });
    assert.equal(crossed.statusCode, 200);
    assert.equal(JSON.stringify(crossed.json()).includes(NOTE_A), false);
  });

  test('a withdrawal lands in the Ledger inbox and the decision comes back only to that client', async () => {
    const cookieA = await signIn(CLIENT_A, PIN_A);
    const cookieB = await signIn(CLIENT_B, PIN_B);
    const tooMuch = await call(quik1, {
      method: 'POST', path: ['withdrawals'], headers: { cookie: cookieA },
      body: { amount: 5000, purpose: PURPOSE }
    });
    assert.equal(tooMuch.statusCode, 400);

    const sent = await call(quik1, {
      method: 'POST', path: ['withdrawals'], headers: { cookie: cookieA },
      body: { amount: 400, purpose: PURPOSE }
    });
    assert.equal(sent.statusCode, 201);
    const created = sent.json();
    assert.equal(created.status, 'new');
    assert.equal(created.purpose, PURPOSE);
    assert.equal(created.phone, undefined);
    assert.equal(JSON.stringify(created).includes(PIN_A), false);
    const borrowersBefore = fake.db.q1_borrowers.length;

    const anonFeed = await call(ledger, { method: 'GET', path: ['quik1-feed'] });
    assert.equal(anonFeed.statusCode, 401);

    const feed = await call(ledger, {
      method: 'GET', path: ['quik1-feed'], headers: { authorization: 'Bearer ' + STAFF }
    });
    assert.equal(feed.statusCode, 200);
    const row = feed.json().applications.find(a => a.extId === created.id);
    assert.ok(row);
    assert.equal(row.status, 'new');
    assert.equal(row.name, NAME_A);
    assert.equal(row.existingClientId, CLIENT_A);

    const hidden = await call(quik1, { method: 'GET', path: ['applications'], headers: { cookie: cookieB } });
    assert.equal(hidden.statusCode, 200);
    assert.equal(hidden.json().applications.some(a => a.id === created.id), false);
    assert.equal(JSON.stringify(hidden.json()).includes(created.ref), false);

    const decided = await call(ledger, {
      method: 'POST', path: ['quik1-applications', created.id],
      headers: { authorization: 'Bearer ' + STAFF },
      body: { status: 'approved', amount: 400 }
    });
    assert.equal(decided.statusCode, 200);
    assert.equal(decided.json().status, 'approved');

    const back = await call(quik1, { method: 'GET', path: ['applications'], headers: { cookie: cookieA } });
    assert.equal(back.json().applications.find(a => a.id === created.id).status, 'approved');
    const stillHidden = await call(quik1, { method: 'GET', path: ['applications'], headers: { cookie: cookieB } });
    assert.equal(stillHidden.json().applications.some(a => a.id === created.id), false);
    assert.equal(fake.db.q1_borrowers.length, borrowersBefore);
    assert.equal(fake.db.loans.length, seed.loans.length);
  });

  test('a support message reaches Ledger and the reply comes back only to that client', async () => {
    const cookieA = await signIn(CLIENT_A, PIN_A);
    const cookieB = await signIn(CLIENT_B, PIN_B);
    const anon = await call(quik1, { method: 'POST', path: ['messages'], body: { body: NOTE_A } });
    assert.equal(anon.statusCode, 401);

    const sent = await call(quik1, {
      method: 'POST', path: ['messages'], headers: { cookie: cookieA }, body: { body: NOTE_A }
    });
    assert.equal(sent.statusCode, 201);
    await call(quik1, {
      method: 'POST', path: ['messages'], headers: { cookie: cookieB }, body: { body: NOTE_B }
    });

    const feed = await call(ledger, {
      method: 'GET', path: ['quik1-feed'], headers: { authorization: 'Bearer ' + STAFF }
    });
    const threadA = feed.json().threads.find(t => t.clientId === CLIENT_A);
    const threadB = feed.json().threads.find(t => t.clientId === CLIENT_B);
    assert.equal(threadA.lines.some(l => l.body === NOTE_A), true);
    assert.equal(threadA.lines.some(l => l.body === NOTE_B), false);
    assert.equal(threadB.lines.some(l => l.body === NOTE_A), false);

    const reply = await call(ledger, {
      method: 'POST', path: ['quik1-messages'],
      headers: { authorization: 'Bearer ' + STAFF },
      body: { clientId: CLIENT_A, body: REPLY }
    });
    assert.equal(reply.statusCode, 201);

    const mine = await call(quik1, { method: 'GET', path: ['messages'], headers: { cookie: cookieA } });
    const texts = mine.json().messages.map(m => m.body);
    assert.equal(texts.includes(NOTE_A), true);
    assert.equal(texts.includes(REPLY), true);
    assert.equal(texts.includes(NOTE_B), false);
    const other = await call(quik1, { method: 'GET', path: ['messages'], headers: { cookie: cookieB } });
    assert.equal(other.json().messages.map(m => m.body).includes(REPLY), false);
    assert.equal(other.json().messages.map(m => m.body).includes(NOTE_A), false);
  });

  test('a new application does not create a login, and the file stays private', async () => {
    const before = fake.db.q1_borrowers.length;
    const contact = ['0', '8', '2', '0', '0', '0', '0', '0', '0', '0'].join('');
    const sent = await call(quik1, {
      method: 'POST', path: ['applications'],
      body: { name: 'New Applicant', phone: contact, amount: 800, purpose: 'Home repairs' }
    });
    assert.equal(sent.statusCode, 201);
    assert.equal(fake.db.q1_borrowers.length, before);
    assert.equal(sent.headers['set-cookie'], undefined);
    const id = sent.json().id;
    const row = fake.db.applications.find(a => a.id === id);
    assert.equal(row.client_id == null, true);
    assert.equal(row.status, 'new');

    const file = Buffer.from('statement-bytes').toString('base64');
    const uploaded = await call(quik1, {
      method: 'POST', path: ['documents'],
      body: { applicationId: id, name: 'statement.pdf', contentType: 'application/pdf', data: file }
    });
    assert.equal(uploaded.statusCode, 201);
    const body = uploaded.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'statement.pdf');
    assert.equal(JSON.stringify(body).includes('http'), false);
    assert.equal(JSON.stringify(body).includes('signed'), false);
    const stored = fake.db.applications.find(a => a.id === id);
    assert.equal(stored.meta.docs.length, 1);
    assert.equal(String(stored.meta.docs[0].path).startsWith('applications/' + id + '/'), true);
    assert.equal(String(stored.meta.docs[0].path).includes('http'), false);
    assert.equal(fake.writes('storage', 'POST').length, 1);
    assert.equal(fake.db.q1_borrowers.length, before);
  });

  test('remaining schedule keeps every stored date and does not invent one', () => {
    const open = accountFromLoans([{
      id: 'l_sched', ref: 'ECL-1', principal: 1000, status: 'issued', deleted_at: null,
      schedule: ['2026-12-25', '2026-11-25', '2027-01-25'], instalments_paid: 2, instalment_amount: 300
    }]);
    assert.deepEqual(open.loans[0].schedule, ['2026-11-25', '2026-12-25', '2027-01-25']);
    assert.equal(open.next_due, '2026-11-25');
    const overdue = accountFromLoans([{
      id: 'l_over', ref: 'ECL-2', principal: 400, status: 'overdue', deleted_at: null,
      schedule: [], instalments_paid: 4
    }]);
    assert.equal(overdue.next_due, null);
    assert.deepEqual(overdue.loans[0].schedule, []);
    const past = accountFromLoans([{
      id: 'l_past', ref: 'ECL-3', principal: 400, status: 'overdue', deleted_at: null,
      schedule: ['2026-01-15'], instalments_paid: 1
    }]);
    assert.deepEqual(past.loans[0].schedule, ['2026-01-15']);
    assert.equal(past.next_due, '2026-01-15');
  });

  test('staff can view one client on a preview host, and production stays closed', async () => {
    delete process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT;
    delete process.env.VERCEL_ENV;
    const hidden = await call(quik1, {
      method: 'GET', path: ['preview'], headers: { authorization: 'Bearer ' + STAFF }
    });
    assert.equal(hidden.statusCode, 404);

    process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT = '1';
    process.env.VERCEL_ENV = 'production';
    const prod = await call(quik1, {
      method: 'GET', path: ['preview'],
      headers: { authorization: 'Bearer ' + STAFF, host: 'quik1.app' }
    });
    assert.equal(prod.statusCode, 404);
    delete process.env.VERCEL_ENV;

    const anon = await call(quik1, {
      method: 'GET', path: ['preview'], headers: { host: 'preview.example' }
    });
    assert.equal(anon.statusCode, 401);
    assert.equal(JSON.stringify(anon.json()).includes('service-role'), false);

    const list = await call(quik1, {
      method: 'GET', path: ['preview'],
      headers: { authorization: 'Bearer ' + STAFF, host: 'preview.example' }
    });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().enabled, true);
    assert.equal(list.json().clients.some(c => c.id === CLIENT_A && c.name === NAME_A), true);
    assert.equal(JSON.stringify(list.json()).includes('service-role'), false);

    const book = await call(quik1, {
      method: 'GET', path: ['preview', CLIENT_A],
      headers: { authorization: 'Bearer ' + STAFF, host: 'preview.example' }
    });
    assert.equal(book.statusCode, 200);
    assert.equal(book.json().profile.name, NAME_A);
    const loan = book.json().account.loans.find(l => l.ref === REF_A);
    assert.deepEqual(loan.schedule, ['2026-11-25', '2026-12-25']);
    assert.equal(book.json().account.next_due, '2026-11-25');
    assert.equal(JSON.stringify(book.json()).includes(REF_B), false);
    assert.equal(JSON.stringify(book.json()).includes(NAME_B), false);

    const liveHost = await call(quik1, {
      method: 'GET', path: ['preview', CLIENT_A],
      headers: { authorization: 'Bearer ' + STAFF, host: 'quik1.app' }
    });
    assert.equal(liveHost.statusCode, 404);
    delete process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT;
  });

  function tableOf(url) {
    const path = String(url).split('?')[0];
    return decodeURIComponent(path.split('/').pop());
  }

  function postgrest(status, body, headers = {}) {
    const text = body === '' || body === undefined ? '' : JSON.stringify(body);
    return { ok: status < 400, status, headers: new Headers(headers), text: async () => text };
  }

  function relationError(code, table) {
    const message = code === 'PGRST205'
      ? `Could not find the table 'public.${table}' in the schema cache`
      : `relation "public.${table}" does not exist`;
    return postgrest(404, { code, message, details: null, hint: null });
  }

  test('quik1-feed is empty messages when q1_messages is missing, and other database errors still fail', async () => {
    const application = {
      id: 'ap_feed', ref: 'AP-1085', name: 'Feed Applicant', amount: 100, purpose: 'Fees',
      status: 'new', source: 'quik1', client_id: null, created_at: '2026-11-10T06:00:00.000Z'
    };
    for (const code of ['PGRST205', '42P01']) {
      globalThis.fetch = async (url) => {
        const table = tableOf(url);
        if (table === 'q1_messages') return relationError(code, table);
        if (table === 'applications') return postgrest(200, [application]);
        return postgrest(200, []);
      };
      const res = await call(ledger, {
        method: 'GET', path: ['quik1-feed'],
        headers: { authorization: 'Bearer ' + STAFF, host: 'quik1ledger.com' }
      });
      assert.equal(res.statusCode, 200, code + ' ' + res.body);
      assert.deepEqual(res.json().threads, []);
      assert.equal(res.json().applications.length, 1);
      assert.equal(res.json().applications[0].extId, 'ap_feed');
      assert.equal(JSON.stringify(res.json()).includes('schema cache'), false);
    }

    globalThis.fetch = async (url) => {
      const table = tableOf(url);
      if (table === 'q1_messages') return postgrest(500, { code: 'XX000', message: 'secret internals' });
      return postgrest(200, []);
    };
    const failed = await call(ledger, {
      method: 'GET', path: ['quik1-feed'], headers: { authorization: 'Bearer ' + STAFF }
    });
    assert.equal(failed.statusCode, 502);
    assert.deepEqual(failed.json(), { error: 'Database error XX000' });

    globalThis.fetch = async (url) => {
      const table = tableOf(url);
      if (table === 'q1_messages') return postgrest(400, { code: 'PGRST204', message: "Could not find the 'body' column of 'q1_messages' in the schema cache" });
      return postgrest(200, [application]);
    };
    const column = await call(ledger, {
      method: 'GET', path: ['quik1-feed'], headers: { authorization: 'Bearer ' + STAFF }
    });
    assert.equal(column.statusCode, 502);
    assert.deepEqual(column.json(), { error: 'Database error PGRST204' });
  });

  test('a missing session table is signed out, and a real session error still fails', async () => {
    const stale = mintBorrowerToken({ sid: 'qs_missing', bid: 'qb_missing', cid: CLIENT_A });
    const headers = { cookie: 'q1_session=' + encodeURIComponent(stale.token) };
    const leak = [{ id: LOAN_A, ref: 'ECL-LEAK', client_id: CLIENT_A, name: NAME_A, principal: 500, status: 'issued', deleted_at: null }];
    for (const code of ['PGRST205', '42P01']) {
      globalThis.fetch = async (url) => {
        const table = tableOf(url);
        if (table === 'q1_sessions' || table === 'q1_borrowers') return relationError(code, table);
        return postgrest(200, leak, { 'content-range': '0-0/1' });
      };
      const loans = await call(quik1, { method: 'GET', path: ['loans'], headers });
      assert.equal(loans.statusCode, 401, code);
      assert.equal(JSON.stringify(loans.json()).includes('ECL-LEAK'), false);
      assert.equal(JSON.stringify(loans.json()).includes(NAME_A), false);
      const home = await call(quik1, { method: 'GET', path: ['me'], headers });
      assert.equal(home.statusCode, 200, code);
      assert.equal(home.json().identified, false);
      assert.equal(JSON.stringify(home.json()).includes('ECL-LEAK'), false);
      const posted = await call(quik1, {
        method: 'POST', path: ['withdrawals'], headers, body: { amount: 100, purpose: PURPOSE }
      });
      assert.equal(posted.statusCode, 401, code);
      assert.equal(posted.headers['set-cookie'], undefined);
    }

    globalThis.fetch = async (url) => {
      const table = tableOf(url);
      if (table === 'q1_sessions') return postgrest(500, { code: 'XX000', message: 'secret internals' });
      return postgrest(200, leak, { 'content-range': '0-0/1' });
    };
    const down = await call(quik1, { method: 'GET', path: ['loans'], headers });
    assert.equal(down.statusCode, 502);
    assert.deepEqual(down.json(), { error: 'Database error XX000' });
    const homeDown = await call(quik1, { method: 'GET', path: ['me'], headers });
    assert.equal(homeDown.statusCode, 502);
    assert.equal(JSON.stringify(homeDown.json()).includes('ECL-LEAK'), false);
  });

  test('signed-in messages are empty when q1_messages is absent, and a reply is not stored', async () => {
    const cookieA = await signIn(CLIENT_A, PIN_A);
    delete fake.db.q1_messages;
    const absent = await call(quik1, { method: 'GET', path: ['messages'], headers: { cookie: cookieA } });
    assert.equal(absent.statusCode, 200);
    assert.deepEqual(absent.json().messages, []);
    fake.reset();

    const cookie = await signIn(CLIENT_A, PIN_A);
    const installed = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const table = tableOf(url);
      if (table === 'q1_messages') return relationError('PGRST205', table);
      return installed(url, init);
    };
    const msgs = await call(quik1, { method: 'GET', path: ['messages'], headers: { cookie } });
    assert.equal(msgs.statusCode, 200);
    assert.deepEqual(msgs.json().messages, []);
    const loans = await call(quik1, { method: 'GET', path: ['loans'], headers: { cookie } });
    assert.equal(loans.statusCode, 200);
    assert.equal(loans.json().loans.some(l => l.ref === REF_A), true);

    const reply = await call(ledger, {
      method: 'POST', path: ['quik1-messages'],
      headers: { authorization: 'Bearer ' + STAFF },
      body: { clientId: CLIENT_A, body: REPLY }
    });
    assert.equal(reply.statusCode, 502);
    assert.equal(reply.json().error, 'Database error PGRST205');
    assert.equal(JSON.stringify(reply.json()).includes(REPLY), false);
  });

  test('login and redeem do not open a session when auth tables are missing', async () => {
    for (const code of ['PGRST205', '42P01']) {
      globalThis.fetch = async (url) => relationError(code, tableOf(url));
      const login = await call(quik1, {
        method: 'POST', path: ['login'],
        body: { accountRef: 'qb_' + 'ab'.repeat(16), pin: PIN_A }
      });
      assert.equal(login.statusCode, 401, code);
      assert.equal(login.json().error, 'PIN not accepted');
      assert.equal(login.headers['set-cookie'], undefined);

      const redeemed = await call(quik1, {
        method: 'POST', path: ['invites', 'redeem'],
        body: { code: 'a'.repeat(64), pin: PIN_A, pinConfirm: PIN_A }
      });
      assert.equal(redeemed.statusCode, 503, code);
      assert.equal(redeemed.json().error, 'Quik1 access not set up yet');
      assert.equal(redeemed.headers['set-cookie'], undefined);

      const stale = mintBorrowerToken({ sid: 'qs_out', bid: 'qb_out', cid: CLIENT_A });
      const out = await call(quik1, {
        method: 'POST', path: ['logout'],
        headers: { cookie: 'q1_session=' + encodeURIComponent(stale.token) }
      });
      assert.equal(out.statusCode, 200, code);
      assert.match(String(out.headers['set-cookie']), /q1_session=/);
      assert.match(String(out.headers['set-cookie']), /Max-Age=0/);

      const revoked = await call(ledger, {
        method: 'POST', path: ['quik1-invites', 'qi_missing', 'revoke'],
        headers: { authorization: 'Bearer ' + STAFF }
      });
      assert.equal(revoked.statusCode, 503, code);
      assert.equal(revoked.json().error, 'Quik1 access not set up yet');
      assert.equal(revoked.json().ok, undefined);
    }
  });
});
