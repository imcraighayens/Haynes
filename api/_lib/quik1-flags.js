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

export function deploymentHost(req) {
  return requestHostname(req).split(':')[0];
}

export function isProductionDeployment(req) {
  if (String(process.env.VERCEL_ENV || '').toLowerCase() === 'production') return true;
  return PRODUCTION_HOSTS.has(deploymentHost(req));
}

function flagOn(name) {
  return String(process.env[name] || '').trim() === '1';
}

function envSet(name) {
  return String(process.env[name] || '').trim() !== '';
}

// Live borrower PIN. QUIK1_BORROWER_PIN=1 is the switch on every host, including
// production. It also needs QUIK1_SESSION_SECRET (32+ characters). A production
// deployment additionally needs QUIK1_ID_KEY and QUIK1_ID_HMAC_KEY non-empty.
// Previews need only the flag and the session secret. The default is off.
export function borrowerPinLive(req) {
  if (!flagOn('QUIK1_BORROWER_PIN')) return false;
  if (!sessionSecret()) return false;
  if (isProductionDeployment(req) && (!envSet('QUIK1_ID_KEY') || !envSet('QUIK1_ID_HMAC_KEY'))) return false;
  return true;
}

// Staff "view as client". Off unless QUIK1_PREVIEW_VIEW_AS_CLIENT=1, and still off on production.
export function previewViewAsAllowed(req) {
  if (!flagOn('QUIK1_PREVIEW_VIEW_AS_CLIENT')) return false;
  if (isProductionDeployment(req)) return false;
  return true;
}
