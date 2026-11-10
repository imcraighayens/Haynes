// One allow-list for the CDN (vercel.json) and the API (wrap in http.js).
// tests/host-gate.test.js fails if vercel.json drifts from these arrays.
//
// Staff hosts may open Ledger and the staff APIs. They may not open Quik1.
// Borrower hosts may open Quik1 and /api/quik1. They may not open Ledger or staff APIs.
// Open hosts are local dev: both apps work there.
// vercel.json redirects (not rewrites) hide these pages. Rewrites run after the
// filesystem, so a rewrite never replaces ledger/index.html or quik1/index.html.
// Redirects run first. wrap() still refuses the cross-host APIs.
// Host values are matched as the Host header presents them, including a local port.

export const STAFF_HOSTS = [
  'quik1ledger.com',
  'www.quik1ledger.com',
  'ecoloans-six.vercel.app'
];

export const BORROWER_HOSTS = [
  'quik1.app',
  'www.quik1.app'
];

export const OPEN_HOSTS = [
  'localhost',
  'localhost:3000',
  '127.0.0.1',
  '127.0.0.1:3000'
];

// Static pages. These are redirects in vercel.json because the files already exist.
export const STAFF_PAGES = [
  '/ledger',
  '/ledger/',
  '/ledger/:path*'
];

export const BORROWER_PAGES = [
  '/quik1',
  '/quik1/',
  '/quik1/:path*',
  '/app'
];

// Pages and APIs a non-staff host must never receive. API paths are rewrites;
// the pages above are redirects so they win over the static files.
export const STAFF_PATHS = [
  '/ledger',
  '/ledger/',
  '/ledger/:path*',
  '/api/ledger',
  '/api/ledger/:path*',
  '/api/q1',
  '/api/q1/:path*',
  '/api/q1-assistant',
  '/api/q1-assistant/:path*'
];

// Pages and APIs a staff host must never receive.
export const BORROWER_PATHS = [
  '/quik1',
  '/quik1/',
  '/quik1/:path*',
  '/app',
  '/api/quik1',
  '/api/quik1/:path*'
];

const STAFF_TAGS = new Set(['ledger', 'q1', 'q1-assistant']);
const BORROWER_TAGS = new Set(['quik1']);

function namesOf(value) {
  return String(value || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function roleOf(host) {
  const bare = host.replace(/:\d+$/, '');
  if (BORROWER_HOSTS.includes(host) || BORROWER_HOSTS.includes(bare)) return 'borrower';
  if (STAFF_HOSTS.includes(host) || STAFF_HOSTS.includes(bare)) return 'staff';
  if (OPEN_HOSTS.includes(host) || OPEN_HOSTS.includes(bare)) return 'open';
  return 'other';
}

// x-forwarded-host and host must not name opposite apps. A conflict is refused.
// No header at all is open so unit tests that omit host still run.
export function apiRole(forwarded, host) {
  const names = [...namesOf(forwarded), ...namesOf(host)];
  if (!names.length) return 'open';
  const roles = names.map(roleOf);
  const app = new Set(roles.filter(r => r === 'staff' || r === 'borrower'));
  if (app.size > 1) return 'conflict';
  if (app.size === 1) return [...app][0];
  if (roles.every(r => r === 'open')) return 'open';
  return 'other';
}

export function apiSideAllowed(role, tag) {
  if (role === 'conflict') return false;
  // Staff routes: staff hosts and local dev only. Borrower hosts and everyone else are refused.
  if (STAFF_TAGS.has(tag)) return role === 'staff' || role === 'open';
  // Borrower routes: not on a staff host. quik1.app, local dev, and other non-staff hosts may call them.
  if (BORROWER_TAGS.has(tag)) return role !== 'staff';
  return true;
}
