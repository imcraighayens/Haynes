// Visual parity check: drives the delivered prototype and the built app into the
// same screen states and pixel-diffs them.
//
//   npm run build && npx vite preview --port 4173 &   (or set PARITY_URL)
//   npm run parity
//
// Output: parity-output/<scenario>.{orig,port,diff}.png and a summary table.
// Exit code 1 if any scenario differs by more than its budget (default 1%).
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = 'file://' + join(root, '../../docs/quik1/design-source/quik1-prototype.html');
const PORT = (process.env.PARITY_URL || 'http://localhost:4173/') + '?parity=1';
const OUT = join(root, 'parity-output');
const VIEWPORTS = (process.env.PARITY_VIEWPORTS || '440x940').split(',').map((s) => s.split('x').map(Number));
const DEFAULT_BUDGET = 0.01;

// Scenarios: a state patch applied to the logic once the splash has finished.
// `call` names logic methods whose return values are merged in (evaluated in-page).
const customer = { customer: true, mandateSigned: true, call: ['seedLoan:activeLoan', 'seedGrowth:*'] };
const SCENARIOS = [
  { id: 'splash', atMs: 1500, budget: Infinity, note: 'intentional: illustration removed' },
  { id: 'login' },
  { id: 'signup-1', state: { screen: 'signup', su: { step: 1 } } },
  { id: 'signup-2', state: { screen: 'signup', su: { step: 2 } } },
  { id: 'signup-3', state: { screen: 'signup', su: { step: 3 } } },
  { id: 'signup-pending', state: { screen: 'signupPending' } },
  { id: 'estimate', state: { screen: 'estimate' } },
  { id: 'flow-who', state: { screen: 'who' } },
  { id: 'flow-amount', state: { screen: 'amount' } },
  { id: 'flow-purpose', state: { screen: 'purpose' } },
  { id: 'flow-eligibility', state: { screen: 'eligibility' } },
  { id: 'flow-docs', state: { screen: 'docs' } },
  { id: 'flow-kyc', state: { screen: 'kyc' } },
  { id: 'flow-offer', state: { screen: 'offer' } },
  { id: 'home', state: { screen: 'home', ...customer } },
  { id: 'home-light', state: { screen: 'home', homeLight: true, ...customer } },
  { id: 'home-menu', state: { screen: 'home', menuOpen: true, ...customer } },
  ...['accounts', 'loan', 'activity', 'schedule', 'statements', 'support', 'profile', 'tracker', 'documents', 'performance', 'credit'].map((s) => ({
    id: 'sheet-' + s,
    state: { screen: s, ...customer },
  })),
  { id: 'assistant', state: { screen: 'home', aiOpen: true, ...customer } },
];

// Same seeded Math.random in both pages so the assistant's moods and bubbles match.
const DETERMINISM = `
  (() => { let s = 0x2f6b; Math.random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
  window.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}';
    (document.head || document.documentElement).appendChild(st);
  });
`;

// Find the logic host: our ?parity hook, or (prototype) the runtime's component via React fiber.
const FIND_HOST = `window.__findHost = () => {
  if (window.__quik1Host) return window.__quik1Host;
  const el = document.querySelector('.sc-host');
  if (!el) return null;
  const k = Object.keys(el).find((x) => x.startsWith('__reactFiber$'));
  for (let f = el[k]; f; f = f.return) if (f.stateNode && f.stateNode.__setLogicState) return f.stateNode;
  return null;
};`;

async function capture(browser, url, sc, [w, h]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-08-20T09:00:00+02:00') });
  await page.addInitScript(DETERMINISM + FIND_HOST);
  await page.goto(url);
  await page.waitForFunction(() => window.__findHost() !== null, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(sc.atMs ?? 6000);
  if (sc.state) {
    await page.evaluate(
      (patch) => {
        const host = window.__findHost();
        const L = host.logic;
        const { call = [], ...state } = patch;
        for (const c of call) {
          const [fn, key] = c.split(':');
          const v = L[fn]();
          if (key === '*') Object.assign(state, v);
          else state[key] = v;
        }
        host.__setLogicState({ panelPhase: '', pageOut: false, closing: '', ...state });
      },
      sc.state,
    );
    await page.clock.runFor(1500);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const png = await page.screenshot();
  await page.close();
  return { png, errors };
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const rows = [];
let failed = 0;
for (const vp of VIEWPORTS) {
  for (const sc of SCENARIOS) {
    if (only && !only.test(sc.id)) continue;
    const tag = `${sc.id}@${vp[0]}x${vp[1]}`;
    const [a, b] = await Promise.all([capture(browser, ORIGINAL, sc, vp), capture(browser, PORT, sc, vp)]);
    const A = PNG.sync.read(a.png), B = PNG.sync.read(b.png);
    const diff = new PNG({ width: A.width, height: A.height });
    const n = pixelmatch(A.data, B.data, diff.data, A.width, A.height, { threshold: 0.1 });
    const pct = n / (A.width * A.height);
    writeFileSync(join(OUT, `${tag}.orig.png`), a.png);
    writeFileSync(join(OUT, `${tag}.port.png`), b.png);
    writeFileSync(join(OUT, `${tag}.diff.png`), PNG.sync.write(diff));
    const budget = sc.budget ?? DEFAULT_BUDGET;
    const ok = pct <= budget;
    if (!ok) failed++;
    rows.push({ scenario: tag, diff: (pct * 100).toFixed(3) + '%', ok: ok ? 'PASS' : 'FAIL', note: sc.note || '', portErrors: b.errors.length, origErrors: a.errors.length });
    if (b.errors.length) console.error(tag, 'port errors:', b.errors.slice(0, 3));
  }
}
await browser.close();
console.table(rows);
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(rows, null, 2));
process.exit(failed ? 1 : 0);
