import { assert, assertEquals } from 'jsr:@std/assert@1';
import { normalisePhone, validSaId } from './validate.ts';
import { hashPin, verifyPin, randomDigits, timingSafeEqual } from './crypto.ts';

Deno.test('SA ID: Luhn + date', () => {
  assert(validSaId('8001015009087'));
  assert(!validSaId('8001015009088'), 'bad check digit');
  assert(!validSaId('8013015009087'), 'month 13');
  assert(!validSaId('800101500908'), 'too short');
});

Deno.test('phone normalising', () => {
  assertEquals(normalisePhone('82 431 9077'), '+27824319077');
  assertEquals(normalisePhone('0824319077'), '+27824319077');
  assertEquals(normalisePhone('+27 82 431 9077'), '+27824319077');
  assertEquals(normalisePhone('12345'), null);
  assertEquals(normalisePhone('0124319077'), null, 'landline prefix');
});

Deno.test('PIN hashing round-trip', async () => {
  const h = await hashPin('4821');
  assert(h.startsWith('pbkdf2$210000$'));
  assert(await verifyPin('4821', h));
  assert(!(await verifyPin('4822', h)));
  assert(h !== (await hashPin('4821')), 'salted');
});

Deno.test('codes are digits', () => {
  for (let i = 0; i < 50; i++) assert(/^\d{4}$/.test(randomDigits(4)));
  assert(timingSafeEqual('abc', 'abc') && !timingSafeEqual('abc', 'abd'));
});
