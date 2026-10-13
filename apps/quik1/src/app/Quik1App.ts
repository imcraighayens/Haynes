/* The production app: the delivered design's logic class, with every action
 * that touches money, identity or messages routed to the server.
 *
 * How it works: the design's renderVals() returns the values and handlers the
 * template binds to. In LIVE mode we keep all of it (so every screen looks and
 * moves exactly as delivered) and replace only the handlers below. Business
 * state (loan, profile, growth, chat) is hydrated from my_snapshot(); nothing
 * personal is written to device storage.
 *
 * Without a Supabase project (or with ?demo) this class adds two display
 * values and otherwise behaves exactly like the prototype.
 */
import Design from '../generated/logic';
import { LIVE } from './env';
import { api, type Snapshot } from './api';
import { ApiError, notice, type Notice } from './errors';
import { deviceStore } from './device';
import { biometricCheck } from './biometric';

type AnyState = Record<string, any>;
type Vals = Record<string, any>;

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const money = (n: number) => 'R ' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const MIN_DECIDING_MS = 3300; // the design's deciding animation

export function initials(name: string | undefined) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export class Quik1App extends (Design as any) {
  declare state: AnyState;
  declare setState: (u: AnyState | ((s: AnyState) => AnyState), cb?: () => void) => void;
  declare props: Vals;

  private busy = new Set<string>();
  private pollT?: ReturnType<typeof setInterval>;
  private unSupport?: () => void;
  private liT?: ReturnType<typeof setTimeout>;
  applicationId: string | null = null;

  constructor(props: Vals) {
    super(props);
    if (LIVE) {
      // No demo persona in production. Real values arrive with the snapshot.
      this.state = {
        ...this.state,
        profile: { name: '', idnum: '', email: '', mobile: '', bank: '' },
        chat: [],
        aiChat: [{ from: 'bot', text: 'Hi. I am Q1, the Quik1 assistant. Ask me about your balance, dates or limit.' }],
      };
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  componentDidMount() {
    super.componentDidMount();
    if (!LIVE) return;
    void (async () => {
      const [session, phone] = await Promise.all([api.session().catch(() => null), deviceStore().get('quik1.phone')]);
      // A returning device lands on "Good to see you again" (Face ID / PIN).
      if (session || phone) this.setState({ loginMode: 'return', loginIntro: false });
    })();
  }

  componentWillUnmount() {
    super.componentWillUnmount();
    clearInterval(this.pollT);
    this.unSupport?.();
  }

  // Business state lives on the server; keep it off the device.
  restore() { if (!LIVE) super.restore(); }
  persist(patch?: AnyState) { if (!LIVE) super.persist(patch); }

  // ── values for the template ────────────────────────────────────────────────
  renderVals(): Vals {
    const v: Vals = super.renderVals();
    const s = this.state;
    v.initials = initials(s.profile?.name);
    v.payoutLast4 = (String(s.profile?.bank || '').match(/(\d{4})\s*$/) || [])[1] || '····';
    if (!LIVE) return v;

    const orig: Vals = { ...v, nav: v.nav };
    v.onLiSubmit = () => this.idLogin();
    v.onBiometric = () => this.biometric();
    v.keypad = (v.keypad || []).map((k: Vals) => ({ ...k, onClick: () => this.key(k.label) }));
    v.nav = { ...v.nav, sendCode: () => this.sendCode(), accept: () => this.accept(orig.nav.accept) };
    v.onAgreeActivate = () => this.agree();
    v.onSettle = () => this.settle();
    v.onSend = () => this.send();
    v.onSaveProfile = () => this.saveProfile(orig.onSaveProfile);
    v.onPhotoChosen = (e: Event) => { orig.onPhotoChosen(e); this.uploadPhoto(e); };
    v.onLogout = () => this.logout(orig.onLogout);
    v.onProofChosen = (e: Event) => { const f = fileOf(e); orig.onProofChosen(e); if (f) this.uploadProof(f); };
    v.onDocChosen = (e: Event) => { const f = fileOf(e); const i = (this as any)._docIndex || 0; orig.onDocChosen(e); if (f) this.uploadStatement(f, [i]); };
    if (orig.onDocsChosen) v.onDocsChosen = (e: Event) => { const f = fileOf(e); orig.onDocsChosen(e); if (f) this.uploadStatement(f, [0, 1, 2]); };
    v.kycRows = (v.kycRows || []).map((r: Vals) => (r.key === 'id' ? { ...r, onClick: () => this.captureId() } : r));
    return v;
  }

  // ── sign-in ────────────────────────────────────────────────────────────────
  private toast(n: Notice, kind?: 'wait') {
    clearTimeout(this.liT);
    this.setState({ liToast: { title: n.title, body: n.body, kind }, authing: false });
    this.liT = setTimeout(() => this.setState({ liToast: null }), 5000);
  }

  private async once(key: string, fn: () => Promise<void>) {
    if (this.busy.has(key)) return;
    this.busy.add(key);
    try { await fn(); } finally { this.busy.delete(key); }
  }

  /** "Sign in" card: mobile + SA ID → SMS code. */
  private idLogin() {
    const s = this.state;
    if ((s.liPhone || '').length !== 9) { this.setState({ liError: 'Enter the 9 digits after +27.' }); return this.toast(notice(new ApiError('BAD_PHONE'))); }
    if (!/^\d{13}$/.test(s.liId || '')) { this.setState({ liError: 'Your SA ID number has 13 digits.' }); return this.toast({ title: 'Check your ID number', body: 'South African ID numbers have exactly 13 digits.' }); }
    return this.once('login', async () => {
      this.setState({ authing: true, liToast: null });
      try {
        const r = await api.sendCode('+27' + s.liPhone, s.liId);
        this.setState({ authing: false, phone: s.liPhone, loginMode: 'new', otpMode: true, otp: '', loginIntro: false });
        if (r.devCode) this.toast({ title: 'Pilot: SMS not sent', body: 'Your code is ' + r.devCode + '.' }, 'wait');
      } catch (e) {
        this.toast(notice(e), (e as ApiError).code === 'IN_REVIEW' ? 'wait' : undefined);
      }
    });
  }

  /** "Let's get you started" phone step → SMS code. */
  private sendCode() {
    const s = this.state;
    if (digits(s.phone).length < 9) return this.setState({ phoneError: 'Enter a 9-digit mobile number, e.g. 82 000 0000' });
    return this.once('login', async () => {
      try {
        const r = await api.sendCode(digits(s.phone));
        this.setState({ phoneError: '', otpMode: true, otp: '' });
        if (r.devCode) this.toast({ title: 'Pilot: SMS not sent', body: 'Your code is ' + r.devCode + '.' }, 'wait');
      } catch (e) {
        const n = notice(e);
        this.setState({ phoneError: n.body });
        this.toast(n);
      }
    });
  }

  /** Keypad: 4 digits = SMS code (or PIN in PIN mode). */
  private key(k: string) {
    if (!k) return;
    if (k === '⌫') return this.setState((st) => ({ otp: st.otp.slice(0, -1) }));
    const next = (this.state.otp + k).slice(0, 4);
    this.setState({ otp: next });
    if (next.length === 4) void this.submitCode(next);
  }

  private submitCode(code: string) {
    return this.once('code', async () => {
      const pin = this.state.loginMode === 'pin';
      try {
        if (pin) {
          const phone = await deviceStore().get('quik1.phone');
          if (!phone) throw new ApiError('NO_SAVED_ACCOUNT');
          await api.pinLogin(phone, code);
        } else {
          await api.verifyCode(digits(this.state.phone), code);
          await deviceStore().set('quik1.phone', '+27' + digits(this.state.phone).slice(-9));
        }
        await this.afterLogin();
      } catch (e) {
        this.setState({ otp: '' });
        this.toast(notice(e));
      }
    });
  }

  private biometric() {
    return this.once('login', async () => {
      if (this.state.authing) return;
      if (!(await api.session())) return this.toast(notice(new ApiError('NO_SAVED_ACCOUNT')));
      this.setState({ authing: true, faceErr: false });
      const ok = await biometricCheck(digits(this.state.phone));
      if (!ok) return this.setState({ authing: false, faceErr: true });
      try { await this.afterLogin(); } catch (e) { this.toast(notice(e)); }
    });
  }

  private async afterLogin() {
    const snap = await this.hydrate();
    if (!snap || snap.status !== 'approved') {
      await api.signOut();
      throw new ApiError(snap?.status === 'pending_review' ? 'IN_REVIEW' : 'NOT_APPROVED');
    }
    const borrowed = !!snap.activeLoan || snap.closedLoans.length > 0 || snap.baseAmount > 0;
    this.setState({ authing: false, otp: '', otpMode: false, liToast: null, screen: borrowed ? 'home' : 'who' });
    this.unSupport?.();
    this.unSupport = api.onSupport(() => void this.refreshChat());
  }

  private async logout(designLogout: () => void) {
    await api.signOut().catch(() => {});
    this.unSupport?.();
    this.applicationId = null;
    designLogout();
  }

  // ── data ───────────────────────────────────────────────────────────────────
  async hydrate(): Promise<Snapshot | null> {
    const snap = await api.snapshot();
    if (!snap) return null;
    const first = snap.profile.name.split(' ')[0];
    const docs = snap.documents;
    this.setState((st) => ({
      customer: !!snap.activeLoan || snap.closedLoans.length > 0 || snap.baseAmount > 0,
      activeLoan: snap.activeLoan,
      closedLoans: snap.closedLoans,
      baseAmount: snap.baseAmount,
      interestPaid: snap.interestPaid,
      graduated: snap.graduated,
      profile: snap.profile,
      mandateSigned: snap.mandateSigned,
      chat: snap.chat,
      phone: digits(snap.profile.mobile).slice(-9),
      // documents already on file don't need uploading again
      ...(docs.statements ? { docChecks: [0, 1, 2].map(() => ({ state: 'ok', file: 'On file' })) } : {}),
      ...(docs.proof ? { proof: 'On file' } : {}),
      ...(docs.id ? { kyc: Array.from(new Set([...(st.kyc || []), 'id'])) } : {}),
      aiChat: (st.aiChat || []).length <= 1
        ? [{ from: 'bot', text: 'Hi ' + first + '. I am Q1, the Quik1 assistant. Ask me about your balance, dates or limit.' }]
        : st.aiChat,
    }));
    if (snap.photoPath) api.photoUrl(snap.photoPath).then((url) => url && this.setState({ photo: url })).catch(() => {});
    return snap;
  }

  private async refreshChat() {
    const snap = await api.snapshot().catch(() => null);
    if (snap) this.setState({ chat: snap.chat });
  }

  // ── application ────────────────────────────────────────────────────────────
  /** Both entry points (new applicant submit, returning customer top-up) end
   *  here. Same ticks as the design, but the offer screen waits for the server. */
  runDecision() {
    if (!LIVE) return super.runDecision();
    const t0 = Date.now();
    this.setState({ decisionTick: 0 });
    [900, 1700, 2500].forEach((ms, i) => setTimeout(() => this.setState({ decisionTick: i + 1 }), ms));
    const s = this.state;
    const term = (this as any).activeTerm() || 1;
    const purpose = s.purpose === 'Other' ? s.purposeOther : s.purpose;
    const income = Number(digits(s.income || s.estIncome)) || 0;
    const expenses = Number(digits(s.estExpenses)) || 0;
    const after = (fn: () => void) => setTimeout(fn, Math.max(0, MIN_DECIDING_MS - (Date.now() - t0)));
    api.submitApplication({ amount: s.amount, term, purpose, income, expenses })
      .then((a) => after(() => {
        this.applicationId = a.id;
        if (a.verdict === 'approved' && a.offer_cents) {
          this.setState({ linkDecision: { verdict: 'approved', amount: a.offer_cents / 100, at: Date.now() }, screen: 'offer' });
        } else if (a.verdict === 'referred') {
          this.setState({ screen: 'home', docError: { title: 'A person is checking this one', body: 'Your application needs a quick look from our credit team. We will SMS you within one business hour.', index: -1 } });
        } else {
          this.setState({ screen: 'home', docError: { title: 'We cannot offer this loan right now', body: 'Based on your statements and income, this repayment would be too tight. You can apply again next month.', index: -1 } });
        }
      }))
      .catch((e) => after(() => {
        const n = notice(e);
        this.setState({ screen: s.customer ? 'purpose' : 'kyc', docError: { ...n, index: -1 } });
      }));
  }

  /** Offer → (debit order agreement) → loan. */
  private accept(designAccept: () => void) {
    const s = this.state;
    // Without an approved debit order the design opens the agreement sheet; let it.
    if (!s.mandateSigned || !this.applicationId) return designAccept();
    if (!s.terms) return this.setState({ offerError: 'Tick the box to accept the agreement.' });
    return this.once('accept', async () => {
      try {
        await api.acceptOffer(this.applicationId!, true);
        this.applicationId = null;
        await this.hydrate();
        this.setState({ offerError: '', pendingAccept: false, screen: 'tracker', customer: true, menuOpen: false, panelPhase: 'in', payoutAt: Date.now() });
      } catch (e) {
        if ((e as ApiError).code === 'MANDATE_REQUIRED') {
          this.setState({ mandateSigned: false }, () => designAccept());
          return;
        }
        this.setState({ offerError: notice(e).body });
      }
    });
  }

  /** "Sign and activate" on the agreement sheet: records consent + DebiCheck mandate. */
  private agree() {
    const s = this.state;
    if (!s.agTicked) return;
    const resume = !!s.pendingAccept;
    return this.once('agree', async () => {
      try {
        await api.signAgreement(resume ? this.applicationId : null);
        const L = s.activeLoan || {};
        this.setState({
          mandateSigned: true, agreement: null, agreementLast: null,
          sentNote: resume ? 'Debit order locked in. Paying out your loan now.' : 'Contract signed. Your debit order is on — ' + money(L.monthly || L.total || 0) + ' on ' + this.dueLabel() + '.',
        }, () => { if (resume) setTimeout(() => this.accept(() => {}), 300); });
      } catch (e) {
        this.setState({ agreement: null, offerError: notice(e).body });
      }
    });
  }

  private settle() {
    const s = this.state;
    if (!s.payMethod || !s.activeLoan) return;
    return this.once('settle', async () => {
      const before = s.baseAmount || 0;
      try {
        const col = await api.settle();
        const snap = await this.hydrate();
        if (col.status !== 'paid') {
          this.setState({ sentNote: 'Collection requested. We will confirm once your bank releases the payment.' });
          return;
        }
        this.setState({
          screen: 'home', menuOpen: false, panelPhase: 'in', mandateSigned: false,
          ...(snap && snap.baseAmount > before ? { upgradeTo: snap.baseAmount, docError: null } : {}),
        });
      } catch (e) {
        this.setState({ sentNote: notice(e).body });
      }
    });
  }

  private dueLabel() {
    const now = new Date();
    let d = new Date(now.getFullYear(), now.getMonth(), 24);
    if (d <= now) d = new Date(now.getFullYear(), now.getMonth() + 1, 24);
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ── documents ──────────────────────────────────────────────────────────────
  private async uploadStatement(file: File, slots: number[]) {
    try {
      let worst: { check_state?: string; check_reason?: string | null } = {};
      for (const i of slots) {
        const r = await api.upload('bank_statement', i, file);
        if (r.check_state === 'fail') worst = r;
      }
      if (worst.check_state === 'fail') {
        await settled(); // let the design's own check animation finish first
        this.setState((st) => {
          const next = (st.docChecks || []).slice();
          for (const i of slots) next[i] = { state: 'fail', file: file.name, reason: worst.check_reason || 'Could not verify' };
          return { docChecks: next };
        });
      }
    } catch (e) {
      await settled();
      this.setState((st) => {
        const next = (st.docChecks || []).slice();
        for (const i of slots) next[i] = { state: 'fail', file: file.name, reason: 'Upload failed — try again' };
        return { docChecks: next, docError: { ...notice(e), index: slots[0] } };
      });
    }
  }

  private async uploadProof(file: File) {
    try {
      const r = await api.upload('proof_of_income', 0, file);
      if (r.check_state === 'fail') this.setState({ proof: '', proofError: r.check_reason || 'We could not read that file.' });
    } catch {
      this.setState({ proof: '', proofError: 'Upload failed. Check your connection and try again.' });
    }
  }

  /** The design's ID row is a tap-to-capture; open the camera and upload. */
  private captureId() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const r = await api.upload('id_document', 0, f);
        if (r.check_state === 'ok') this.setState((st) => ({ kyc: Array.from(new Set([...(st.kyc || []), 'id'])), kycError: '' }));
        else this.setState({ kycError: r.check_reason || 'We could not read that photo. Try again in good light.' });
      } catch {
        this.setState({ kycError: 'Upload failed. Check your connection and try again.' });
      }
    };
    input.click();
  }

  private async uploadPhoto(e: Event) {
    const f = fileOf(e);
    if (!f) return;
    try {
      const { path } = await api.upload('photo', 0, f);
      await api.updateProfile(this.state.profile.email, path);
    } catch {
      this.setState({ sentNote: 'Photo not saved. Try again.' });
    }
  }

  private async saveProfile(designSave: () => void) {
    const s = this.state;
    if (!s.profileDirty) return;
    try {
      await api.updateProfile(s.profile.email);
      const snap = await api.snapshot();
      const identityChanged = snap && (snap.profile.name !== s.profile.name || digits(snap.profile.mobile) !== digits(s.profile.mobile));
      if (snap) this.setState({ profile: snap.profile });
      designSave();
      if (identityChanged) this.setState({ sentNote: 'Email saved. To change your name or number, message us in Help — we need to check it first.' });
    } catch (e) {
      this.setState({ sentNote: (e as ApiError).code === 'BAD_EMAIL' ? 'Enter a valid email address.' : notice(e).body });
    }
  }

  // ── help chat ──────────────────────────────────────────────────────────────
  private send() {
    const text = String(this.state.draft || '').trim();
    if (!text) return;
    this.setState((st) => ({ chat: [...st.chat, { from: 'me', text }], draft: '' }));
    api.sendSupport(text).catch(() => this.setState({ sentNote: 'Message not sent. Check your connection and try again.' }));
  }

  // ── sign-up status (design subscribes through Quik1Link) ───────────────────
  pollSignup(ref: string, phone: string, emit: (status: string) => void) {
    clearInterval(this.pollT);
    this.pollT = setInterval(async () => {
      if (this.state.screen !== 'signupPending') return clearInterval(this.pollT);
      try { emit((await api.signupStatus(ref, phone)).status); } catch { /* keep polling */ }
    }, 20_000);
  }
}

const settled = () => new Promise((r) => setTimeout(r, 1700));

function fileOf(e: Event): File | null {
  const t = e?.target as HTMLInputElement | null;
  return (t?.files && t.files[0]) || null;
}
