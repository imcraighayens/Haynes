// Borrower PINs and SMS codes are 6 digits. Only a salted scrypt hash is stored.
// Node's built-in scrypt keeps the bridge free of npm packages. The space is small,
// so online guesses are also locked in the database after repeated failures.
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;

export function isPin(v) {
  return typeof v === 'string' && /^\d{6}$/.test(v);
}

function paramsOk(cost, block, parallel) {
  return (cost === 16384 || cost === 32768) && block === BLOCK && parallel === PARALLEL;
}

export async function hashPin(pin) {
  if (!isPin(pin)) {
    const err = new Error('bad pin');
    err.code = 'BAD_PIN';
    throw err;
  }
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, KEYLEN, {
    cost: COST, blockSize: BLOCK, parallelization: PARALLEL, maxmem: MAXMEM
  });
  return ['scrypt', String(COST), String(BLOCK), String(PARALLEL), salt.toString('base64url'), Buffer.from(hash).toString('base64url')].join('$');
}

// False for a missing, malformed, or non-matching hash. Never throws the submitted value.
export async function verifyPin(pin, stored) {
  if (!isPin(pin) || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const block = Number(parts[2]);
  const parallel = Number(parts[3]);
  if (!paramsOk(cost, block, parallel)) return false;
  let salt;
  let expect;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expect = Buffer.from(parts[5], 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 8 || expect.length !== KEYLEN) return false;
  let got;
  try {
    got = await scrypt(pin, salt, expect.length, {
      cost, blockSize: block, parallelization: parallel, maxmem: MAXMEM
    });
  } catch {
    return false;
  }
  if (!Buffer.isBuffer(got) || got.length !== expect.length) return false;
  return timingSafeEqual(got, expect);
}
