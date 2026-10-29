// node --test tests/fake-postgrest.test.js — the in-memory PostgREST used by tools/mock-api.js
// must honour exactly the request shapes api/_lib/supabase.js sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakePostgrest, install } from '../tools/fake-postgrest.js';

const seed = {
  loans: [
    { id: 'l1', ref: 'ECL-1', status: 'issued', created_at: '2026-01-02T00:00:00Z', deleted_at: null },
    { id: 'l2', ref: 'ECL-2', status: 'paid', created_at: '2026-01-01T00:00:00Z', deleted_at: null }
  ],
  settings: [{ id: 'org', org_name: 'Test', ncr_reg_no: 'NCRCP0000' }],
  audit_log: []
};
const BASE = 'http://fake.local';
async function call(fake, method, path, { body, prefer } = {}) {
  const res = await fake.handle(BASE + path, { method, headers: { Prefer: prefer || '', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

test('select: filters, order, limit, projection and count=exact', async () => {
  const f = createFakePostgrest(seed);
  let r = await call(f, 'GET', '/rest/v1/loans?select=*&order=created_at.asc');
  assert.deepEqual(r.body.map(x => x.id), ['l2', 'l1']);
  r = await call(f, 'GET', '/rest/v1/loans?select=id,ref&status=eq.paid');
  assert.deepEqual(r.body, [{ id: 'l2', ref: 'ECL-2' }]);
  r = await call(f, 'GET', '/rest/v1/loans?select=id&limit=1', { prefer: 'count=exact' });
  assert.equal(r.body.length, 1);
  assert.match(r.headers.get('content-range'), /\/2$/);
  r = await call(f, 'GET', '/rest/v1/nope?select=*');
  assert.equal(r.status, 404); assert.equal(r.body.code, '42P01');
});

test('insert vs upsert: duplicates 409, merge keeps unsent columns, ignore-duplicates is a no-op', async () => {
  const f = createFakePostgrest(seed);
  let r = await call(f, 'POST', '/rest/v1/loans', { body: [{ id: 'l1', ref: 'X' }], prefer: 'return=representation' });
  assert.equal(r.status, 409); assert.equal(r.body.code, '23505');
  r = await call(f, 'POST', '/rest/v1/settings?on_conflict=id', { body: [{ id: 'org', org_name: 'Renamed' }], prefer: 'resolution=merge-duplicates,return=representation' });
  assert.equal(r.status, 201);
  assert.equal(f.find('settings', 'org').org_name, 'Renamed');
  assert.equal(f.find('settings', 'org').ncr_reg_no, 'NCRCP0000', 'columns absent from the payload survive a merge');
  r = await call(f, 'POST', '/rest/v1/loans?on_conflict=id', { body: [{ id: 'l1', ref: 'IGNORED' }, { id: 'l3', ref: 'ECL-3' }], prefer: 'resolution=ignore-duplicates,return=minimal' });
  assert.equal(r.status, 201); assert.equal(r.body, null);
  assert.equal(f.find('loans', 'l1').ref, 'ECL-1');
  assert.equal(f.find('loans', 'l3').ref, 'ECL-3');
  assert.ok(f.find('loans', 'l3').created_at, 'inserted rows get a created_at default');
  assert.equal(f.writes('loans', 'POST').length, 1, 'the refused insert is not logged as a write');
});

test('live NOT NULL columns are enforced like PostgREST does (loans.principal_derived → 23502)', async () => {
  const f = createFakePostgrest(seed);
  let r = await call(f, 'POST', '/rest/v1/loans?on_conflict=id', { body: [{ id: 'l1', principal_derived: null }], prefer: 'resolution=merge-duplicates,return=representation' });
  assert.equal(r.status, 400); assert.equal(r.body.code, '23502');
  r = await call(f, 'PATCH', '/rest/v1/loans?id=eq.l1', { body: { principal_derived: null }, prefer: 'return=representation' });
  assert.equal(r.status, 400); assert.equal(r.body.code, '23502');
  r = await call(f, 'POST', '/rest/v1/loans?on_conflict=id', { body: [{ id: 'l1', status: 'overdue' }], prefer: 'resolution=merge-duplicates,return=representation' });
  assert.equal(r.status, 201, 'omitting the column is fine (stored value stands)');
  assert.equal(f.find('loans', 'l1').status, 'overdue');
});

test('patch updates matching rows and delete is refused', async () => {
  const f = createFakePostgrest(seed);
  let r = await call(f, 'PATCH', '/rest/v1/loans?id=eq.l1', { body: { deleted_at: '2026-10-29T00:00:00Z' }, prefer: 'return=representation' });
  assert.equal(r.status, 200); assert.equal(r.body.length, 1); assert.equal(r.body[0].deleted_at, '2026-10-29T00:00:00Z');
  r = await call(f, 'PATCH', '/rest/v1/loans?id=eq.missing', { body: { status: 'paid' }, prefer: 'return=representation' });
  assert.deepEqual(r.body, []);
  r = await call(f, 'DELETE', '/rest/v1/loans?id=eq.l1');
  assert.equal(r.status, 405);
  assert.equal(f.table('loans').length, 2);
  f.reset();
  assert.equal(f.find('loans', 'l1').deleted_at, null, 'reset restores the seed');
  assert.equal(f.log.length, 0);
});

test('install() routes only the fake base URL through the fake', async () => {
  const f = createFakePostgrest(seed);
  const prev = globalThis.fetch;
  globalThis.fetch = async () => new Response('real', { status: 200 });
  const uninstall = install(f, BASE);
  try {
    const a = await fetch(BASE + '/rest/v1/loans?select=id');
    assert.equal((await a.json()).length, 2);
    const b = await fetch('http://elsewhere.local/x');
    assert.equal(await b.text(), 'real');
  } finally { uninstall(); globalThis.fetch = prev; }
});
