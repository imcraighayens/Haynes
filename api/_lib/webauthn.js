// WebAuthn platform authenticator (Face ID, Touch ID, Android fingerprint).
// Attestation is "none": the session already proved the PIN, and the signature
// on later assertions is what unlocks. No certificate chain is fetched.
import { createHash, createPublicKey, verify as verifySig } from 'node:crypto';

export function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function b64urlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,8192}$/.test(value)) return null;
  const buf = Buffer.from(value, 'base64url');
  return buf.length ? buf : null;
}

function encodeLen(major, n) {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n >>> 0, 1);
  return b;
}

export function cborEncode(value) {
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === null) return Buffer.from([0xf6]);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('cbor');
    if (value >= 0) return encodeLen(0, value);
    return encodeLen(1, -1 - value);
  }
  if (typeof value === 'string') {
    const b = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeLen(3, b.length), b]);
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const b = Buffer.from(value);
    return Buffer.concat([encodeLen(2, b.length), b]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([encodeLen(4, value.length), ...value.map(cborEncode)]);
  }
  if (value instanceof Map) {
    const parts = [encodeLen(5, value.size)];
    for (const [k, v] of value) parts.push(cborEncode(k), cborEncode(v));
    return Buffer.concat(parts);
  }
  throw new Error('cbor');
}

export function cborDecode(input) {
  const u8 = Buffer.from(input);
  function read(o) {
    if (o >= u8.length) throw new Error('cbor');
    const ib = u8[o];
    const major = ib >> 5;
    const ai = ib & 31;
    let n = 0;
    let p = o + 1;
    if (ai < 24) n = ai;
    else if (ai === 24) { n = u8[p]; p += 1; }
    else if (ai === 25) { n = (u8[p] << 8) | u8[p + 1]; p += 2; }
    else if (ai === 26) { n = u8.readUInt32BE(p); p += 4; }
    else throw new Error('cbor');
    if (major === 0) return { v: n, p };
    if (major === 1) return { v: -1 - n, p };
    if (major === 2) return { v: u8.subarray(p, p + n), p: p + n };
    if (major === 3) return { v: u8.subarray(p, p + n).toString('utf8'), p: p + n };
    if (major === 4) {
      const arr = [];
      for (let i = 0; i < n; i++) { const x = read(p); arr.push(x.v); p = x.p; }
      return { v: arr, p };
    }
    if (major === 5) {
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const k = read(p); p = k.p;
        const val = read(p); p = val.p;
        map.set(k.v, val.v);
      }
      return { v: map, p };
    }
    if (major === 7 && ai === 20) return { v: false, p: o + 1 };
    if (major === 7 && ai === 21) return { v: true, p: o + 1 };
    if (major === 7 && ai === 22) return { v: null, p: o + 1 };
    throw new Error('cbor');
  }
  const out = read(0);
  if (out.p !== u8.length) throw new Error('cbor');
  return out.v;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest();
}

export function parseClientData(raw, { type, origin, challenge }) {
  let json;
  try { json = JSON.parse(Buffer.from(raw).toString('utf8')); } catch { return null; }
  if (!json || json.type !== type) return null;
  if (json.origin !== origin) return null;
  if (typeof json.challenge !== 'string' || json.challenge !== challenge) return null;
  return json;
}

export function parseAuthData(raw) {
  const b = Buffer.from(raw);
  if (b.length < 37) return null;
  const rpIdHash = b.subarray(0, 32);
  const flags = b[32];
  const signCount = b.readUInt32BE(33);
  let credentialId = null;
  let cose = null;
  if (flags & 0x40) {
    if (b.length < 55) return null;
    let pos = 37 + 16;
    const len = b.readUInt16BE(pos);
    pos += 2;
    if (len < 16 || len > 256 || b.length < pos + len + 1) return null;
    credentialId = b.subarray(pos, pos + len);
    pos += len;
    try { cose = cborDecode(b.subarray(pos)); } catch { return null; }
    if (!(cose instanceof Map)) return null;
  }
  return {
    rpIdHash,
    flags,
    signCount,
    credentialId,
    cose,
    up: !!(flags & 0x01),
    uv: !!(flags & 0x04)
  };
}

export function publicKeyFromCose(cose) {
  if (!(cose instanceof Map)) return null;
  const kty = cose.get(1);
  try {
    if (kty === 2 && cose.get(-1) === 1) {
      const x = cose.get(-2);
      const y = cose.get(-3);
      if (!x || !y || x.length !== 32 || y.length !== 32) return null;
      return createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(x), y: b64urlEncode(y) },
        format: 'jwk'
      });
    }
    if (kty === 3) {
      const n = cose.get(-1);
      const e = cose.get(-2);
      if (!n || !e) return null;
      return createPublicKey({
        key: { kty: 'RSA', n: b64urlEncode(n), e: b64urlEncode(e) },
        format: 'jwk'
      });
    }
  } catch { return null; }
  return null;
}

export function verifyAssertion({ authenticatorData, clientData, signature, publicKey }) {
  const key = publicKeyFromCose(publicKey instanceof Map ? publicKey : cborDecode(publicKey));
  if (!key) return false;
  const signed = Buffer.concat([Buffer.from(authenticatorData), sha256(clientData)]);
  try { return verifySig('sha256', signed, key, Buffer.from(signature)); }
  catch { return false; }
}

export function registrationFromAttestation(attestationObject) {
  let obj;
  try { obj = cborDecode(attestationObject); } catch { return null; }
  if (!(obj instanceof Map)) return null;
  if (obj.get('fmt') !== 'none') return null;
  const authData = obj.get('authData');
  if (!authData) return null;
  const parsed = parseAuthData(authData);
  if (!parsed || !parsed.credentialId || !parsed.cose) return null;
  if (!publicKeyFromCose(parsed.cose)) return null;
  return { authData: Buffer.from(authData), parsed, cose: cborEncode(parsed.cose) };
}
