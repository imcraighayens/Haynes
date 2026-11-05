import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rewriteForHost } from '../middleware.js';

test('quik1.app and quik1ledger.com map the site root onto the real apps', () => {
  assert.equal(rewriteForHost('quik1.app', '/'), '/quik1/');
  assert.equal(rewriteForHost('quik1.app', '/quik1-link.js'), '/quik1/quik1-link.js');
  assert.equal(rewriteForHost('www.quik1.app', '/index.html'), '/quik1/index.html');
  assert.equal(rewriteForHost('quik1.app', '/quik1/index.html'), null);
  assert.equal(rewriteForHost('quik1.app', '/api/quik1/me'), null);

  assert.equal(rewriteForHost('quik1ledger.com', '/'), '/ledger/');
  assert.equal(rewriteForHost('quik1ledger.com', '/ledjaa-db.js'), '/ledger/ledjaa-db.js');
  assert.equal(rewriteForHost('www.quik1ledger.com', '/ledger/index.html'), null);
  assert.equal(rewriteForHost('quik1ledger.com', '/api/ledger/state'), null);
});

test('other hosts, including ecoloan.co.za names, are not rewritten', () => {
  for (const host of ['ecoloans-six.vercel.app', 'ecoloans.co.za', 'www.ecoloans.co.za', 'quik1.ecoloan.co.za', 'ledger.ecoloan.co.za', 'www.ecoloan.co.za']) {
    assert.equal(rewriteForHost(host, '/'), null, host);
    assert.equal(rewriteForHost(host, '/index.html'), null, host);
  }
});

test('vercel.json host rules cover only the two public app domains', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  const hosts = [];
  for (const rule of [...(cfg.rewrites || []), ...(cfg.redirects || [])]) {
    for (const cond of [...(rule.has || []), ...(rule.missing || [])]) {
      if (cond.type === 'host') hosts.push(cond.value);
    }
  }
  assert.deepEqual(hosts.sort(), ['quik1.app', 'quik1ledger.com', 'www.quik1.app', 'www.quik1ledger.com'].sort());
  assert.equal(JSON.stringify(cfg).includes('ecoloan.co.za'), false);
  assert.ok(cfg.redirects.some(r => r.source === '/' && r.destination === '/ledger/'));
  assert.ok(cfg.redirects.some(r => r.source === '/ledger' && r.destination === '/ledger/'));
  const quik = cfg.rewrites.find(r => (r.has || []).some(h => h.value === 'quik1.app'));
  const ledger = cfg.rewrites.find(r => (r.has || []).some(h => h.value === 'quik1ledger.com'));
  assert.equal(quik.destination.startsWith('/quik1/'), true);
  assert.equal(ledger.destination.startsWith('/ledger/'), true);
});
