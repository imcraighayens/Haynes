// node --test tests/ledjaa-db-empty.test.js
// No cloud state and no local cache: the adapter must refuse to exist rather than hand the
// console an empty book it would then "fill" (demo rows included) into the live tables.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
globalThis.window = globalThis;
localStorage.setItem('ledjaa.supabase', JSON.stringify({ url: 'https://ledger.test/api/ledger', key: 'test-key' }));
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };

test('import rejects when neither cloud nor cache is available, and the exposed db accepts no writes', async () => {
  await assert.rejects(import('../ledger/ledjaa-db.js'), /unavailable/);
  const db = globalThis.window.__ledgerDb;
  assert.equal(db.sync.source, 'empty');
  assert.equal(db.insert('clients', { id: 'c1', ref: 'EC-1', name: 'X' }), null);
  assert.equal(db.sync.pending, 0);
  assert.equal(localStorage.getItem('ledjaa.db.queue'), null);
});
