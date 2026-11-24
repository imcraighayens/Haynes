// Borrower PINs are QUIK1_PIN_LENGTH digits. Only a salted scrypt hash is stored.
// Node's built-in scrypt keeps the bridge free of npm packages. The space is small,
// so online guesses are also locked in the database after repeated failures.
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { QUIK1_PIN_LENGTH } from '../../shared/pin-length.js';

export { QUIK1_PIN_LENGTH };

const scrypt = promisify(scryptCb);
let verifyCalls = 0;
export function resetVerifyCalls() { verifyCalls = 0; }
export function verifyCallCount() { return verifyCalls; }
const COST = 16384;
const BLOCK = 8;
const PARALLEL = 1;
const KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024;
// scrypt$cost$block$parallel$salt$hash — field count, not a PIN length.
const HASH_FIELDS = 6;

function allDigits(v) {
  return typeof v === 'string' && v.length > 0 && [...v].every(ch => ch >= '0' && ch <= '9');
}

function digitPin(v, length) {
  return allDigits(v) && v.length === length;
}

export function isPin(v) {
  return digitPin(v, QUIK1_PIN_LENGTH);
}

// A digit string of some other length. Letters and empty values are not this:
// those stay on the generic refusal path.
export function isWrongLengthPin(v) {
  return allDigits(v) && !isPin(v);
}

// Lengths that may already be stored. Sign-in and a new PIN do not accept these
// unless they are exactly QUIK1_PIN_LENGTH. verifyPin uses this so a shorter or
// longer stored secret compares instead of throwing.
export function isVerifiablePin(v) {
  return digitPin(v, QUIK1_PIN_LENGTH)
    || digitPin(v, QUIK1_PIN_LENGTH - 1)
    || digitPin(v, QUIK1_PIN_LENGTH + 1);
}

export function isWeakPin(pin) {
  if (!isPin(pin)) return true;
  const repeated = new RegExp('^(\\d)\\1{' + (QUIK1_PIN_LENGTH - 1) + '}$');
  if (repeated.test(pin)) return true;
  const nums = [...pin].map(d => d.charCodeAt(0) - 48);
  let up = true;
  let down = true;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) up = false;
    if (nums[i] !== nums[i - 1] - 1) down = false;
  }
  return up || down;
}

export function isChosenPin(pin) {
  return isPin(pin) && !isWeakPin(pin);
}

export function chosenPinMessage() {
  return 'Choose a ' + QUIK1_PIN_LENGTH + '-digit PIN that is not a run or all one digit';
}

export function enterPinMessage() {
  return 'Enter a ' + QUIK1_PIN_LENGTH + '-digit PIN';
}

// Same sentence for an unknown account and a wrong PIN. The previous length is
// derived so a legacy holder is not told apart from anyone else.
export function pinNotAcceptedMessage() {
  return 'PIN not accepted. Forgot your PIN or still using an old '
    + (QUIK1_PIN_LENGTH + 1) + '-digit PIN? Contact us for a staff reset.';
}

function paramsOk(cost, block, parallel) {
  return (cost === 16384 || cost === 32768) && block === BLOCK && parallel === PARALLEL;
}

async function scryptPin(pin) {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, KEYLEN, {
    cost: COST, blockSize: BLOCK, parallelization: PARALLEL, maxmem: MAXMEM
  });
  return ['scrypt', String(COST), String(BLOCK), String(PARALLEL), salt.toString('base64url'), Buffer.from(hash).toString('base64url')].join('$');
}

export async function hashPin(pin) {
  if (!isPin(pin)) {
    const err = new Error('bad pin');
    err.code = 'BAD_PIN';
    throw err;
  }
  return scryptPin(pin);
}

// Builds a hash for a digit string that may already be on file. Not a login check.
export async function hashPinForVerify(pin) {
  if (!isVerifiablePin(pin)) {
    const err = new Error('bad pin');
    err.code = 'BAD_PIN';
    throw err;
  }
  return scryptPin(pin);
}

// False for a missing, malformed, or non-matching hash. A length that does not
// match the stored secret returns false and does not throw.
export async function verifyPin(pin, stored) {
  verifyCalls += 1;
  try {
    if (!isVerifiablePin(pin) || typeof stored !== 'string') return false;
    const parts = stored.split('$');
    if (parts.length !== HASH_FIELDS || parts[0] !== 'scrypt') return false;
    const cost = Number(parts[1]);
    const block = Number(parts[2]);
    const parallel = Number(parts[3]);
    if (!paramsOk(cost, block, parallel)) return false;
    const salt = Buffer.from(parts[4], 'base64url');
    const expect = Buffer.from(parts[5], 'base64url');
    if (salt.length < 8 || expect.length !== KEYLEN) return false;
    const got = await scrypt(pin, salt, expect.length, {
      cost, blockSize: block, parallelization: parallel, maxmem: MAXMEM
    });
    if (!Buffer.isBuffer(got) || got.length !== expect.length) return false;
    return timingSafeEqual(got, expect);
  } catch {
    return false;
  }
}
