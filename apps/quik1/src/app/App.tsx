import { useEffect, useRef, useState } from 'react';
import { DCHost } from '../runtime/DCHost';
import { renderTemplate } from '../generated/template';
import { Quik1App } from './Quik1App';
import { designDefaults } from './props';
import { LIVE } from './env';
import { api } from './api';
import { installLiveLink } from './link';

// ?parity=1 exposes the host so scripts/parity.mjs can drive the app into a
// given screen state and compare it with the delivered prototype.
const parity = typeof location !== 'undefined' && new URLSearchParams(location.search).has('parity');

let hostRef: DCHost | null = null;
if (LIVE) installLiveLink(() => (hostRef?.logic as unknown as Quik1App) ?? null);

export function App() {
  const [props, setProps] = useState<Record<string, unknown>>(() => ({
    ...designDefaults(),
    // Production lending rules: the demo-only withdraw unlock is off.
    ...(LIVE ? { demoWithdrawUnlocked: false } : {}),
  }));
  const ref = useRef<DCHost | null>(null);

  useEffect(() => {
    if (!LIVE) return;
    // Every price shown comes from the server's product table.
    api.pricing().then((rows) => {
      const one = rows.find((r) => r.term_months === 1);
      if (one) setProps((p) => ({ ...p, interestRate: one.charge_bps / 100 }));
    }).catch(() => {});
  }, []);

  return (
    <DCHost
      ref={(h) => {
        ref.current = h;
        hostRef = h;
        if (parity) (window as unknown as { __quik1Host?: DCHost | null }).__quik1Host = h;
      }}
      Logic={Quik1App as never}
      render={renderTemplate}
      props={props}
    />
  );
}
