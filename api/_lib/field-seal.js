// AES-256-GCM for a short secret bound to one owner.
// Ciphertext is version.iv.tag.body, each part base64url. The version selects
// a key generation; readers try the current key, then the previous one.
// The AAD is the owner string. A copy onto another row does not decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function keyFromEnv(name) {
  const raw = String(process.env[name] || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

function aadBytes(aad) {
  return Buffer.isBuffer(aad) ? aad : Buffer.from(String(aad), 'utf8');
}

export function sealBytes(plain, aad, key, version = 'v1') {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadBytes(aad));
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [version, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

function openOne(ivB, tagB, ctB, aad, key) {
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
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// First key that opens the blob wins. A wrong key or a wrong AAD yields ''.
export function openSealed(stored, aad, keys) {
  if (typeof stored !== 'string') return '';
  const parts = stored.split('.');
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) return '';
  for (const key of keys || []) {
    if (!key) continue;
    const plain = openOne(parts[1], parts[2], parts[3], aad, key);
    if (plain) return plain;
  }
  return '';
}
