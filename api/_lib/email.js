// Borrower email for a new-device link. Sends only when QUIK1_EMAIL_FROM,
// QUIK1_EMAIL_API_URL and QUIK1_EMAIL_API_KEY are all set, and never on a
// production host. No provider account is chosen or called unless those are set.
import { isProductionDeployment } from './quik1-flags.js';

export const disabledEmail = {
  enabled: false,
  async send() {
    return { sent: false, reason: 'disabled' };
  }
};

let override = null;

export function setEmailSender(sender) {
  override = sender || null;
}

function envValue(name) {
  const v = String(process.env[name] || '').trim();
  return v || '';
}

export function borrowerEmailConfigured() {
  const url = envValue('QUIK1_EMAIL_API_URL');
  return !!(envValue('QUIK1_EMAIL_FROM') && envValue('QUIK1_EMAIL_API_KEY') && /^https:\/\//.test(url));
}

export function borrowerEmailLive(req) {
  if (!borrowerEmailConfigured()) return false;
  if (isProductionDeployment(req)) return false;
  return true;
}

function httpSender() {
  const from = envValue('QUIK1_EMAIL_FROM');
  const url = envValue('QUIK1_EMAIL_API_URL');
  const key = envValue('QUIK1_EMAIL_API_KEY');
  if (!from || !key || !/^https:\/\//.test(url)) return disabledEmail;
  return {
    enabled: true,
    async send(to, subject, text) {
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ from, to: String(to), subject: String(subject), text: String(text) })
        });
      } catch {
        return { sent: false, reason: 'unreachable' };
      }
      return { sent: !!res.ok, reason: res.ok ? undefined : 'rejected' };
    }
  };
}

export function emailSender(req) {
  if (override) return override;
  if (!borrowerEmailLive(req)) return disabledEmail;
  return httpSender();
}
