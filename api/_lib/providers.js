// Server-side document reader and Twilio. Keys are read from the environment only.
// Request bodies cannot supply or override them, and responses never include them.
import { HttpError } from './http.js';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const DOC_TYPES = new Set(['application/pdf']);
const NOT_CONFIGURED = 'Not configured';

function envValue(name) {
  const v = String(process.env[name] || '').trim();
  return v || '';
}

export function aiProvider() {
  const anthropic = envValue('ANTHROPIC_API_KEY');
  const openai = envValue('OPENAI_API_KEY');
  const prefer = envValue('LEDGER_AI_PROVIDER').toLowerCase();
  if (prefer === 'openai' && openai) return { name: 'openai', key: openai };
  if (prefer === 'anthropic' && anthropic) return { name: 'anthropic', key: anthropic };
  if (anthropic) return { name: 'anthropic', key: anthropic };
  if (openai) return { name: 'openai', key: openai };
  return null;
}

export function aiStatus() {
  const p = aiProvider();
  return { configured: !!p, provider: p ? p.name : null };
}

export function twilioStatus() {
  const sid = envValue('TWILIO_ACCOUNT_SID');
  const token = envValue('TWILIO_AUTH_TOKEN');
  const from = envValue('TWILIO_FROM');
  return { configured: !!(sid && token && from) };
}

function cleanText(v, max) {
  return String(v == null ? '' : v).slice(0, max);
}

function cleanBlocks(images) {
  const list = Array.isArray(images) ? images.slice(0, 6) : [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const media = String(raw.media_type || raw.mediaType || '').toLowerCase();
    const data = String(raw.data || '');
    if (!data || data.length > 1_500_000) continue;
    if (!IMAGE_TYPES.has(media) && !DOC_TYPES.has(media)) continue;
    out.push({ type: DOC_TYPES.has(media) ? 'document' : 'image', media_type: media, data });
  }
  return out;
}

async function providerFetch(url, init) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) });
  } catch {
    throw new HttpError(502, 'AI request failed');
  }
  if (!res.ok) {
    // Missing or rejected server credentials look the same to the client as an unset key.
    if (res.status === 401 || res.status === 403) throw new HttpError(503, NOT_CONFIGURED);
    throw new HttpError(502, 'AI request failed');
  }
  try { return await res.json(); } catch { throw new HttpError(502, 'AI request failed'); }
}

export async function completeAi({ prompt, docText, images } = {}) {
  const provider = aiProvider();
  if (!provider) throw new HttpError(503, NOT_CONFIGURED);
  const userText = (docText ? ('DOCUMENT TEXT (extracted on-device):\n' + docText + '\n\n') : '') + cleanText(prompt, 20000);
  const blocks = cleanBlocks(images);
  if (provider.name === 'openai') {
    const content = [{ type: 'text', text: userText }];
    for (const b of blocks) {
      if (b.type !== 'image') continue;
      content.push({ type: 'image_url', image_url: { url: 'data:' + b.media_type + ';base64,' + b.data } });
    }
    const model = envValue('OPENAI_MODEL') || 'gpt-4o-mini';
    const json = await providerFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.key },
      body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content }] })
    });
    const text = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    return String(text || '');
  }
  const content = blocks.map(b => ({ type: b.type, source: { type: 'base64', media_type: b.media_type, data: b.data } }));
  content.push({ type: 'text', text: userText });
  const model = envValue('ANTHROPIC_MODEL') || 'claude-haiku-4-5';
  const json = await providerFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content }] })
  });
  const text = json && Array.isArray(json.content) ? json.content.map(c => c && c.text || '').join('') : '';
  return String(text || '');
}

function formBody(fields) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) sp.set(k, v);
  return sp.toString();
}

export async function sendTwilio({ action, to, body } = {}) {
  const sid = envValue('TWILIO_ACCOUNT_SID');
  const token = envValue('TWILIO_AUTH_TOKEN');
  const from = envValue('TWILIO_FROM');
  if (!sid || !token || !from) throw new HttpError(503, NOT_CONFIGURED);
  const dest = String(to || '').trim();
  if (!/^\+?[0-9][0-9\s()-]{6,20}$/.test(dest)) throw new HttpError(400, NOT_CONFIGURED);
  const account = encodeURIComponent(sid);
  const auth = Buffer.from(sid + ':' + token).toString('base64');
  const kind = String(action || '').toLowerCase() === 'call' ? 'Calls' : 'Messages';
  const fields = kind === 'Calls'
    ? { To: dest, From: from, Twiml: '<Response><Say>This is EcoLoans.</Say></Response>' }
    : { To: dest, From: from, Body: cleanText(body || 'EcoLoans', 320) };
  let res;
  try {
    res = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + account + '/' + kind + '.json', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody(fields),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new HttpError(502, NOT_CONFIGURED);
  }
  if (!res.ok) throw new HttpError(res.status === 401 || res.status === 403 ? 503 : 502, NOT_CONFIGURED);
  return { ok: true };
}
