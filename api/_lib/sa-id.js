// SA ID numbers are encrypted at rest. QUIK1_ID_KEY is the current 32-byte key
// (64 hex chars). QUIK1_ID_KEY_PREVIOUS decrypts older ciphertext after a
// rotation. QUIK1_ID_HMAC_KEY is a separate HMAC key for duplicate detection.
// All three stay unset until intake is turned on. Plaintext is not logged and
// is not returned to the client.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { selectOne, update, eq } from './supabase.js';

function keyFrom(name) {
  const raw = String(process.env[name] || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

export function idKey() {
  return keyFrom('QUIK1_ID_KEY');
}

export function previousIdKey() {
  return keyFrom('QUIK1_ID_KEY_PREVIOUS');
}

export function hmacKey() {
  return keyFrom('QUIK1_ID_HMAC_KEY');
}

function aadFor(borrowerId) {
  return Buffer.from('quik1-borrower:' + String(borrowerId || ''), 'utf8');
}

export function luhnOk(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function normaliseSaId(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!luhnOk(digits)) return '';
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return digits;
}

export function maskId(digits) {
  if (!/^\d{13}$/.test(digits)) return '';
  return '*********' + digits.slice(-4);
}

function seal(digits, borrowerId, key, version) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(borrowerId));
  const ct = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

function openWith(ivB, tagB, ctB, borrowerId, key) {
  let iv;
  let tag;
  let ct;
  try {
    iv = Buffer.from(ivB, 'base64url');
    tag = Buffer.from(tagB, 'base64url');
    ct = Buffer.from(ctB, 'base64url');
  } catch {
    return '';
  }
  if (iv.length !== 12 || tag.length !== 16 || ct.length < 1) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aadFor(borrowerId));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return normaliseSaId(plain);
  } catch {
    return '';
  }
}

export function encryptId(digits, borrowerId) {
  const key = idKey();
  const clean = normaliseSaId(digits);
  if (!key || !clean || !borrowerId) return null;
  return seal(clean, borrowerId, key, 'v1');
}

export function decryptId(stored, borrowerId) {
  if (!borrowerId || typeof stored !== 'string') return '';
  const parts = stored.split('.');
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) return '';
  const keys = [];
  const current = idKey();
  const previous = previousIdKey();
  if (current) keys.push(current);
  if (previous) keys.push(previous);
  for (const key of keys) {
    const plain = openWith(parts[1], parts[2], parts[3], borrowerId, key);
    if (plain) return plain;
  }
  return '';
}

export function maskStored(stored, borrowerId) {
  return maskId(decryptId(stored, borrowerId));
}

// Keyed HMAC of the ID only, so two borrowers cannot store the same number.
// Null when QUIK1_ID_HMAC_KEY is unset. This is not an unsalted hash.
export function idHmac(digits) {
  const key = hmacKey();
  const clean = normaliseSaId(digits);
  if (!key || !clean) return null;
  return createHmac('sha256', key).update(clean, 'utf8').digest('hex');
}

export async function storeBorrowerId(borrowerId, raw) {
  const digits = normaliseSaId(raw);
  if (!digits) throw new HttpError(400, 'ID number is not valid');
  if (!idKey() || !hmacKey()) throw new HttpError(503, 'ID storage is not configured');
  const stored = encryptId(digits, borrowerId);
  const mac = idHmac(digits);
  if (!stored || !mac) throw new HttpError(503, 'ID storage is not configured');
  const patch = {
    id_ciphertext: stored,
    id_hmac: mac,
    updated_at: new Date().toISOString()
  };
  try {
    await update('q1_borrowers', { id: borrowerId }, patch);
  } catch (err) {
    if (err && err.code === '23505') throw new HttpError(409, 'That ID is already on file');
    throw err;
  }
  return { idMasked: maskId(digits) };
}

export async function maskForBorrower(borrowerId) {
  let row;
  try {
    row = await selectOne('q1_borrowers', { select: 'id_ciphertext', id: eq(borrowerId) });
  } catch (err) {
    const missing = err && (err.code === '42703' || /42703/.test(String(err.message || '')));
    if (missing) return '';
    throw err;
  }
  return maskStored(row && row.id_ciphertext, borrowerId);
}
