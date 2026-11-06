// Quik1 live sign-in and staff preview are off unless a flag says otherwise,
// and they never run on a production host. The service role stays on the server.
import { requestHostname } from './auth.js';

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

// Live borrower PIN. Off unless QUIK1_BORROWER_PIN=1, and still off on production.
export function borrowerPinLive(req) {
  if (!flagOn('QUIK1_BORROWER_PIN')) return false;
  if (isProductionDeployment(req)) return false;
  return true;
}

// Staff "view as client". Off unless QUIK1_PREVIEW_VIEW_AS_CLIENT=1, and still off on production.
export function previewViewAsAllowed(req) {
  if (!flagOn('QUIK1_PREVIEW_VIEW_AS_CLIENT')) return false;
  if (isProductionDeployment(req)) return false;
  return true;
}
