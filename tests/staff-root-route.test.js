// Models the CDN order for "/": middleware before the static cache, then
// vercel.json redirects, then the filesystem, then rewrites. A project rewrite
// that serves the Ledger file is in that chain. Reading the redirects array
// alone would still pass if that rewrite answered first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STAFF_HOSTS, BORROWER_HOSTS } from '../api/_lib/hosts.js';
import { resolveStaffRoot } from '../api/_lib/staff-root.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const rootIndex = fs.existsSync(new URL('../index.html', import.meta.url));

test('quik1ledger.com / is 307 no-store, and quik1.app / is not', async () => {
  assert.equal(rootIndex, false, 'a root index.html would be served for /');
  assert.equal(vercel.cleanUrls, undefined);
  assert.equal(vercel.trailingSlash, undefined);
  assert.equal(vercel.routes, undefined);
  assert.equal(vercel.proxy.entrypoint, 'middleware.js');
  assert.deepEqual(vercel.proxy.matcher, ['/']);

  const middleware = (await import('../middleware.js')).default;
  const staff = await middleware(new Request('https://quik1ledger.com/', {
    headers: { host: 'quik1ledger.com' }
  }));
  assert.equal(staff.status, 307);
  assert.equal(staff.headers.get('location'), '/ledger/');
  assert.equal(staff.headers.get('cache-control'), 'no-store');

  const queried = await middleware(new Request('https://quik1ledger.com/?cb=1', {
    headers: { host: 'Quik1Ledger.com:443' }
  }));
  assert.equal(queried.status, 307);
  assert.equal(queried.headers.get('location'), '/ledger/?cb=1');
  assert.equal(queried.headers.get('cache-control'), 'no-store');

  for (const host of STAFF_HOSTS) {
    const routed = resolveStaffRoot({ host, path: '/' }, { vercel, rootIndex: true });
    assert.equal(routed.status, 307, host);
    assert.equal(routed.location, '/ledger/', host);
    assert.equal(routed.cacheControl, 'no-store', host);
    assert.equal(routed.phase, 'middleware', host);
  }

  // The rewrite that wins on cd01b8e when middleware is absent.
  const rewritten = resolveStaffRoot({ host: 'quik1ledger.com', path: '/' }, {
    vercel,
    middleware: false,
    rootIndex: false
  });
  assert.equal(rewritten.status, 200);
  assert.equal(rewritten.phase, 'project-rewrite');
  assert.equal(rewritten.cache, 'HIT');
  assert.equal(rewritten.file, 'ledger/index.html');

  // A root index.html is also earlier than a late redirect. Middleware still wins.
  const indexed = resolveStaffRoot({ host: 'quik1ledger.com', path: '/' }, {
    vercel,
    rootIndex: true
  });
  assert.equal(indexed.phase, 'middleware');
  assert.equal(indexed.status, 307);

  const borrower = await middleware(new Request('https://quik1.app/', {
    headers: { host: 'quik1.app' }
  }));
  assert.notEqual(borrower.status, 307);
  assert.equal(borrower.headers.get('location'), null);
  assert.equal(borrower.headers.get('x-middleware-next'), '1');

  for (const host of BORROWER_HOSTS) {
    const routed = resolveStaffRoot({ host, path: '/' }, { vercel, rootIndex: true });
    assert.notEqual(routed.status, 307, host);
    assert.equal(routed.status, 200, host);
    assert.equal(routed.phase, 'rewrite', host);
    assert.equal(routed.destination, '/quik1/index.html', host);
  }

  const ledgerPage = resolveStaffRoot({ host: 'quik1ledger.com', path: '/ledger/' }, { vercel });
  assert.equal(ledgerPage.status, 200);
  assert.equal(ledgerPage.phase, 'filesystem');
});
