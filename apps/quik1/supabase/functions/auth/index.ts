// Quik1 sign-up and sign-in.
//
// Why a custom flow: the design uses a 4-digit SMS code and a 4-digit PIN.
// Supabase's built-in phone OTP is 6+ digits and has no PIN or device binding,
// so this function verifies the customer and then mints a normal Supabase
// session (admin generateLink → hashed token the app exchanges with verifyOtp).
//
// Actions (POST { action, ... }):
//   signup   { name, idnum, phone, email, employment, employer, income, payday, pin, consents }
//   status   { ref, phone }                → { status }  (sign-up review state)
//   start    { phone, idnum? }             → sends a 4-digit SMS code
//   verify   { phone, code, deviceId }     → { tokenHash }  (binds this device)
//   pin      { phone, pin, deviceId }      → { tokenHash }  (bound devices only)
//
// Error codes map 1:1 to the design's login toasts (see src/app/auth.ts).
import { admin } from '../_shared/supabase.ts';
import { AppError, handler, json } from '../_shared/http.ts';
import { hashPin, hmac, randomDigits, sha256, verifyPin } from '../_shared/crypto.ts';
import { sendSms } from '../_shared/sms.ts';
import { normalisePhone, validSaId } from '../_shared/validate.ts';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_SENDS = 3; // per phone per 15 minutes
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 30 * 60_000;
const TERMS_VERSION = 'quik1-terms-privacy-v1';
const CREDIT_CHECK_VERSION = 'quik1-credit-check-v1';

type Body = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

Deno.serve(handler(async (req) => {
  const body = (await req.json().catch(() => ({}))) as Body;
  switch (body.action) {
    case 'signup': return json(req, await signup(body));
    case 'status': return json(req, await status(body));
    case 'start': return json(req, await start(body));
    case 'verify': return json(req, await verify(body));
    case 'pin': return json(req, await pinLogin(body));
    default: throw new AppError('UNKNOWN_ACTION');
  }
}));

async function signup(b: Body) {
  const phone = normalisePhone(str(b.phone));
  const idnum = str(b.idnum);
  const name = str(b.name);
  const email = str(b.email).toLowerCase();
  const pin = str(b.pin);
  const income = Math.round(Number(String(b.income ?? '').replace(/\D/g, '')) * 100);
  const consents = (b.consents ?? {}) as { credit?: boolean; terms?: boolean };
  if (!/\S+\s+\S+/.test(name)) throw new AppError('BAD_NAME');
  if (!validSaId(idnum)) throw new AppError('BAD_ID');
  if (!phone) throw new AppError('BAD_PHONE');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('BAD_EMAIL');
  if (!/^\d{4}$/.test(pin) || /^(\d)\1{3}$/.test(pin) || '0123456789'.includes(pin)) throw new AppError('WEAK_PIN');
  if (!consents.credit || !consents.terms) throw new AppError('CONSENT_REQUIRED');

  const db = admin();
  const { data: existing } = await db.from('customers').select('id').or(`phone.eq.${phone},id_number.eq.${idnum}`).limit(1);
  if (existing?.length) throw new AppError('ALREADY_REGISTERED', 409);

  // Auth identity. The address is synthetic and never mailed — customers sign in by phone.
  const { data: created, error } = await db.auth.admin.createUser({
    email: `c-${crypto.randomUUID()}@customers.quik1.invalid`,
    email_confirm: true,
    phone,
    user_metadata: { kind: 'customer' },
  });
  if (error || !created.user) throw new Error(`createUser: ${error?.message}`);
  const uid = created.user.id;

  const { data: c, error: e2 } = await db.from('customers').insert({
    id: uid, full_name: name, id_number: idnum, phone, email,
    employment: str(b.employment) || null, employer: str(b.employer) || null,
    income_cents: Number.isFinite(income) ? income : 0, payday: str(b.payday) || null,
  }).select('ref').single();
  if (e2) {
    await db.auth.admin.deleteUser(uid);
    throw new Error(`insert customer: ${e2.message}`);
  }
  await db.from('customer_secrets').insert({ customer_id: uid, pin_hash: await hashPin(pin) });
  await db.from('consents').insert([
    { customer_id: uid, kind: 'credit_check', version: CREDIT_CHECK_VERSION },
    { customer_id: uid, kind: 'terms_privacy', version: TERMS_VERSION },
  ]);
  return { ref: c.ref, status: 'Pending review' };
}

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pending review', approved: 'Approved', declined: 'Declined', suspended: 'Declined',
};

async function status(b: Body) {
  const phone = normalisePhone(str(b.phone));
  const { data } = await admin().from('customers').select('status').eq('ref', str(b.ref)).eq('phone', phone ?? '').maybeSingle();
  if (!data) throw new AppError('NOT_FOUND', 404);
  return { status: STATUS_LABEL[data.status] };
}

async function customerByPhone(phone: string) {
  const { data } = await admin().from('customers').select('id, id_number, status').eq('phone', phone).maybeSingle();
  return data as { id: string; id_number: string; status: string } | null;
}

function gate(c: { status: string } | null) {
  if (!c) throw new AppError('NO_ACCOUNT', 404);
  if (c.status === 'pending_review') throw new AppError('IN_REVIEW', 403);
  if (c.status !== 'approved') throw new AppError('NOT_APPROVED', 403);
}

async function start(b: Body) {
  const phone = normalisePhone(str(b.phone));
  if (!phone) throw new AppError('BAD_PHONE');
  const c = await customerByPhone(phone);
  if (b.idnum !== undefined && c && c.id_number !== str(b.idnum)) throw new AppError('ID_MISMATCH', 403);
  gate(c);

  const db = admin();
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await db.from('otp_challenges').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since);
  if ((count ?? 0) >= OTP_MAX_SENDS) throw new AppError('TOO_MANY_CODES', 429);

  const code = randomDigits(4);
  await db.from('otp_challenges').insert({ phone, code_hash: await hmac(`${phone}:${code}`), expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString() });
  await sendSms(phone, `Your Quik1 code is ${code}. It expires in 5 minutes. Quik1 will never ask you for this code.`);
  // Pilot/test only: expose the code when SMS is mocked AND explicitly enabled.
  const expose = Deno.env.get('QUIK1_SMS_PROVIDER') === 'mock' && Deno.env.get('QUIK1_DEV_EXPOSE_OTP') === 'true';
  return { sent: true, ...(expose ? { devCode: code } : {}) };
}

async function verify(b: Body) {
  const phone = normalisePhone(str(b.phone));
  const code = str(b.code);
  const deviceId = str(b.deviceId);
  if (!phone || !/^\d{4}$/.test(code) || deviceId.length < 16) throw new AppError('BAD_REQUEST');
  const db = admin();
  const { data: ch } = await db.from('otp_challenges').select('*').eq('phone', phone).is('consumed_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!ch || new Date(ch.expires_at).getTime() < Date.now()) throw new AppError('CODE_EXPIRED', 401);
  if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('TOO_MANY_ATTEMPTS', 429);
  if (ch.code_hash !== (await hmac(`${phone}:${code}`))) {
    await db.from('otp_challenges').update({ attempts: ch.attempts + 1 }).eq('id', ch.id);
    throw new AppError('WRONG_CODE', 401);
  }
  await db.from('otp_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', ch.id);
  const c = await customerByPhone(phone);
  gate(c);
  await db.from('devices').upsert(
    { customer_id: c!.id, device_hash: await sha256(deviceId), last_seen_at: new Date().toISOString(), revoked: false },
    { onConflict: 'customer_id,device_hash' },
  );
  return { tokenHash: await sessionToken(c!.id) };
}

async function pinLogin(b: Body) {
  const phone = normalisePhone(str(b.phone));
  const pin = str(b.pin);
  const deviceId = str(b.deviceId);
  if (!phone || !/^\d{4}$/.test(pin) || deviceId.length < 16) throw new AppError('BAD_REQUEST');
  const c = await customerByPhone(phone);
  gate(c);
  const db = admin();
  const { data: dev } = await db.from('devices').select('id, revoked').eq('customer_id', c!.id).eq('device_hash', await sha256(deviceId)).maybeSingle();
  if (!dev || dev.revoked) throw new AppError('DEVICE_NOT_VERIFIED', 403);

  const { data: sec } = await db.from('customer_secrets').select('*').eq('customer_id', c!.id).single();
  if (sec.locked_until && new Date(sec.locked_until).getTime() > Date.now()) throw new AppError('PIN_LOCKED', 423);
  if (!(await verifyPin(pin, sec.pin_hash))) {
    const failures = sec.pin_failures + 1;
    await db.from('customer_secrets').update({
      pin_failures: failures >= PIN_MAX_FAILURES ? 0 : failures,
      locked_until: failures >= PIN_MAX_FAILURES ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null,
    }).eq('customer_id', c!.id);
    throw new AppError(failures >= PIN_MAX_FAILURES ? 'PIN_LOCKED' : 'WRONG_PIN', 401);
  }
  await db.from('customer_secrets').update({ pin_failures: 0, locked_until: null }).eq('customer_id', c!.id);
  await db.from('devices').update({ last_seen_at: new Date().toISOString() }).eq('id', dev.id);
  return { tokenHash: await sessionToken(c!.id) };
}

/** One-time token the app exchanges for a session: supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }). */
async function sessionToken(uid: string): Promise<string> {
  const db = admin();
  const { data: u, error } = await db.auth.admin.getUserById(uid);
  if (error || !u.user?.email) throw new Error('user lookup failed');
  const { data, error: e2 } = await db.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  if (e2 || !data.properties?.hashed_token) throw new Error(`generateLink: ${e2?.message}`);
  return data.properties.hashed_token;
}
