import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptId, encryptId, luhnOk, maskId, maskStored, normaliseSaId } from '../../api/_lib/sa-id.js';

const ID = '8001015009087';
const KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

test('SA ID checks, encryption, and masking', () => {
  assert.equal(luhnOk(ID), true);
  assert.equal(luhnOk('9001015009087'), false);
  assert.equal(normaliseSaId('800101 5009087'), ID);
  assert.equal(normaliseSaId('8001015009088'), '');
  assert.equal(maskId(ID), '*********9087');
  assert.equal(maskId('123'), '');

  delete process.env.QUIK1_ID_KEY;
  assert.equal(encryptId(ID), null);

  process.env.QUIK1_ID_KEY = KEY;
  const stored = encryptId(ID);
  assert.match(stored, /^v1\./);
  assert.equal(stored.includes(ID), false);
  assert.equal(decryptId(stored), ID);
  assert.equal(maskStored(stored), '*********9087');

  process.env.QUIK1_ID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  assert.equal(decryptId(stored), '');
  assert.equal(maskStored(stored), '');
  delete process.env.QUIK1_ID_KEY;
  assert.equal(decryptId(stored), '');
});
