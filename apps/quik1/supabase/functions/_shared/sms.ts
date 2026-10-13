// SMS provider seam. QUIK1_SMS_PROVIDER = mock | clickatell | twilio.
// `mock` sends nothing; it exists for the closed pilot and tests.
export interface SmsResult { provider: string; id?: string }

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const provider = Deno.env.get('QUIK1_SMS_PROVIDER') ?? 'mock';
  if (provider === 'mock') {
    console.log(`[sms:mock] to ${to.slice(0, 6)}••••`);
    return { provider };
  }
  if (provider === 'clickatell') {
    const r = await fetch('https://platform.clickatell.com/messages', {
      method: 'POST',
      headers: { authorization: Deno.env.get('CLICKATELL_API_KEY')!, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ messages: [{ channel: 'sms', to: to.replace('+', ''), content: body }] }),
    });
    if (!r.ok) throw new Error(`clickatell ${r.status}`);
    const j = await r.json();
    return { provider, id: j?.messages?.[0]?.apiMessageId };
  }
  if (provider === 'twilio') {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID')!;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: 'Basic ' + btoa(`${sid}:${Deno.env.get('TWILIO_AUTH_TOKEN')}`),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: Deno.env.get('TWILIO_FROM')!, Body: body }),
    });
    if (!r.ok) throw new Error(`twilio ${r.status}`);
    return { provider, id: (await r.json()).sid };
  }
  throw new Error(`unknown SMS provider ${provider}`);
}
