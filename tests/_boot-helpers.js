// Shared plumbing for the Playwright boot tests (tests/boot-*.test.js): the mock API + static
// server from tools/mock-api.js and a headless Chromium resolved from the global Playwright install
// (see tests/README.md). Nothing here is a test; the file name keeps it out of `*.test.js` globs.
import { createRequire } from 'node:module';
import { startMockApi } from '../tools/mock-api.js';

export const LEDGER_KEY = 'testkey';
export const BOOT_TIMEOUT_MS = 15000;

// Console noise the design-frozen apps always produce: SVG/date attribute parsing of the
// uncompiled template and the unreachable external feeds. Everything else is reported.
const KNOWN_PAGE_ERRORS = [/attribute\s+\w+:\s+Expected/i, /\{\{\s*[\w.]+\s*\}\}/, /does not conform to the required format/i];
export function isKnownPageError(msg) { return KNOWN_PAGE_ERRORS.some(re => re.test(String(msg))); }

export function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); }
  catch { return null; } // the caller skips the test with a clear message
}

export async function launchBrowser(chromium, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const pageErrors = [], consoleErrors = [], notFound = [];
  page.on('pageerror', e => pageErrors.push(String((e && e.message) || e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => { if (r.status() === 404) notFound.push(r.url()); });
  return { browser, context, page, pageErrors, consoleErrors, notFound };
}

export async function withMockApi(fn) {
  const api = await startMockApi({ key: LEDGER_KEY, quiet: true });
  try { return await fn(api); } finally { await api.close(); }
}

export const bodyText = page => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));

// Polls `fn()` in the page until it returns a truthy value or the deadline passes.
export async function pageWaitFor(page, fn, arg, { timeoutMs = 10000, polling = 250 } = {}) {
  return page.waitForFunction(fn, arg, { timeout: timeoutMs, polling });
}

// React's root listener receives a dispatched click even when a modal/overlay sits above the
// element, so navigation works without poking at the frozen UI's overlays.
export async function clickText(page, text) {
  const loc = page.getByText(text, { exact: true }).first();
  await loc.waitFor({ state: 'attached', timeout: 5000 });
  await loc.dispatchEvent('click');
}
