// Staff "/" must be a 307, not the Ledger file.
//
// Measured on master cd01b8e: quik1ledger.com/ is HTTP 200, x-vercel-cache HIT,
// and the body matches /ledger/. www.quik1ledger.com is a domain 307 to
// https://quik1ledger.com/, not to /ledger/. ecoloans-six.vercel.app/ is the
// vercel.json 307 to /ledger/. There is no root index.html, cleanUrls,
// trailingSlash, routes array, or middleware on that commit, and the apex
// redirect uses the same host shape as the one that works. A project rewrite
// of that one host therefore selects the Ledger static file before the
// deployment redirect. The static cache then HITs, including for a new query
// string, because that cache key is the file rather than the query.
//
// Routing Middleware runs before that cache. It sees the visitor path and
// answers before the rewritten file is served. vercel.json redirects stay for
// hosts the project rewrite does not catch.

import { STAFF_HOSTS } from './hosts.js';

export function normalizeHost(host) {
  const first = String(host || '').split(',')[0].trim().toLowerCase();
  return first.replace(/:\d+$/, '');
}

export function staffRootRedirect(host, path, search = '') {
  const name = normalizeHost(host);
  if (!STAFF_HOSTS.includes(name)) return null;
  if (path !== '/' && path !== '') return null;
  const qs = search && search !== '?' ? (search.startsWith('?') ? search : '?' + search) : '';
  return { status: 307, location: '/ledger/' + qs, cacheControl: 'no-store' };
}

function hostValues(rule, key) {
  return (rule[key] || []).filter(entry => entry.type === 'host').map(entry => normalizeHost(entry.value));
}

function ruleMatches(rule, host, path) {
  const source = rule.source === '/' && path === '' ? '/' : rule.source;
  if (source !== path && !(path === '' && rule.source === '/')) return false;
  const has = hostValues(rule, 'has');
  const missing = hostValues(rule, 'missing');
  if (has.length && !has.includes(host)) return false;
  if (missing.includes(host)) return false;
  return true;
}

// CDN order for "/":
// 1. A published project rewrite may retarget quik1ledger.com "/" onto the
//    Ledger file before any vercel.json redirect runs. It does not itself
//    write the response.
// 2. Routing Middleware sees the visitor path and runs before the static
//    cache, so it can 307 before that file is served.
// 3. vercel.json redirects then see the path after the rewrite. "/" no
//    longer matches, which is why the apex redirect does not win today.
// 4. Filesystem, then vercel.json rewrites.
export function resolveStaffRoot(input, options = {}) {
  const host = normalizeHost(input.host);
  const path = input.path;
  const search = input.search || '';
  const vercel = options.vercel;
  const middlewareOn = options.middleware !== false;
  const rootIndex = options.rootIndex === true;
  const projectRewriteHosts = (options.projectRewriteHosts || ['quik1ledger.com']).map(normalizeHost);
  const projectRewritten = (path === '/' || path === '') && projectRewriteHosts.includes(host);
  const routedPath = projectRewritten ? '/ledger/' : (path === '' ? '/' : path);

  if (middlewareOn && (path === '/' || path === '')) {
    const decision = staffRootRedirect(host, path, search);
    if (decision) return { ...decision, phase: 'middleware' };
  }

  const redirect = (vercel.redirects || []).find(rule => ruleMatches(rule, host, routedPath));
  if (redirect && redirect.destination) {
    const status = redirect.permanent === true ? 308 : 307;
    const qs = search && search !== '?' ? (search.startsWith('?') ? search : '?' + search) : '';
    const location = redirect.destination + (redirect.destination.includes('?') ? '' : qs);
    return { status, location, phase: 'redirect' };
  }

  if (routedPath === '/ledger' || routedPath === '/ledger/' || routedPath === '/ledger/index.html') {
    return {
      status: 200,
      phase: projectRewritten ? 'project-rewrite' : 'filesystem',
      file: 'ledger/index.html',
      cache: 'HIT',
      cacheControl: 'public, max-age=0, must-revalidate'
    };
  }

  if (routedPath === '/') {
    const rewrite = (vercel.rewrites || []).find(rule => ruleMatches(rule, host, '/'));
    if (rewrite) {
      return {
        status: 200,
        phase: 'rewrite',
        destination: rewrite.destination,
        cache: 'HIT',
        cacheControl: 'public, max-age=0, must-revalidate'
      };
    }
    if (rootIndex) {
      return {
        status: 200,
        phase: 'filesystem',
        file: 'index.html',
        cache: 'HIT',
        cacheControl: 'public, max-age=0, must-revalidate'
      };
    }
  }

  return { status: 404, phase: 'miss' };
}
