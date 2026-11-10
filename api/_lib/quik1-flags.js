// Borrower PIN sign-in follows QUIK1_BORROWER_PIN. Staff "view as client" stays
// off on a production host. The service role stays on the server.
import { requestHostname } from './auth.js';
import { sessionSecret } from './quik1-session.js';

const PRODUCTION_HOSTS = new Set([
  'quik1.app',
  'www.quik1.app',
  'quik1ledger.com',
  'www.quik1ledger.com',
  'ecoloans-six.vercel.app'
]);

const HEX_64 = /^[0-9a-fA-F]{64}$/;

// True only for the exact string "1". No trim: " 1", "1 ", "true", "yes", and "on" stay off.
export function flagOn(value) {
  return value === '1';
}

// Lowercase, no port, and one trailing dot removed. "quik1.app." and "QUIK1.APP." are quik1.app.
// A second trailing dot, or any other name, is left unknown and is not a production host.
export function deploymentHost(req) {
  const host = requestHostname(req).split(':')[0];
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

export function isProductionDeployment(req) {
  const env = String(process.env.VERCEL_ENV || '').trim().toLowerCase();
  if (env === 'production') return true;
  return PRODUCTION_HOSTS.has(deploymentHost(req));
}

function envSet(name) {
  return String(process.env[name] || '').trim() !== '';
}

function hex64(name) {
  return HEX_64.test(String(process.env[name] || '').trim());
}

// Live borrower PIN. QUIK1_BORROWER_PIN must be exactly "1" on every host, including
// production. It also needs QUIK1_SESSION_SECRET (32+ characters; whitespace-only is missing).
// A production deployment additionally needs QUIK1_ID_KEY and QUIK1_ID_HMAC_KEY, each
// non-empty and exactly 64 hex characters. Previews need only the flag and the session
// secret. An unknown host or VERCEL_ENV is not production. The default is off.
export function borrowerPinLive(req) {
  if (!flagOn(process.env.QUIK1_BORROWER_PIN)) return false;
  if (!sessionSecret()) return false;
  if (!isProductionDeployment(req)) return true;
  if (!envSet('QUIK1_ID_KEY') || !envSet('QUIK1_ID_HMAC_KEY')) return false;
  if (!hex64('QUIK1_ID_KEY') || !hex64('QUIK1_ID_HMAC_KEY')) return false;
  return true;
}

// Staff "view as client". Off unless QUIK1_PREVIEW_VIEW_AS_CLIENT is exactly "1", and still off on production.
export function previewViewAsAllowed(req) {
  if (!flagOn(process.env.QUIK1_PREVIEW_VIEW_AS_CLIENT)) return false;
  if (isProductionDeployment(req)) return false;
  return true;
}
