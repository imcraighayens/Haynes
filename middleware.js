// Host routing for the two public app domains only.
// quik1.app serves Quik1 at the site root. quik1ledger.com serves Ledger at the site root.
// Other hosts, including ecoloans.co.za and the ecoloan.co.za subdomains, are unchanged.

const APPS = {
  'quik1.app': '/quik1',
  'www.quik1.app': '/quik1',
  'quik1ledger.com': '/ledger',
  'www.quik1ledger.com': '/ledger'
};

export function rewriteForHost(host, pathname) {
  const bare = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const root = APPS[bare];
  if (!root) return null;
  const path = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  if (path === '/api' || path.startsWith('/api/')) return null;
  if (path === root || path.startsWith(`${root}/`)) return null;
  if (path === '/') return `${root}/`;
  return root + path;
}

export default function middleware(request) {
  const url = new URL(request.url);
  const next = rewriteForHost(request.headers.get('host'), url.pathname);
  if (!next || next === url.pathname) return;
  url.pathname = next;
  return Response.rewrite(url);
}

export const config = {
  matcher: ['/((?!api/).*)']
};
