// Ledger copies of an SA ID or a bank account number.
// Same AES-256-GCM as a Quik1 borrower ID (api/_lib/field-seal.js): versioned
// key, AAD bound to the row that owns the value. ID uniqueness uses
// QUIK1_ID_HMAC_KEY. Bank details use QUIK1_BANK_KEY and QUIK1_BANK_HMAC_KEY
// so the ID key is not also an account key.
//
// Reads mask by default. Pass { reveal: true } only after the staff check.
// A write of a real value fails closed (503) when its key is unset, and the
// plaintext column is cleared in the same write. Ciphertext is never returned.
import { createHmac } from 'node:crypto';
import { HttpError } from './http.js';
import { selectOne, eq } from './supabase.js';
import { keyFromEnv, openSealed, sealBytes } from './field-seal.js';
import { hmacKey, idHmac, idKey, maskId, normaliseSaId, previousIdKey } from './sa-id.js';

const ID_MESSAGE = 'ID storage is not configured';
const BANK_MESSAGE = 'Bank storage is not configured';

export function bankKey() {
  return keyFromEnv('QUIK1_BANK_KEY');
}

export function previousBankKey() {
  return keyFromEnv('QUIK1_BANK_KEY_PREVIOUS');
}

export function bankHmacKey() {
  return keyFromEnv('QUIK1_BANK_HMAC_KEY');
}

export function secretsReady() {
  return !!(idKey() && hmacKey() && bankKey() && bankHmacKey());
}

export function assertSecretsReady() {
  if (!idKey() || !hmacKey()) throw new HttpError(503, ID_MESSAGE);
  if (!bankKey() || !bankHmacKey()) throw new HttpError(503, BANK_MESSAGE);
}

function idKeys() {
  return [idKey(), previousIdKey()].filter(Boolean);
}

function bankKeys() {
  return [bankKey(), previousBankKey()].filter(Boolean);
}

function requireKind(kind) {
  if (kind === 'bank') {
    if (!bankKey() || !bankHmacKey()) throw new HttpError(503, BANK_MESSAGE);
    return;
  }
  if (!idKey() || !hmacKey()) throw new HttpError(503, ID_MESSAGE);
}

export function accountHmac(digits) {
  const key = bankHmacKey();
  const clean = String(digits || '').replace(/\D/g, '');
  if (!key || clean.length < 4) return null;
  return createHmac('sha256', key).update('ledger-bank:' + clean, 'utf8').digest('hex');
}

export function maskAccount(digits) {
  const clean = String(digits || '').replace(/\D/g, '');
  if (clean.length < 4) return '';
  return '******' + clean.slice(-4);
}

function last4Of(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function blank(value) {
  if (value == null) return true;
  const s = String(value).trim();
  return s === '' || s === '—';
}

// A masked echo must not be stored as if it were the secret.
function maskEcho(value) {
  return /^[*•]{4,}\s*\d{4}$/.test(String(value || '').trim());
}

function sealKind(kind, raw, aad) {
  requireKind(kind);
  if (kind === 'bank') {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 4 || digits.length > 30) throw new HttpError(400, 'Account number is not valid');
    return {
      ciphertext: sealBytes(digits, aad, bankKey(), 'v1'),
      hmac: accountHmac(digits),
      last4: digits.slice(-4)
    };
  }
  const canonical = normaliseSaId(raw);
  const stored = canonical || String(raw).trim().slice(0, 40);
  if (!stored) throw new HttpError(400, 'ID number is not valid');
  return {
    ciphertext: sealBytes(stored, aad, idKey(), 'v1'),
    hmac: canonical ? idHmac(canonical) : null,
    last4: last4Of(stored)
  };
}

function openKind(kind, stored, aad) {
  if (kind === 'bank') return openSealed(stored, aad, bankKeys());
  const plain = openSealed(stored, aad, idKeys());
  return normaliseSaId(plain) || plain;
}

const HIDDEN = [
  'id_ciphertext', 'id_hmac', 'id_last4',
  'account_ciphertext', 'account_hmac', 'account_last4',
  'bank_account_ciphertext', 'bank_account_hmac'
];

// Public ledger tables the API writes. Quik1 and Loop application tables are
// backfilled from scripts/ and are not written by these routes.
const PUBLIC = {
  clients: {
    aad: id => 'ledger-client:' + id,
    fields: [
      { kind: 'id', column: 'id_number', cipher: 'id_ciphertext', hmac: 'id_hmac', last4: 'id_last4' },
      { kind: 'bank', column: 'account_no', cipher: 'account_ciphertext', hmac: 'account_hmac', last4: 'account_last4' }
    ]
  },
  applications: {
    aad: id => 'ledger-application:' + id,
    fields: [
      { kind: 'id', column: 'id_number', cipher: 'id_ciphertext', hmac: 'id_hmac', last4: 'id_last4' }
    ]
  },
  q1_signups: {
    aad: id => 'ledger-signup:' + id,
    fields: [
      { kind: 'id', column: 'id_number', cipher: 'id_ciphertext', hmac: 'id_hmac', last4: 'id_last4' }
    ]
  }
};

export const BACKFILL_TARGETS = [
  {
    schema: 'public',
    table: 'clients',
    optional: false,
    aad: id => 'ledger-client:' + id,
    fields: PUBLIC.clients.fields
  },
  {
    schema: 'public',
    table: 'applications',
    optional: false,
    aad: id => 'ledger-application:' + id,
    fields: PUBLIC.applications.fields
  },
  {
    schema: 'public',
    table: 'q1_signups',
    optional: true,
    aad: id => 'ledger-signup:' + id,
    fields: PUBLIC.q1_signups.fields
  },
  {
    schema: 'quik1',
    table: 'applications',
    optional: true,
    aad: id => 'quik1-application:' + id,
    fields: [
      { kind: 'id', column: 'id_number', cipher: 'id_ciphertext', hmac: 'id_hmac', last4: 'id_last4' },
      { kind: 'bank', column: 'bank_account_no', cipher: 'bank_account_ciphertext', hmac: 'bank_account_hmac', last4: 'bank_last4' }
    ]
  },
  {
    schema: 'loop',
    table: 'applications',
    optional: true,
    aad: id => 'loop-application:' + id,
    fields: [
      { kind: 'id', column: 'id_number', cipher: 'id_ciphertext', hmac: 'id_hmac', last4: 'id_last4' },
      { kind: 'bank', column: 'bank_account_no', cipher: 'bank_account_ciphertext', hmac: 'bank_account_hmac', last4: 'bank_last4' }
    ]
  }
];

function maskFrom(row, field) {
  const stored = row[field.last4];
  if (typeof stored === 'string' && /^\d{4}$/.test(stored)) {
    return field.kind === 'bank' ? maskAccount(stored) : maskId('000000000' + stored);
  }
  const raw = row[field.column];
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (digits.length >= 4) return field.kind === 'bank' ? maskAccount(digits) : ('*********' + digits.slice(-4));
  if (!blank(raw)) return field.kind === 'bank' ? '**********' : '*************';
  return null;
}

function hasSecret(row, field) {
  if (row[field.cipher] != null && String(row[field.cipher]).trim() !== '') return true;
  return !blank(row[field.column]);
}

// Replace plaintext columns. reveal is the staff book; the default is the mask.
// Ciphertext and HMAC columns are always removed from the copy.
export function presentLedgerRow(table, row, { reveal = false } = {}) {
  const spec = PUBLIC[table];
  if (!spec || !row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const field of spec.fields) {
    if (!hasSecret(row, field)) continue;
    if (!reveal) {
      out[field.column] = maskFrom(row, field);
      continue;
    }
    requireKind(field.kind);
    const owner = row.id;
    if (!owner) throw new HttpError(503, field.kind === 'bank' ? BANK_MESSAGE : ID_MESSAGE);
    if (row[field.cipher]) {
      const plain = openKind(field.kind, row[field.cipher], spec.aad(owner));
      out[field.column] = plain || maskFrom(row, field);
    } else {
      out[field.column] = row[field.column];
    }
  }
  for (const key of HIDDEN) delete out[key];
  return out;
}

// Move a plaintext column onto its ciphertext, HMAC and last-4 columns.
// An empty value clears all four. A mask-shaped value is left untouched.
export function sealWrite(table, row) {
  const spec = PUBLIC[table];
  if (!spec || !row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const field of spec.fields) {
    if (!(field.column in out)) continue;
    const raw = out[field.column];
    if (maskEcho(raw)) {
      delete out[field.column];
      continue;
    }
    if (blank(raw)) {
      out[field.column] = null;
      out[field.cipher] = null;
      out[field.hmac] = null;
      out[field.last4] = null;
      continue;
    }
    if (!out.id) throw new HttpError(400, 'Row needs a string id');
    const sealed = sealKind(field.kind, raw, spec.aad(out.id));
    out[field.column] = null;
    out[field.cipher] = sealed.ciphertext;
    out[field.hmac] = sealed.hmac;
    out[field.last4] = sealed.last4;
  }
  return out;
}

// Same seal used by the backfill, including schemas the API does not write.
export function sealTargetField(target, row, field) {
  const raw = row[field.column];
  if (blank(raw)) return null;
  if (!row.id) throw new HttpError(400, 'Row needs a string id');
  try {
    return sealKind(field.kind, raw, target.aad(row.id));
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return { skip: true };
    throw err;
  }
}

export function decryptStored(table, kind, stored, ownerId) {
  const spec = PUBLIC[table];
  if (!spec || !ownerId) return '';
  return openKind(kind, stored, spec.aad(ownerId));
}

export function decryptClientId(stored, clientId) {
  return openKind('id', stored, 'ledger-client:' + clientId);
}

export function decryptClientAccount(stored, clientId) {
  return openKind('bank', stored, 'ledger-client:' + clientId);
}

// Another client already holds this ID. Applications may repeat an ID, so
// only the client book is checked. The unique index is the backstop.
export async function ensureUniqueIds(rows) {
  for (const row of rows || []) {
    if (!row || !row.id_hmac) continue;
    let existing;
    try {
      existing = await selectOne('clients', { select: 'id', id_hmac: eq(row.id_hmac) });
    } catch (err) {
      const missing = err && (err.code === '42703' || err.code === '42P01');
      if (missing) throw new HttpError(503, ID_MESSAGE);
      throw err;
    }
    if (existing && existing.id !== row.id) throw new HttpError(409, 'That ID is already on file');
  }
}
