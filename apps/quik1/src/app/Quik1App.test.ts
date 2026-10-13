// Live-mode wiring: each design action reaches the right server call and
// lands on the design's own screen states. The API is mocked; the design's
// logic class is the real generated one.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./env', () => ({ LIVE: true, SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'k' }));
const api = vi.hoisted(() => ({
  session: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), pinLogin: vi.fn(), signOut: vi.fn(),
  snapshot: vi.fn(), submitApplication: vi.fn(), signAgreement: vi.fn(), acceptOffer: vi.fn(), settle: vi.fn(),
  sendSupport: vi.fn(), onSupport: vi.fn(() => () => {}), upload: vi.fn(), updateProfile: vi.fn(), photoUrl: vi.fn(),
  signup: vi.fn(), signupStatus: vi.fn(), pricing: vi.fn(), assistant: vi.fn(),
}));
vi.mock('./api', () => ({ api }));

import { Quik1App } from './Quik1App';
import { ApiError } from './errors';

const SNAP = {
  status: 'approved', ref: 'SU-1', photoPath: null,
  profile: { name: 'Lerato Nkosi', idnum: '8001015 009 087', email: 'l@example.com', mobile: '+27 72 555 0101', bank: 'FNB · ···· 1234' },
  baseAmount: 0, interestPaid: 0, graduated: false, stars: 1, headroom: 1000, mandateSigned: false, dueDate: '2026-10-24',
  activeLoan: null, closedLoans: [], chat: [], documents: { statements: false, proof: false, id: false },
};

function mount(): any {
  const app: any = new (Quik1App as any)({ interestRate: 35, adminApprovedAmount: 1000, demoWithdrawUnlocked: false });
  app.__host = {
    __setLogicState(u: any, cb?: () => void) {
      app.state = { ...app.state, ...(typeof u === 'function' ? u(app.state) : u) };
      cb?.();
    },
    forceUpdate() {},
  };
  return app;
}
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((f) => (f as any).mockReset?.());
  api.onSupport.mockReturnValue(() => {});
  api.snapshot.mockResolvedValue(SNAP);
  api.photoUrl.mockResolvedValue(null);
});

describe('production start state', () => {
  it('has no demo persona', () => {
    const app = mount();
    expect(app.state.profile.name).toBe('');
    expect(app.state.chat).toEqual([]);
    expect(JSON.stringify(app.state.aiChat)).not.toContain('Thandi');
  });
});

describe('sign in with mobile + ID', () => {
  it('sends a code, then the 4-digit code signs in and hydrates', async () => {
    const app = mount();
    api.sendCode.mockResolvedValue({ sent: true });
    api.verifyCode.mockResolvedValue(undefined);
    app.setState({ screen: 'login', loginMode: 'id', liPhone: '725550101', liId: '8001015009087' });
    app.renderVals().onLiSubmit();
    await tick();
    expect(api.sendCode).toHaveBeenCalledWith('+27725550101', '8001015009087');
    expect(app.state).toMatchObject({ loginMode: 'new', otpMode: true, phone: '725550101' });

    const keypad = app.renderVals().keypad;
    for (const d of ['4', '8', '2', '1']) keypad.find((k: any) => k.label === d).onClick();
    await tick();
    expect(api.verifyCode).toHaveBeenCalledWith('725550101', '4821');
    expect(app.state.profile.name).toBe('Lerato Nkosi');
    expect(app.state.screen).toBe('who'); // never borrowed → start an application
    expect(app.renderVals().initials).toBe('LN');
  });

  it('shows the design toast for an account still in review', async () => {
    const app = mount();
    api.sendCode.mockRejectedValue(new ApiError('IN_REVIEW'));
    app.setState({ screen: 'login', loginMode: 'id', liPhone: '725550101', liId: '8001015009087' });
    app.renderVals().onLiSubmit();
    await tick();
    expect(app.state.liToast).toMatchObject({ title: 'Account still in review', kind: 'wait' });
    expect(app.state.otpMode).toBeFalsy();
  });

  it('Face ID without a session never signs in (no demo bypass)', async () => {
    const app = mount();
    api.session.mockResolvedValue(null);
    app.renderVals().onBiometric();
    await tick(2000);
    expect(app.state.liToast.title).toBe('Sign in first');
    expect(app.state.screen).toBe('login');
  });
});

describe('application → offer → agreement → loan', () => {
  it('waits for the server decision, then shows the capped offer', async () => {
    const app = mount();
    api.submitApplication.mockResolvedValue({ id: 'app-1', verdict: 'approved', offer_cents: 100000, flags: [] });
    app.setState({ screen: 'kyc', amount: 2500, purpose: 'Groceries', income: '15000', estExpenses: '8000' });
    app.runDecision();
    await tick(1000);
    expect(app.state.screen).not.toBe('offer'); // the design's deciding animation still running
    await tick(2500);
    expect(api.submitApplication).toHaveBeenCalledWith({ amount: 2500, term: 1, purpose: 'Groceries', income: 15000, expenses: 8000 });
    expect(app.state.screen).toBe('offer');
    expect(app.adminCap()).toBe(1000);
  });

  it('a referred application tells the customer a person is checking', async () => {
    const app = mount();
    api.submitApplication.mockResolvedValue({ id: 'app-2', verdict: 'referred', offer_cents: null, flags: [] });
    app.setState({ amount: 2500, purpose: 'Rent' });
    app.runDecision();
    await tick(4000);
    expect(app.state.screen).toBe('home');
    expect(app.state.docError.title).toMatch(/person is checking/);
  });

  it('accept without a debit order opens the agreement; signing resumes the payout', async () => {
    const app = mount();
    app.applicationId = 'app-1';
    app.setState({ screen: 'offer', customer: false, terms: true, amount: 1000, mandateSigned: false,
      docChecks: [0, 1, 2].map(() => ({ state: 'ok', file: 'x.pdf' })), proof: 'p.pdf', kyc: ['id'] });
    app.renderVals().nav.accept();
    expect(app.state.agreement).toBeTruthy(); // design's agreement sheet
    expect(app.state.pendingAccept).toBe(true);
    expect(api.acceptOffer).not.toHaveBeenCalled();

    api.signAgreement.mockResolvedValue({ status: 'approved' });
    api.acceptOffer.mockResolvedValue({ id: 'loan-1' });
    api.snapshot.mockResolvedValue({ ...SNAP, baseAmount: 1000, mandateSigned: true,
      activeLoan: { id: 'loan-1', ref: 'QK-84214', a: 1000, total: 1350, term: 1, monthly: 1350, draws: [] } });
    app.setState({ agTicked: true });
    app.renderVals().onAgreeActivate();
    await tick(500);
    expect(api.signAgreement).toHaveBeenCalledWith('app-1');
    expect(api.acceptOffer).toHaveBeenCalledWith('app-1', true);
    expect(app.state.screen).toBe('tracker');
    expect(app.state.activeLoan.total).toBe(1350);
  });
});

describe('settle', () => {
  it('settles on the server and shows the limit upgrade when the base grows', async () => {
    const app = mount();
    app.setState({ screen: 'schedule', payMethod: 'debit', baseAmount: 1000, activeLoan: { a: 1000, total: 1350, term: 1, draws: [] } });
    api.settle.mockResolvedValue({ status: 'paid' });
    api.snapshot.mockResolvedValue({ ...SNAP, baseAmount: 2000, closedLoans: [{}] });
    app.renderVals().onSettle();
    await tick();
    expect(app.state).toMatchObject({ screen: 'home', activeLoan: null, upgradeTo: 2000, mandateSigned: false });
  });
});

describe('help chat', () => {
  it('posts to the server and does not fake a reply', async () => {
    const app = mount();
    api.sendSupport.mockResolvedValue(undefined);
    app.setState({ draft: 'Can I pay early?' });
    app.renderVals().onSend();
    await tick(2000);
    expect(api.sendSupport).toHaveBeenCalledWith('Can I pay early?');
    expect(app.state.chat).toEqual([{ from: 'me', text: 'Can I pay early?' }]);
  });
});
