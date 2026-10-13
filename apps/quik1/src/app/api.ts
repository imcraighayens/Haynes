// Every network call the app makes. Amounts cross this boundary in rands (the
// design's unit) and are converted to cents for the server.
import { sb } from './supabase';
import { ApiError, codeOf } from './errors';
import { deviceId } from './device';

const cents = (rands: number) => Math.round(Number(rands || 0) * 100);

async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke(name, { body });
  if (error) {
    let code = 'SERVER_ERROR';
    try { code = (await (error as { context?: Response }).context?.json())?.error ?? code; } catch { /* not JSON */ }
    if ((error as Error).name === 'FunctionsFetchError') code = 'NETWORK';
    throw new ApiError(code);
  }
  return data as T;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw new ApiError(codeOf(error.message));
  return data as T;
}

async function exchange(tokenHash: string) {
  const { error } = await sb().auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error) throw new ApiError('SERVER_ERROR');
}

export const api = {
  // ── account ───────────────────────────────────────────────────────────────
  signup: (rec: Record<string, unknown>) => fn<{ ref: string; status: string }>('auth', { action: 'signup', ...rec }),
  signupStatus: (ref: string, phone: string) => fn<{ status: string }>('auth', { action: 'status', ref, phone }),
  sendCode: (phone: string, idnum?: string) => fn<{ sent: boolean; devCode?: string }>('auth', { action: 'start', phone, ...(idnum ? { idnum } : {}) }),
  async verifyCode(phone: string, code: string) {
    const r = await fn<{ tokenHash: string }>('auth', { action: 'verify', phone, code, deviceId: await deviceId() });
    await exchange(r.tokenHash);
  },
  async pinLogin(phone: string, pin: string) {
    const r = await fn<{ tokenHash: string }>('auth', { action: 'pin', phone, pin, deviceId: await deviceId() });
    await exchange(r.tokenHash);
  },
  async session() { return (await sb().auth.getSession()).data.session; },
  signOut: () => sb().auth.signOut(),

  // ── data ──────────────────────────────────────────────────────────────────
  snapshot: () => rpc<Snapshot | null>('my_snapshot'),
  async pricing() {
    const { data } = await sb().from('products').select('term_months, charge_bps').eq('active', true);
    return (data ?? []) as { term_months: number; charge_bps: number }[];
  },

  async upload(kind: 'bank_statement' | 'proof_of_income' | 'id_document' | 'photo', slot: number, file: File): Promise<{ path: string; check_state?: string; check_reason?: string | null }> {
    const uid = (await sb().auth.getUser()).data.user?.id;
    if (!uid) throw new ApiError('UNAUTHENTICATED');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${uid}/${kind}/${Date.now()}-${slot}.${ext}`;
    const { error } = await sb().storage.from('documents').upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (error) throw new ApiError('UPLOAD_FAILED');
    if (kind === 'photo') return { path };
    const doc = await rpc<{ check_state: string; check_reason: string | null }>('register_document', { p_kind: kind, p_slot: slot, p_path: path, p_file_name: file.name });
    return { path, ...doc };
  },

  submitApplication: (a: { amount: number; term: number; purpose: string; income: number; expenses: number }) =>
    rpc<{ id: string; verdict: 'approved' | 'referred' | 'declined'; offer_cents: number | null; flags: string[] }>('submit_application', {
      p_amount_cents: cents(a.amount), p_term: a.term, p_purpose: a.purpose, p_income_cents: cents(a.income), p_expenses_cents: cents(a.expenses),
    }),
  signAgreement: (applicationId: string | null) => rpc('sign_agreement', { p_application_id: applicationId }),
  acceptOffer: (applicationId: string, termsAccepted: boolean) => rpc('accept_offer', { p_application_id: applicationId, p_terms_accepted: termsAccepted }),
  settle: () => rpc<{ status: string }>('request_settlement'),
  updateProfile: (email: string, photoPath?: string) => rpc('update_profile', { p_email: email, p_photo_path: photoPath ?? null }),
  async photoUrl(path: string) {
    const { data } = await sb().storage.from('documents').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  },

  async sendSupport(body: string) {
    const uid = (await sb().auth.getUser()).data.user?.id;
    const { error } = await sb().from('support_messages').insert({ customer_id: uid, sender: 'customer', body });
    if (error) throw new ApiError('SERVER_ERROR');
  },
  onSupport(cb: () => void) {
    const ch = sb().channel('support').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages' }, cb).subscribe();
    return () => { sb().removeChannel(ch); };
  },

  assistant: (messages: { role: string; content: string }[]) => fn<{ text: string }>('assistant', { messages }),
};

export type Snapshot = {
  status: 'pending_review' | 'approved' | 'declined' | 'suspended';
  ref: string;
  profile: { name: string; idnum: string; email: string; mobile: string; bank: string };
  photoPath?: string | null;
  baseAmount: number; interestPaid: number; graduated: boolean; stars: number; headroom: number;
  mandateSigned: boolean; dueDate: string;
  activeLoan: null | { id: string; ref: string; a: number; total: number; term: number; monthly: number; draws: unknown[] };
  closedLoans: unknown[];
  chat: { from: 'me' | 'them'; text: string }[];
  documents: { statements: boolean; proof: boolean; id: boolean };
};
