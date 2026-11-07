// dev-live.js — the guards for `npm run dev:live`: tools/mock-api.js serving the apps locally
// against the REAL Supabase project named in .env instead of the in-memory fake.
//
// Everything a click on localhost could do to real borrowers or the real book is off unless
// the operator passes a flag for it:
//
//   --allow-writes   database writes (default: read-only; sign-in still works)
//   --allow-twilio   keep TWILIO_* so Admin call/SMS buttons reach real phones
//   --allow-webhook  keep Q1_WEBHOOK_URL so local chats notify CEO Q1
//   --prod           allow the production project (rcektqecduuzqqmcsgat)
//
// "Reset demo data" is forced off with no flag at all: localhost is not on the production host
// list in api/_lib/auth.js, so LEDGER_ALLOW_DEMO_RESET=true in .env would otherwise expose it
// against the real database.

export const PROD_SUPABASE_HOST = 'rcektqecduuzqqmcsgat.supabase.co';
const TWILIO_VARS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'];

// Checks and rewrites `env` (process.env in real use) in place. Returns the problems that must
// stop the server and the notes to print. Never echoes a secret value.
export function prepareLiveEnv(env, flags = {}) {
  const errors = [];
  const notes = [];
  const url = String(env.SUPABASE_URL || '').trim();
  let host = '';
  if (!url) errors.push('SUPABASE_URL is not set in .env');
  else {
    try { host = new URL(url).host.toLowerCase(); } catch { errors.push('SUPABASE_URL is not a valid URL'); }
  }
  if (!String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()) errors.push('SUPABASE_SERVICE_ROLE_KEY is not set in .env');
  if (host === PROD_SUPABASE_HOST && !flags.prod) {
    errors.push(`SUPABASE_URL is the PRODUCTION project (${PROD_SUPABASE_HOST}). Use a staging project, or re-run with --prod if you mean it.`);
  }

  if (env.LEDGER_ALLOW_DEMO_RESET !== undefined) notes.push('LEDGER_ALLOW_DEMO_RESET ignored: "Reset demo data" is always off in live mode');
  delete env.LEDGER_ALLOW_DEMO_RESET;

  if (!flags.allowTwilio) {
    const had = TWILIO_VARS.filter(k => env[k] !== undefined);
    had.forEach(k => { delete env[k]; });
    if (had.length) notes.push('Twilio keys dropped: call/SMS show "Not configured" (pass --allow-twilio to keep them)');
  }
  if (!flags.allowWebhook && env.Q1_WEBHOOK_URL !== undefined) {
    delete env.Q1_WEBHOOK_URL;
    notes.push('Q1_WEBHOOK_URL dropped: local chats do not notify CEO Q1 (pass --allow-webhook to keep it)');
  }
  return { errors, notes, host, production: host === PROD_SUPABASE_HOST };
}

// Read-only mode: wraps globalThis.fetch so the only calls that reach the Supabase project are
// reads (GET/HEAD) and the staff password sign-in (POST /auth/v1/token). Every other method or
// path on that host is answered locally with 403 and never leaves the machine. Other hosts
// (the AI document reader) pass through untouched. Returns an uninstall function.
export function installReadOnlyGuard(supabaseUrl, onBlock) {
  const base = String(supabaseUrl).replace(/\/+$/, '');
  const prev = globalThis.fetch;
  globalThis.fetch = async function readOnlyFetch(input, init) {
    const s = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (s === base || s.startsWith(base + '/') || s.startsWith(base + '?')) {
      const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
      const pathname = (() => { try { return new URL(s).pathname; } catch { return ''; } })();
      const allowed = method === 'GET' || method === 'HEAD' || (method === 'POST' && pathname === '/auth/v1/token');
      if (!allowed) {
        if (onBlock) onBlock(method, pathname);
        return new Response(JSON.stringify({ code: 'LOCAL_READ_ONLY', message: 'dev:live is read-only; restart with --allow-writes' }), {
          status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
      }
    }
    return prev(input, init);
  };
  return () => { globalThis.fetch = prev; };
}
