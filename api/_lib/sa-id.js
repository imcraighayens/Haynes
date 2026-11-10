// SA ID numbers are encrypted at rest. The key is QUIK1_ID_KEY (64 hex chars,
// 32 bytes). Plaintext is not logged and is not returned to the client.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { selectOne, update, eq } from './supabase.js';

const AAD = Buffer.from('quik1-sa-id');

export function idKey() {
  const raw = String(process.env.QUIK1_ID_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
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

export function encryptId(digits) {
  const key = idKey();
  const clean = normaliseSaId(digits);
  if (!key || !clean) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ct = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptId(stored) {
  const key = idKey();
  if (!key || typeof stored !== 'string') return '';
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  let iv;
  let tag;
  let ct;
  try {
    iv = Buffer.from(parts[1], 'base64url');
    tag = Buffer.from(parts[2], 'base64url');
    ct = Buffer.from(parts[3], 'base64url');
  } catch {
    return '';
  }
  if (iv.length !== 12 || tag.length !== 16 || ct.length < 1) return '';
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return normaliseSaId(plain);
  } catch {
    return '';
  }
}

export function maskStored(stored) {
  return maskId(decryptId(stored));
}

export async function storeBorrowerId(borrowerId, raw) {
  const digits = normaliseSaId(raw);
  if (!digits) throw new HttpError(400, 'ID number is not valid');
  const stored = encryptId(digits);
  if (!stored) throw new HttpError(503, 'Server not configured');
  await update('q1_borrowers', { id: borrowerId }, {
    id_ciphertext: stored,
    updated_at: new Date().toISOString()
  });
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
  return maskStored(row && row.id_ciphertext);
}
