// SMS one-time codes for Quik1 sign-in. The code is generated here and handed to
// a provider adapter. Nothing in this file logs the code or the destination.
//
// QUIK1_SMS_PROVIDER selects the adapter. Leave it unset until a provider exists.
//   http    QUIK1_SMS_API_URL (https) and QUIK1_SMS_API_KEY. Optional QUIK1_SMS_FROM.
//   twilio  QUIK1_SMS_ACCOUNT_SID, QUIK1_SMS_AUTH_TOKEN, and QUIK1_SMS_FROM.
// With those unset, every environment fails closed. No code is generated.
import { randomInt } from 'node:crypto';

export const SMS_CODE_LENGTH = 4;
export const SMS_UNAVAILABLE = "SMS sign-in isn't available yet";

let override = null;

export function setSmsSender(sender) {
  override = sender || null;
}

function envValue(name) {
  const v = String(process.env[name] || '').trim();
  return v || '';
}

export function smsTtlMs() {
  const n = parseInt(process.env.QUIK1_SMS_TTL_MINUTES, 10);
  const minutes = Number.isFinite(n) && n >= 5 && n <= 10 ? n : 8;
  return minutes * 60 * 1000;
}

export function newSmsCode() {
  return String(randomInt(0, 10000)).padStart(SMS_CODE_LENGTH, '0');
}

function httpReady() {
  const url = envValue('QUIK1_SMS_API_URL');
  return !!(envValue('QUIK1_SMS_API_KEY') && /^https:\/\//.test(url));
}

function twilioReady() {
  return !!(envValue('QUIK1_SMS_ACCOUNT_SID') && envValue('QUIK1_SMS_AUTH_TOKEN') && envValue('QUIK1_SMS_FROM'));
}

function providerReady() {
  const name = envValue('QUIK1_SMS_PROVIDER').toLowerCase();
  if (name === 'http') return httpReady() ? 'http' : '';
  if (name === 'twilio') return twilioReady() ? 'twilio' : '';
  return '';
}

function httpSender() {
  const url = envValue('QUIK1_SMS_API_URL');
  const key = envValue('QUIK1_SMS_API_KEY');
  const from = envValue('QUIK1_SMS_FROM');
  return {
    enabled: true,
    async send(to, text) {
      let res;
      try {
        const payload = { to: String(to), text: String(text) };
        if (from) payload.from = from;
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      } catch {
        return { sent: false, reason: 'unreachable' };
      }
      return { sent: !!res.ok, reason: res.ok ? undefined : 'rejected' };
    }
  };
}

function twilioSender() {
  const sid = envValue('QUIK1_SMS_ACCOUNT_SID');
  const token = envValue('QUIK1_SMS_AUTH_TOKEN');
  const from = envValue('QUIK1_SMS_FROM');
  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(sid) + '/Messages.json';
  const auth = Buffer.from(sid + ':' + token).toString('base64');
  return {
    enabled: true,
    async send(to, text) {
      let res;
      try {
        const form = new URLSearchParams();
        form.set('To', String(to));
        form.set('From', from);
        form.set('Body', String(text));
        res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: form.toString()
        });
      } catch {
        return { sent: false, reason: 'unreachable' };
      }
      return { sent: !!res.ok, reason: res.ok ? undefined : 'rejected' };
    }
  };
}

const disabledSms = {
  enabled: false,
  async send() {
    return { sent: false, reason: 'disabled' };
  }
};

export function smsTransport() {
  if (override) return override;
  const which = providerReady();
  if (which === 'http') return httpSender();
  if (which === 'twilio') return twilioSender();
  return disabledSms;
}

export function smsConfigured(req) {
  return !!smsTransport(req).enabled;
}
