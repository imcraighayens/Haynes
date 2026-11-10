// Ledger ID and bank-detail encryption: round trip, AAD, masks, duplicate HMAC,
// backfill dry-run versus commit, and fail-closed writes.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSealed } from '../../api/_lib/field-seal.js';
import { idHmac } from '../../api/_lib/sa-id.js';
import {
  BACKFILL_TARGETS,
  accountHmac,
  decryptClientAccount,
  decryptClientId,
  decryptStored,
  maskAccount,
  presentLedgerRow,
  sealWrite
} from '../../api/_lib/ledger-secrets.js';
import { runBackfill } from '../../scripts/backfill-ledger-secrets.js';

const ID = '9912314800084';
const OTHER_ID = '7511126083186';
const ACCOUNT = '62379002802';
const ID_KEY = 'ab'.repeat(32);
const ID_PREV = 'cd'.repeat(32);
const HMAC = 'ef'.repeat(32);
const BANK = '12'.repeat(32);
const BANK_PREV = '34'.repeat(32);
const BANK_HMAC = '56'.repeat(32);
const LEDGER_KEY = 'ledger-test-key-0123456789abcdef';

function setKeys() {
  process.env.QUIK1_ID_KEY = ID_KEY;
  process.env.QUIK1_ID_KEY_PREVIOUS = '';
  process.env.QUIK1_ID_HMAC_KEY = HMAC;
  process.env.QUIK1_BANK_KEY = BANK;
  process.env.QUIK1_BANK_KEY_PREVIOUS = '';
  process.env.QUIK1_BANK_HMAC_KEY = BANK_HMAC;
}

function clearKeys() {
  for (const name of [
    'QUIK1_ID_KEY', 'QUIK1_ID_KEY_PREVIOUS', 'QUIK1_ID_HMAC_KEY',
    'QUIK1_BANK_KEY', 'QUIK1_BANK_KEY_PREVIOUS', 'QUIK1_BANK_HMAC_KEY'
  ]) delete process.env[name];
}

afterEach(() => { clearKeys(); });

test('round trip, AAD mismatch, mask format, and duplicate-ID HMAC', () => {
  setKeys();
  const row = sealWrite('clients', { id: 'c1', name: 'A', id_number: '991231 4800084', account_no: '62 379 002 802' });
  assert.equal(row.id_number, null);
  assert.equal(row.account_no, null);
  assert.equal(row.name, 'A');
  assert.match(row.id_ciphertext, /^v1\./);
  assert.match(row.account_ciphertext, /^v1\./);
  assert.equal(row.id_ciphertext.includes(ID), false);
  assert.equal(row.account_ciphertext.includes(ACCOUNT), false);
  assert.equal(decryptClientId(row.id_ciphertext, 'c1'), ID);
  assert.equal(decryptClientAccount(row.account_ciphertext, 'c1'), ACCOUNT);
  assert.equal(decryptClientId(row.id_ciphertext, 'c2'), '');
  assert.equal(decryptClientAccount(row.account_ciphertext, 'someone-else'), '');
  assert.equal(row.id_last4, '0084');
  assert.equal(row.account_last4, '2802');
  assert.equal(maskAccount(ACCOUNT), '******2802');

  const again = sealWrite('clients', { id: 'c9', id_number: ID });
  assert.equal(again.id_hmac, row.id_hmac);
  assert.equal(again.id_hmac, idHmac(ID));
  assert.notEqual(again.id_ciphertext, row.id_ciphertext);
  assert.notEqual(again.id_hmac, createHash('sha256').update(ID).digest('hex'));
  assert.notEqual(sealWrite('clients', { id: 'c3', id_number: OTHER_ID }).id_hmac, row.id_hmac);
  assert.equal(row.account_hmac, accountHmac(ACCOUNT));
  assert.match(row.account_hmac, /^[0-9a-f]{64}$/);

  process.env.QUIK1_ID_KEY = ID_PREV;
  process.env.QUIK1_ID_KEY_PREVIOUS = ID_KEY;
  process.env.QUIK1_BANK_KEY = BANK_PREV;
  process.env.QUIK1_BANK_KEY_PREVIOUS = BANK;
  assert.equal(decryptClientId(row.id_ciphertext, 'c1'), ID);
  assert.equal(decryptClientAccount(row.account_ciphertext, 'c1'), ACCOUNT);
  delete process.env.QUIK1_ID_KEY_PREVIOUS;
  delete process.env.QUIK1_BANK_KEY_PREVIOUS;
  assert.equal(decryptClientId(row.id_ciphertext, 'c1'), '');
  assert.equal(decryptClientAccount(row.account_ciphertext, 'c1'), '');
});

test('reads mask by default and staff reveal needs the key', () => {
  setKeys();
  const sealed = sealWrite('clients', { id: 'c1', id_number: ID, account_no: ACCOUNT, name: 'A' });
  const stored = { ...sealed, id_number: ID, account_no: ACCOUNT };
  const masked = presentLedgerRow('clients', stored);
  assert.equal(masked.id_number, '*********0084');
  assert.equal(masked.account_no, '******2802');
  assert.equal(JSON.stringify(masked).includes(ID), false);
  assert.equal(JSON.stringify(masked).includes(ACCOUNT), false);
  assert.equal(masked.id_ciphertext, undefined);
  assert.equal(masked.account_hmac, undefined);

  const revealed = presentLedgerRow('clients', sealed, { reveal: true });
  assert.equal(revealed.id_number, ID);
  assert.equal(revealed.account_no, ACCOUNT);
  assert.equal(revealed.id_ciphertext, undefined);
  assert.equal(JSON.stringify(revealed).includes(sealed.id_ciphertext), false);

  clearKeys();
  const stillMasked = presentLedgerRow('clients', stored);
  assert.equal(stillMasked.id_number, '*********0084');
  assert.equal(JSON.stringify(stillMasked).includes(ID), false);
  assert.throws(() => presentLedgerRow('clients', stored, { reveal: true }), err => err.status === 503 && err.message === 'ID storage is not configured');
});

test('writes fail closed when the keys are unset and a mask is not stored as the secret', () => {
  clearKeys();
  assert.throws(
    () => sealWrite('clients', { id: 'c1', id_number: ID }),
    err => err.status === 503 && err.message === 'ID storage is not configured' && !String(err.message).includes(ID)
  );
  assert.throws(
    () => sealWrite('clients', { id: 'c1', account_no: ACCOUNT }),
    err => err.status === 503 && err.message === 'Bank storage is not configured'
  );
  setKeys();
  const echo = sealWrite('clients', { id: 'c1', name: 'A', id_number: '*********0084', account_no: '******2802' });
  assert.equal('id_number' in echo, false);
  assert.equal('account_no' in echo, false);
  assert.equal('id_ciphertext' in echo, false);
  assert.equal(echo.name, 'A');
  const cleared = sealWrite('clients', { id: 'c1', id_number: '—', account_no: null });
  assert.equal(cleared.id_number, null);
  assert.equal(cleared.id_ciphertext, null);
  assert.equal(cleared.account_hmac, null);
});

function memoryDb(seed) {
  const tables = new Map();
  for (const [key, rows] of Object.entries(seed)) tables.set(key, rows.map(row => ({ ...row })));
  const patches = [];
  const lists = [];
  return {
    patches,
    lists,
    rows(schema, table) { return tables.get(schema + '.' + table) || []; },
    async list(target, { after, limit }) {
      lists.push({ schema: target.schema, table: target.table, after, limit });
      if (target.schema === 'loop') {
        const err = new Error('missing');
        err.code = '42P01';
        throw err;
      }
      const key = target.schema + '.' + target.table;
      const pending = (tables.get(key) || []).filter(row => {
        if (after && String(row.id) <= String(after)) return false;
        return target.fields.some(field => row[field.column] != null && String(row[field.column]).trim() !== '');
      }).sort((a, b) => String(a.id) < String(b.id) ? -1 : 1);
      return pending.slice(0, limit).map(row => ({ ...row }));
    },
    async patch(target, id, patch) {
      patches.push({ schema: target.schema, table: target.table, id, patch: { ...patch } });
      const row = (tables.get(target.schema + '.' + target.table) || []).find(item => item.id === id);
      if (row) Object.assign(row, patch);
    }
  };
}

function sampleRows() {
  return {
    'public.clients': [
      { id: 'c1', id_number: ID, account_no: ACCOUNT, id_hmac: null },
      { id: 'c2', account_no: 'not-an-account' },
      { id: 'c3', id_number: OTHER_ID, id_hmac: 'already-stamped-by-37' },
      { id: 'c0', name: 'already', id_number: null, id_ciphertext: 'v1.already.sealed.value' }
    ],
    'public.applications': [
      { id: 'ap1', id_number: ID }
    ],
    'public.q1_signups': [],
    'quik1.applications': [
      { id: '11111111-1111-1111-1111-111111111111', id_number: OTHER_ID, bank_account_no: '1488501066' }
    ]
  };
}

test('backfill dry-run writes nothing and commit seals then nulls plaintext', async () => {
  setKeys();
  const dryDb = memoryDb(sampleRows());
  const dry = await runBackfill({ db: dryDb, commit: false, batchSize: 1 });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.commit, false);
  assert.equal(dry.wrote, 0);
  assert.equal(dryDb.patches.length, 0);
  assert.equal(dryDb.rows('public', 'clients').find(row => row.id === 'c1').id_number, ID);
  assert.equal(JSON.stringify(dry).includes(ID), false);
  assert.equal(JSON.stringify(dry).includes(ACCOUNT), false);
  const clientLists = dryDb.lists.filter(call => call.schema === 'public' && call.table === 'clients');
  assert.ok(clientLists.length >= 2, 'clients are paged');
  assert.equal(clientLists[0].limit, 1);
  const clients = dry.tables.find(table => table.schema === 'public' && table.table === 'clients');
  assert.equal(clients.ids, 2);
  assert.equal(clients.accounts, 1);
  assert.equal(clients.skipped, 1);
  assert.equal(dry.tables.find(table => table.schema === 'loop').missing, true);

  const db = memoryDb(sampleRows());
  const committed = await runBackfill({ db, commit: true, batchSize: 50 });
  assert.equal(committed.commit, true);
  assert.equal(committed.dryRun, false);
  assert.ok(committed.wrote >= 3);
  const c1 = db.rows('public', 'clients').find(row => row.id === 'c1');
  assert.equal(c1.id_number, null);
  assert.equal(c1.account_no, null);
  assert.equal(decryptClientId(c1.id_ciphertext, 'c1'), ID);
  assert.equal(decryptClientAccount(c1.account_ciphertext, 'c1'), ACCOUNT);
  assert.equal(c1.id_hmac, idHmac(ID));
  assert.equal(c1.id_last4, '0084');
  const c3 = db.rows('public', 'clients').find(row => row.id === 'c3');
  assert.equal(c3.id_number, null);
  assert.equal(c3.id_hmac, 'already-stamped-by-37');
  assert.equal(db.patches.find(patch => patch.id === 'c3').patch.id_hmac, undefined);
  assert.equal(c1.account_last4, '2802');
  const c2 = db.rows('public', 'clients').find(row => row.id === 'c2');
  assert.equal(c2.account_no, 'not-an-account');
  assert.equal(c2.account_ciphertext, undefined);
  const app = db.rows('public', 'applications')[0];
  assert.equal(app.id_number, null);
  assert.equal(decryptStored('applications', 'id', app.id_ciphertext, 'ap1'), ID);
  const q1 = db.rows('quik1', 'applications')[0];
  assert.equal(q1.id_number, null);
  assert.equal(q1.bank_account_no, null);
  assert.equal(openSealed(q1.id_ciphertext, 'quik1-application:' + q1.id, [Buffer.from(ID_KEY, 'hex')]), OTHER_ID);
  assert.equal(openSealed(q1.bank_account_ciphertext, 'quik1-application:' + q1.id, [Buffer.from(BANK, 'hex')]), '1488501066');
  assert.equal(q1.bank_last4, '1066');
  const already = db.rows('public', 'clients').find(row => row.id === 'c0');
  assert.equal(already.id_ciphertext, 'v1.already.sealed.value');
  assert.equal(db.patches.some(patch => patch.id === 'c0'), false);

  const secondDbPatches = db.patches.length;
  const again = await runBackfill({ db, commit: true, batchSize: 50 });
  assert.equal(again.wrote, 0);
  assert.equal(db.patches.length, secondDbPatches);
  assert.equal(BACKFILL_TARGETS.some(target => target.schema === 'quik1' && target.table === 'applications'), true);
});

test('backfill refuses to start when a key is missing', async () => {
  clearKeys();
  process.env.QUIK1_ID_KEY = ID_KEY;
  process.env.QUIK1_ID_HMAC_KEY = HMAC;
  let listed = 0;
  const db = {
    async list() { listed += 1; return []; },
    async patch() { throw new Error('patch'); }
  };
  await assert.rejects(
    () => runBackfill({ db, commit: true }),
    err => err.status === 503 && err.message === 'Bank storage is not configured'
  );
  assert.equal(listed, 0);
  clearKeys();
  await assert.rejects(
    () => runBackfill({ db, commit: false }),
    err => err.status === 503 && /not configured/.test(err.message)
  );
  assert.equal(listed, 0);
});

function jsonResponse(body, status = 200) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok: status < 400,
    status,
    headers: new Headers(),
    text: async () => text,
    json: async () => JSON.parse(text || 'null')
  };
}

test('staff book decrypts and a write stores ciphertext, or 503 when unset', async () => {
  process.env.SUPABASE_URL = 'https://db.test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
  process.env.LEDGER_KEY = LEDGER_KEY;
  const handler = (await import('../../api/ledger.js')).default;
  const calls = [];
  function makeRes() {
    const res = {
      statusCode: 0, headers: {}, body: '', headersSent: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(s) { this.body = s == null ? '' : s; this.headersSent = true; }
    };
    res.json = () => (res.body ? JSON.parse(res.body) : undefined);
    return res;
  }
  async function call(method, path, body) {
    const req = {
      method,
      query: { path },
      url: '/api/ledger/' + path.join('/'),
      headers: { authorization: 'Bearer ' + LEDGER_KEY },
      body
    };
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  clearKeys();
  globalThis.fetch = async (url) => {
    const table = new URL(String(url)).pathname.split('/').pop();
    if (table === 'clients') return jsonResponse([{ id: 'c1', name: 'A', id_number: ID, account_no: ACCOUNT }]);
    if (table === 'settings' || table === 'ledger_book') return jsonResponse([]);
    return jsonResponse([]);
  };
  const blocked = await call('GET', ['state']);
  assert.equal(blocked.statusCode, 503);
  assert.equal(blocked.json().error, 'ID storage is not configured');
  assert.equal(blocked.body.includes(ID), false);
  assert.equal(blocked.body.includes(ACCOUNT), false);

  setKeys();
  const sealed = sealWrite('clients', { id: 'c1', id_number: ID, account_no: ACCOUNT, name: 'A' });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const table = u.pathname.split('/').pop();
    calls.push({ method: init.method || 'GET', table, body: init.body ? JSON.parse(init.body) : null });
    if ((init.method || 'GET') === 'GET') {
      if (table === 'clients') return jsonResponse([sealed]);
      return jsonResponse([]);
    }
    return jsonResponse(init.body ? JSON.parse(init.body) : []);
  };
  const opened = await call('GET', ['state']);
  assert.equal(opened.statusCode, 200, opened.body);
  const client = opened.json().clients[0];
  assert.equal(client.id_number, ID);
  assert.equal(client.account_no, ACCOUNT);
  assert.equal(client.id_ciphertext, undefined);
  assert.equal(opened.body.includes(sealed.id_ciphertext), false);

  calls.length = 0;
  const saved = await call('POST', ['sync'], { ops: [{ table: 'clients', op: 'upsert', rows: [{ id: 'c1', ref: 'EC-1', name: 'A', id_number: ID, account_no: ACCOUNT }] }] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().ok, true);
  const write = calls.find(item => item.method === 'POST' && item.table === 'clients');
  assert.equal(write.body[0].id_number, null);
  assert.equal(write.body[0].account_no, null);
  assert.equal(decryptClientId(write.body[0].id_ciphertext, 'c1'), ID);
  assert.equal(decryptClientAccount(write.body[0].account_ciphertext, 'c1'), ACCOUNT);
  assert.equal(JSON.stringify(saved.json()).includes(ID), false);

  clearKeys();
  const refused = await call('POST', ['sync'], { ops: [{ table: 'clients', op: 'upsert', rows: [{ id: 'c2', ref: 'EC-2', name: 'B', id_number: ID }] }] });
  assert.equal(refused.statusCode, 200);
  assert.equal(refused.json().ok, false);
  assert.equal(refused.json().results[0].error, 'ID storage is not configured');
  assert.equal(refused.json().results[0].retryable, false);
  assert.equal(refused.body.includes(ID), false);
});
