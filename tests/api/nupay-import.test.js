// Staff NuPay client-list import: dry-run, whitelist, dedupe on the NuPay
// reference, loans only when the file has loan columns, and no ID or phone
// in the response. Figures below are obviously fake.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';

const STAFF = 'ledger-test-key';
const URL = 'http://fake-postgrest.local';
const FAKE_ID = 'FAKEID';
const FAKE_PHONE = '0000000000';
const SECRET_NOTE = 'do-not-keep';

process.env.SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.LEDGER_KEY = STAFF;

const seed = {
  clients: [
    { id: 'c_keep', ref: 'NP-KEEP', name: 'Kept Client', deleted_at: null }
  ],
  loans: [
    { id: 'l_other', ref: 'LN-TAKEN', client_id: 'c_keep', mandate_id: 'M-TAKEN', principal: 10, instalment_amount: 10, status: 'issued', schedule: ['2026-08-25'], deleted_at: null }
  ],
  audit_log: [],
  q1_invites: [],
  q1_borrowers: [],
  q1_sessions: []
};

const fake = createFakePostgrest(seed);
let restore = () => {};
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

async function call({ method = 'POST', path = ['nupay-clients'], headers = {}, body } = {}) {
  const req = {
    method,
    query: { path },
    url: '/api/ledger/' + path.join('/'),
    headers: { host: 'localhost', 'x-forwarded-proto': 'https', authorization: 'Bearer ' + STAFF, ...headers },
    body
  };
  const res = makeRes();
  await ledger(req, res);
  return res;
}

const CSV = [
  'NuPay reference,Name,ID number,Cell,Bank,Loan reference,Mandate ID,Principal,Instalment,Schedule,Instalments paid,Loan status,Mystery',
  'NP-100,Sample Client,' + FAKE_ID + ',' + FAKE_PHONE + ',Example Bank,LN-100,M-100,1000,250,2026-12-25|2027-01-25,1,issued,' + SECRET_NOTE,
  'NP-100,Sample Client,' + FAKE_ID + ',' + FAKE_PHONE + ',Example Bank,LN-200,M-200,400,200,2026-11-25,0,issued,' + SECRET_NOTE
].join('\n');

function assertPrivate(body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  assert.equal(text.includes(FAKE_ID), false);
  assert.equal(text.includes(FAKE_PHONE), false);
  assert.equal(text.includes(SECRET_NOTE), false);
}

beforeEach(() => {
  fake.reset();
  restore = install(fake, URL);
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.LEDGER_KEY = STAFF;
});
afterEach(() => { restore(); });

test('a signed-out request cannot import', async () => {
  const res = await call({ headers: { authorization: '' }, body: { csv: CSV, commit: false } });
  assert.equal(res.statusCode, 401);
  assert.equal(fake.db.clients.length, 1);
});

test('dry-run previews creates and does not write', async () => {
  const res = await call({ body: { csv: CSV, commit: false } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.committed, false);
  assert.equal(body.hasLoans, true);
  assert.equal(body.counts.clientsCreate, 1);
  assert.equal(body.counts.loansCreate, 2);
  assert.equal(body.preview[0].ref, 'NP-100');
  assert.equal(body.preview[0].name, 'Sample Client');
  assertPrivate(res.body);
  assert.equal(fake.db.clients.length, 1);
  assert.equal(fake.db.loans.length, 1);
});

test('commit dedupes on the NuPay reference, keeps every schedule date, and stays quiet about ID and phone', async () => {
  const res = await call({ body: { csv: CSV, commit: true } });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.committed, true);
  assertPrivate(res.body);
  const client = fake.db.clients.find(c => c.ref === 'NP-100');
  assert.ok(client);
  assert.equal(client.id, 'c_nupay_np_100');
  assert.equal(client.name, 'Sample Client');
  assert.equal(client.id_number, FAKE_ID);
  assert.equal(client.phone, FAKE_PHONE);
  assert.equal(client.bank, 'Example Bank');
  assert.equal(client.mystery, undefined);
  assert.equal(fake.db.clients.filter(c => c.ref === 'NP-100').length, 1);
  const open = fake.db.loans.find(l => l.ref === 'LN-100');
  assert.deepEqual(open.schedule, ['2026-12-25', '2027-01-25']);
  assert.equal(open.instalments_paid, 1);
  assert.equal(open.client_id, client.id);
  assert.equal(open.status, 'issued');
  const second = fake.db.loans.find(l => l.mandate_id === 'M-200');
  assert.equal(second.schedule[0], '2026-11-25');
  const audit = fake.db.audit_log[0];
  assert.equal(audit.type, 'NUPAY IMPORT');
  assertPrivate(JSON.stringify(audit));

  const again = await call({ body: { csv: CSV.replaceAll('Sample Client', 'Renamed Client'), commit: true } });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().counts.clientsUpdate, 1);
  assert.equal(again.json().counts.clientsCreate, 0);
  assert.equal(fake.db.clients.filter(c => c.ref === 'NP-100').length, 1);
  assert.equal(fake.db.clients.find(c => c.ref === 'NP-100').name, 'Renamed Client');
  assertPrivate(again.body);

  const invite = await call({ path: ['quik1-invites'], body: { clientId: client.id } });
  assert.equal(invite.statusCode, 201, invite.body);
  assert.equal(invite.json().clientRef, 'NP-100');
  assert.match(invite.json().link, /#invite=[0-9a-f]{64}$/);
  assertPrivate(invite.body);
});

test('a date that is not a date is refused and not invented', async () => {
  const csv = 'NuPay reference,Name,Loan reference,Principal,Instalment,Schedule\nNP-300,Sample Client,LN-300,100,50,25th\n';
  const dry = await call({ body: { csv, commit: false } });
  assert.equal(dry.statusCode, 200);
  assert.equal(dry.json().errors.some(e => /not a date/.test(e.message)), true);
  assert.equal(dry.json().counts.clientsCreate, 0);
  const commit = await call({ body: { csv, commit: true } });
  assert.equal(commit.statusCode, 400);
  assert.equal(commit.json().committed, false);
  assert.equal(fake.db.clients.some(c => c.ref === 'NP-300'), false);
  assert.equal(JSON.stringify(fake.db).includes('2026-'), true);
  assert.equal(JSON.stringify(fake.db.clients).includes('NP-300'), false);
});

test('a loan already on another client is not moved', async () => {
  const csv = 'NuPay reference,Name,Mandate ID,Principal,Instalment\nNP-400,Other Person,M-TAKEN,50,25\n';
  const res = await call({ body: { csv, commit: true } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().committed, false);
  assert.equal(fake.db.loans.find(l => l.mandate_id === 'M-TAKEN').client_id, 'c_keep');
  assert.equal(fake.db.clients.some(c => c.ref === 'NP-400'), false);
});

test('a file with no loan columns does not write a loan', async () => {
  const csv = 'NuPay reference,Name,Bank\nNP-500,Sample Client,Example Bank\n';
  const res = await call({ body: { csv, commit: true } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().hasLoans, false);
  assert.equal(res.json().counts.loansCreate, 0);
  assert.equal(fake.db.clients.some(c => c.ref === 'NP-500'), true);
  assert.equal(fake.db.loans.length, 1);
});
