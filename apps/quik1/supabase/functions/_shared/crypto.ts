// PIN and OTP hashing with WebCrypto. PINs: PBKDF2-SHA256, per-user salt.
// OTPs: HMAC-SHA256 with a server pepper (short-lived, rate-limited).
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

const ITER = 210_000;

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt.buffer)}$${await pbkdf2(pin, salt, ITER)}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2') return false;
  return timingSafeEqual(await pbkdf2(pin, unhex(salt), Number(iter)), hash);
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hmac(value: string): Promise<string> {
  const pepper = Deno.env.get('QUIK1_OTP_PEPPER');
  if (!pepper || pepper.length < 32) throw new Error('QUIK1_OTP_PEPPER must be set (32+ chars)');
  const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

export async function sha256(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

export function randomDigits(n: number): string {
  const out: string[] = [];
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (const v of buf) out.push(String(v % 10));
  return out.join('');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
