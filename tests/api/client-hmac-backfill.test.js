// Client HMAC backfill: counts only, dry-run unless --commit, and no key means stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakePostgrest, install } from '../../tools/fake-postgrest.js';
import { idHmac, phoneHmac, luhnOk } from '../../api/_lib/sa-id.js';
import { planHmacBackfill, formatCounts, runBackfill } from '../../scripts/backfill-client-hmac.js';

const HMAC_KEY = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const URL = 'http://fake-postgrest.local';
const CLIENT_ID = 'c_backfill_secret_row';
const PHONE = '0825550199';

function syntheticId() {
  const body = '880101480008';
  for (let check = 0; check <= 9; check++) {
    const id = body + String(check);
    if (luhnOk(id)) return id;
  }
  throw new Error('no synthetic id');
}
const SA_ID = syntheticId();

test('the backfill refuses to run without QUIK1_ID_HMAC_KEY', () => {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/backfill-client-hmac.js');
  const env = { ...process.env, QUIK1_ID_HMAC_KEY: '' };
  delete env.QUIK1_ID_HMAC_KEY;
  const run = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  const output = (run.stdout || '') + (run.stderr || '');
  assert.match(output, /QUIK1_ID_HMAC_KEY is required/);
  assert.equal(output.includes(HMAC_KEY), false);
  assert.equal(output.includes(SA_ID), false);
  assert.equal(output.includes(CLIENT_ID), false);
});

test('a dry-run prints counts only and does not write', async () => {
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
  const idMac = idHmac(SA_ID);
  const phoneMac = phoneHmac(PHONE);
  const fake = createFakePostgrest({
    clients: [
      { id: CLIENT_ID, id_number: SA_ID, phone: PHONE, id_hmac: null, phone_hmac: null, deleted_at: null },
      { id: 'c_blank', id_number: '', phone: '', id_hmac: null, phone_hmac: null, deleted_at: null },
      { id: 'c_bad', id_number: '12345', phone: '12', id_hmac: null, phone_hmac: null, deleted_at: null },
      { id: 'c_gone', id_number: SA_ID, phone: PHONE, deleted_at: '2026-01-01T00:00:00Z' }
    ]
  });
  const restore = install(fake, URL);
  const lines = [];
  try {
    const code = await runBackfill({ commit: false, log: line => lines.push(line), err: line => lines.push(line) });
    assert.equal(code, 0);
    const text = lines.join('\n');
    const expected = planHmacBackfill(fake.db.clients);
    assert.equal(text, formatCounts(expected.counts));
    assert.match(text, /rows scanned: 4/);
    assert.match(text, /id_hmac: 1/);
    assert.match(text, /phone_hmac: 1/);
    assert.match(text, /skipped: 2/);
    assert.match(text, /invalid: 1/);
    assert.equal(text.includes(SA_ID), false);
    assert.equal(text.includes(PHONE), false);
    assert.equal(text.includes(CLIENT_ID), false);
    assert.equal(text.includes(idMac), false);
    assert.equal(text.includes(phoneMac), false);
    assert.equal(fake.db.clients[0].id_hmac, null);
    assert.equal(fake.db.clients[0].phone_hmac, null);
  } finally {
    restore();
    delete process.env.QUIK1_ID_HMAC_KEY;
  }
});

test('commit writes both HMACs and still prints no values', async () => {
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.QUIK1_ID_HMAC_KEY = HMAC_KEY;
  const fake = createFakePostgrest({
    clients: [
      { id: CLIENT_ID, id_number: SA_ID, phone: PHONE, id_hmac: null, phone_hmac: null, deleted_at: null }
    ]
  });
  const restore = install(fake, URL);
  const lines = [];
  try {
    const code = await runBackfill({ commit: true, log: line => lines.push(line), err: line => lines.push(line) });
    assert.equal(code, 0);
    const text = lines.join('\n');
    assert.equal(text.includes(SA_ID), false);
    assert.equal(text.includes(CLIENT_ID), false);
    assert.equal(fake.db.clients[0].id_hmac, idHmac(SA_ID));
    assert.equal(fake.db.clients[0].phone_hmac, phoneHmac(PHONE));
  } finally {
    restore();
    delete process.env.QUIK1_ID_HMAC_KEY;
  }
});
