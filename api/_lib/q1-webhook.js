// Optional CEO Q1 ping. Chat never depends on this: a missing URL, a bad URL, or a
// failed POST is ignored. The body is a short summary of the user's own message —
// no book dump, no cookies, no bearer token, no service key.

const WEBHOOK_TIMEOUT_MS = 1200;

export function scrubSecrets(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\b\d{13}\b/g, '[id]')
    .replace(/\b(?:password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*\S+/gi, '[secret]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [secret]');
}

export function webhookSummary({ source, page, message }) {
  const oneLine = (v) => scrubSecrets(v).replace(/\s+/g, ' ').trim();
  return {
    source: source || 'ledger-q1',
    at: new Date().toISOString(),
    page: oneLine(page).slice(0, 40),
    message: oneLine(message).slice(0, 500)
  };
}

export async function notifyQ1Webhook(summary) {
  const raw = String(process.env.Q1_WEBHOOK_URL || '').trim();
  if (!raw) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // Operator-configured URL only. Still refuse loopback and the cloud metadata address.
  if (host === 'localhost' || host === 'metadata.google.internal' || host === '169.254.169.254' || host === '::1') return false;
  const body = webhookSummary(summary);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
      redirect: 'error'
    });
  } catch {
    // The reply is already decided. A dead webhook must not fail the chat.
  } finally {
    clearTimeout(timer);
  }
  return true;
}
