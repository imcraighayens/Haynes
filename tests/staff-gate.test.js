// The signed-out Ledger page is a splash, then a staff login. The book stays
// inside the hidden template until a session exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ledger = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');
const sync = fs.readFileSync(new URL('../ledger/ledger-sync.js', import.meta.url), 'utf8');
const nupay = fs.readFileSync(new URL('../ledger/nupay.html', import.meta.url), 'utf8');

test('an unsigned visitor gets a splash and then the staff login, outside the book', () => {
  const gateAt = ledger.indexOf('id="ledger-gate"');
  const splashAt = ledger.indexOf('data-screen-label="Ledger splash"');
  const loginAt = ledger.indexOf('data-screen-label="Staff login"');
  const bookAt = ledger.indexOf('<x-dc>');
  assert.ok(gateAt > 0 && splashAt > gateAt && loginAt > splashAt && bookAt > loginAt);
  assert.match(ledger, /x-dc\{display:none!important\}/);
  assert.match(ledger, /LEDGER/);
  assert.match(ledger, /BY ECOLOANS/);
  assert.match(ledger, /QUIK1/);
  assert.match(ledger, /Sign in with your staff email and password/);
  assert.match(ledger, /id="ledger-login-form"/);
  assert.match(ledger, /id="ledger-login-error"/);
  assert.doesNotMatch(ledger, /Cancelling returns to the dashboard/);
  const gate = ledger.slice(gateAt, bookAt);
  assert.equal(/ECL-\d/.test(gate), false);
  assert.equal(/LOANED OUT/.test(gate), false);
  assert.match(sync, /if \(!st\)/);
  assert.match(sync, /revealLogin/);
  assert.match(sync, /return injectRuntime\(\)/);
  assert.match(ledger, /sync\.lock\(\)/);
  assert.match(ledger, /Give Quik1 access/);
  assert.match(ledger, /NuPay ref: \{\{ q1Ref \}\}/);
  assert.doesNotMatch(ledger, /\[q\.name, q\.ref\]\.filter\(Boolean\)\.join\(' · '\)/);
  const q1Label = (name, ref) => [name, ref ? 'NuPay ref: ' + ref : ''].filter(Boolean).join('\n');
  assert.equal(q1Label('Synthetic Borrower', 'SYN-4401'), 'Synthetic Borrower\nNuPay ref: SYN-4401');
  assert.equal(q1Label('Synthetic Borrower', ''), 'Synthetic Borrower');
  assert.match(q1Label('Synthetic Client', 'SYNREF00028'), /NuPay ref: SYNREF00028/);
  assert.match(ledger, /REVOKE ACCESS/);
  assert.match(ledger, /Quik1 access not set up yet/);
  assert.match(ledger, /\/quik1-invites\/revoke-access/);
});

test('the NuPay page does not render the importer without a staff session', () => {
  assert.match(nupay, /<main hidden>/);
  assert.match(nupay, /\/api\/ledger\/session/);
  assert.match(nupay, /location\.replace\('\/ledger\/'\)/);
  assert.match(nupay, /Give Quik1 access/);
});
