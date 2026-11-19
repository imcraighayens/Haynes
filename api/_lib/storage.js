// Private Supabase Storage uploads. The service role is the only caller.
// Objects stay in the q1-documents bucket. Callers must not return a public URL.
import { HttpError } from './http.js';

export const DOC_BUCKET = 'q1-documents';
const MAX_BYTES = Math.max(1024, parseInt(process.env.QUIK1_DOC_MAX_BYTES, 10) || (1536 * 1024));

const TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp'
};

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Server not configured');
  return { url: url.replace(/\/+$/, ''), key };
}

export function decodeDocument(data, contentType) {
  const type = TYPES[String(contentType || '').toLowerCase()];
  if (!type) throw new HttpError(400, 'Upload a PDF or a photo');
  const clean = String(data || '').replace(/\s/g, '');
  if (!clean || clean.length > MAX_BYTES * 2 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean)) {
    throw new HttpError(400, 'That file could not be read');
  }
  let buf;
  try { buf = Buffer.from(clean, 'base64'); } catch { throw new HttpError(400, 'That file could not be read'); }
  if (!buf.length || buf.length > MAX_BYTES) throw new HttpError(400, 'That file is too large');
  return { bytes: buf, ext: type, contentType: String(contentType).toLowerCase() };
}

export async function uploadPrivate(objectPath, bytes, contentType) {
  const path = String(objectPath || '');
  if (!path.startsWith('applications/') || path.includes('..')) throw new HttpError(400, 'bad path');
  const { url, key } = env();
  const target = `${url}/storage/v1/object/${DOC_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  let res;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': contentType,
        'x-upsert': 'true'
      },
      body: bytes
    });
  } catch {
    throw new HttpError(502, 'Storage unreachable');
  }
  if (!res.ok) throw new HttpError(502, 'Could not store the file');
  return { path };
}

// Short-lived staff link. The path must already be one we stored.
export async function signPrivate(objectPath, expiresIn = 120) {
  const path = String(objectPath || '');
  if (!path.startsWith('applications/') || path.includes('..')) throw new HttpError(400, 'bad path');
  const { url, key } = env();
  const target = `${url}/storage/v1/object/sign/${DOC_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  let res;
  try {
    res = await fetch(target, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn })
    });
  } catch {
    throw new HttpError(502, 'Storage unreachable');
  }
  const text = typeof res.text === 'function' ? await res.text() : '';
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }
  const signed = data && (data.signedURL || data.signedUrl);
  if (!res.ok || !signed) throw new HttpError(502, 'Could not open the file');
  const abs = String(signed).startsWith('http') ? String(signed) : `${url}/storage/v1${signed}`;
  return abs;
}
