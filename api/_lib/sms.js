// Borrower SMS. The default provider sends nothing. A live provider is selected
// only when QUIK1_SMS=1 and the request is not a production host. Twilio env
// vars used by staff calls do not turn this on.
import { isProductionDeployment } from './quik1-flags.js';

export const disabledSms = {
  enabled: false,
  async send() {
    return { sent: false, reason: 'disabled' };
  }
};

let override = null;

export function setSmsProvider(provider) {
  override = provider || null;
}

export function borrowerSmsLive(req) {
  if (String(process.env.QUIK1_SMS || '').trim() !== '1') return false;
  if (isProductionDeployment(req)) return false;
  return true;
}

function envValue(name) {
  const v = String(process.env[name] || '').trim();
  return v || '';
}

// Not used unless borrowerSmsLive is true. The body is the message; callers
// must not log it.
function twilioSms() {
  const sid = envValue('TWILIO_ACCOUNT_SID');
  const token = envValue('TWILIO_AUTH_TOKEN');
  const from = envValue('TWILIO_FROM');
  if (!sid || !token || !from) return null;
  return {
    enabled: true,
    async send(to, body) {
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const form = new URLSearchParams({ To: String(to), From: from, Body: String(body) });
      let res;
      try {
        res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: form
        });
      } catch {
        return { sent: false, reason: 'unreachable' };
      }
      return { sent: !!res.ok, reason: res.ok ? undefined : 'rejected' };
    }
  };
}

export function smsProvider(req) {
  if (override) return override;
  if (!borrowerSmsLive(req)) return disabledSms;
  return twilioSms() || disabledSms;
}

// Digits only, E.164. Empty when the number cannot be sent to.
export function smsTo(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return '+27' + digits.slice(1);
  if (digits.length === 11 && digits.startsWith('27')) return '+' + digits;
  if (digits.length >= 10 && digits.length <= 15) return '+' + digits;
  return '';
}

export function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return '••••••' + digits.slice(-4);
}
