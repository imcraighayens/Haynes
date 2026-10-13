// Face ID / fingerprint gate for a device that already has a session.
// Native builds register a plugin-backed check (src/native.ts); the web falls
// back to a platform passkey, as in the delivered design — minus its demo
// bypass: a failed or unavailable check never signs anyone in.
type Check = (label: string) => Promise<boolean>;

let nativeCheck: Check | null = null;
export const setBiometric = (fn: Check) => { nativeCheck = fn; };

const KEY = 'quik1_faceid_cred';
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (t: string) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function biometricCheck(label: string): Promise<boolean> {
  if (nativeCheck) return nativeCheck(label);
  try {
    const pk = window.PublicKeyCredential;
    if (!pk || !window.isSecureContext || !(await pk.isUserVerifyingPlatformAuthenticatorAvailable())) return false;
    const saved = localStorage.getItem(KEY);
    if (saved) {
      await navigator.credentials.get({ publicKey: { challenge: rnd(32), timeout: 60000, userVerification: 'required', allowCredentials: [{ type: 'public-key', id: unb64(saved), transports: ['internal'] }] } });
    } else {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: rnd(32), timeout: 60000, rp: { name: 'Quik1' },
          user: { id: rnd(16), name: '+27' + (label || 'customer'), displayName: 'Quik1 customer' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        },
      })) as PublicKeyCredential;
      localStorage.setItem(KEY, b64(cred.rawId));
    }
    return true;
  } catch {
    return false;
  }
}
