// The two host-root bugs: quik1.app serves Quik1 HTML at "/" , and a 401 from
// GET /api/ledger/state must surface the existing Ledger passcode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const quik = fs.readFileSync(new URL('../quik1/index.html', import.meta.url), 'utf8');
const ledgerHtml = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../ledger/ledger-sync.js', import.meta.url), 'utf8');

test('quik1 pins /quik1/ before the runtime script and keeps the PIN sign-in copy', () => {
  const literal = quik.indexOf('<base href="/quik1/">');
  const pin = quik.indexOf("var basePath = '/quik1/';");
  const runtime = quik.indexOf('src="96aed023-8540-4384-bdbc-3bc317708b87.js"');
  const link = quik.indexOf('src="./quik1-link.js"');
  assert.ok(literal > 0 && literal < runtime, 'the preload scanner sees base href before any script src');
  assert.ok(pin > 0 && runtime > pin, 'base is set before the runtime script is requested');
  assert.ok(link > pin, 'quik1-link.js is also after the base');
  assert.ok(quik.includes('x-dc{display:none!important}'));
  assert.match(quik, /Enter your PIN/);
  assert.match(quik, /Use your first four digits to sign in\. That is the first four digits of your ID number\./);
});

test('ledger asks for the existing passcode when /state is 401', () => {
  assert.match(ledgerHtml, /var basePath = '\/ledger\/';/);
  assert.match(ledgerHtml, /gate&&gate\.needsUnlock/);
  assert.match(ledgerHtml, /sync&&sync\.needsUnlock&&typeof sync\.unlock==='function'/);
  assert.match(sync, /L\.needsUnlock = !!\(e && e\.status === 401\)/);
  assert.match(sync, /needsUnlock: false/);
});
