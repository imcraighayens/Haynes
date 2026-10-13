// Production stand-in for the prototype's `window.Quik1Link` (a localStorage
// bus to a simulated admin console). The design's logic calls it for sign-ups
// and subscribes for status changes; here those go to the server.
import { api } from './api';
import { notice, type ApiError } from './errors';
import type { Quik1App } from './Quik1App';

type LinkState = { applications: unknown[]; decisions: Record<string, unknown>; requests: unknown[]; signups: { id: string; status: string }[]; repayments: Record<string, unknown> };

export function installLiveLink(getApp: () => Quik1App | null) {
  const subs: ((s: LinkState) => void)[] = [];
  const state: LinkState = { applications: [], decisions: {}, requests: [], signups: [], repayments: {} };
  const emit = () => subs.forEach((fn) => fn(state));

  (window as unknown as { Quik1Link: unknown }).Quik1Link = {
    getState: () => state,
    subscribe(fn: (s: LinkState) => void) {
      subs.push(fn);
      fn(state);
      return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    // Called synchronously by the design's sign-up step 3 after its own validation.
    submitSignup(rec: Record<string, unknown>) {
      const app = getApp();
      const u = (app?.state.su || {}) as Record<string, unknown>;
      const phone = '+27' + String(u.phone || '').replace(/\D/g, '');
      api.signup({ ...rec, phone, pin: u.pin, consents: { credit: !!u.credit, terms: !!u.terms } })
        .then((r) => {
          state.signups = [{ id: r.ref, status: r.status }];
          app?.setState({ suRef: r.ref });
          app?.pollSignup(r.ref, phone, (status) => { state.signups = [{ id: r.ref, status }]; emit(); });
        })
        .catch((e: ApiError) => {
          const n = notice(e);
          const step = ['BAD_NAME', 'BAD_ID', 'BAD_PHONE', 'BAD_EMAIL', 'ALREADY_REGISTERED'].includes(e.code) ? 1 : 3;
          app?.setState((st: Record<string, any>) => ({ screen: 'signup', su: { ...st.su, step }, suError: n.body }));
        });
      return '…';
    },
    submitApplication: () => null, // submitted by Quik1App.runDecision()
    submitRequest(r: { type: string; detail: string }) {
      api.sendSupport(`[Request] ${r.type}: ${r.detail}`).catch(() => {});
    },
  };

  // The assistant: the design calls window.claude.complete({ system, messages }).
  // The server ignores any client-side system prompt and builds its own.
  (window as unknown as { claude: unknown }).claude = {
    async complete({ messages }: { messages: { role: string; content: string }[] }) {
      if (!(await api.session())) throw new Error('signed out');
      return (await api.assistant(messages)).text;
    },
  };
}
