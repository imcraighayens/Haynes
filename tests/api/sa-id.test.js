import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decryptId, encryptId, idHmac, luhnOk, maskId, maskStored, normaliseSaId } from '../../api/_lib/sa-id.js';

const ID = '9912314800084';
const BORROWER = 'qb_' + 'ab'.repeat(16);
const OTHER = 'qb_' + 'cd'.repeat(16);
const KEY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const PREV = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HMAC = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

function flip(segment) {
  const chars = segment.split('');
  const i = Math.min(2, chars.length - 1);
  chars[i] = chars[i] === 'A' ? 'B' : 'A';
  return chars.join('');
}

test('SA ID checks, encryption, tamper, previous key, and HMAC', () => {
  assert.equal(luhnOk(ID), true);
  assert.equal(luhnOk('9912314800085'), false);
  assert.equal(normaliseSaId('991231 4800084'), ID);
  assert.equal(maskId(ID), '*********0084');

  delete process.env.QUIK1_ID_KEY;
  delete process.env.QUIK1_ID_KEY_PREVIOUS;
  delete process.env.QUIK1_ID_HMAC_KEY;
  assert.equal(encryptId(ID, BORROWER), null);

  process.env.QUIK1_ID_KEY = KEY;
  const stored = encryptId(ID, BORROWER);
  assert.match(stored, /^v1\./);
  assert.equal(stored.includes(ID), false);
  assert.equal(decryptId(stored, BORROWER), ID);
  assert.equal(decryptId(stored, OTHER), '');
  assert.equal(maskStored(stored, BORROWER), '*********0084');

  const [version, iv, tag, ct] = stored.split('.');
  assert.equal(decryptId([version, flip(iv), tag, ct].join('.'), BORROWER), '');
  assert.equal(decryptId([version, iv, flip(tag), ct].join('.'), BORROWER), '');
  assert.equal(decryptId([version, iv, tag, flip(ct)].join('.'), BORROWER), '');

  process.env.QUIK1_ID_KEY = PREV;
  process.env.QUIK1_ID_KEY_PREVIOUS = KEY;
  assert.equal(decryptId(stored, BORROWER), ID);
  delete process.env.QUIK1_ID_KEY_PREVIOUS;
  assert.equal(decryptId(stored, BORROWER), '');

  process.env.QUIK1_ID_HMAC_KEY = HMAC;
  const mac = idHmac(ID);
  assert.match(mac, /^[0-9a-f]{64}$/);
  assert.equal(idHmac(ID), mac);
  assert.notEqual(idHmac(ID), createHash('sha256').update(ID).digest('hex'));
  delete process.env.QUIK1_ID_KEY;
  delete process.env.QUIK1_ID_HMAC_KEY;
});
