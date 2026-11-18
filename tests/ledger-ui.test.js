// Static smoke for the Ledger staff presentation. The boot test still drives the live book.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

test('the staff nav is the original nine items plus NuPay', () => {
  const nav = "[['dashboard','DASHBOARD'],['loans','LOANS'],['applications','APPLICATIONS'],['messages','MESSAGES'],['clients','CLIENTS'],['logbook','LOGBOOK'],['ledger','ADMIN'],['petty','PETTY CASH'],['notifications','NOTIFICATIONS'],['nupay','NUPAY']]";
  assert.ok(html.includes(nav), 'sidebar keeps the 11 Nov items and NuPay');
  assert.equal((html.match(/class="nav-item"/g) || []).length, 1, 'one nav list');
  assert.match(html, /class="ledger-side"/);
  assert.match(html, /aria-label="Open menu"/);
  assert.match(html, /navDrawer/);
  assert.match(html, /@media \(max-width:820px\)/);
  assert.match(html, /placeholder="Search…"/);
  assert.match(html, /loanPrev/);
  assert.match(html, /appPrev/);
  assert.match(html, /lgPrev/);
});

test('loan and client collections are tables with a search, status text, and paging', () => {
  assert.match(html, /role="table" aria-label="Loan book"/);
  assert.match(html, /data-col="ref">Ref number/);
  assert.match(html, /Days overdue/);
  assert.match(html, /EXPECTED RETURN/);
  assert.match(html, /MARKET NEWS/);
  assert.match(html, /data-screen-label="Applications inbox"/);
  assert.match(html, /data-screen-label="NuPay"/);
  assert.match(html, /q1Float: false/);
  assert.match(html, /clients to invite/);
  assert.match(html, /placeholder="Search…"/);
  assert.match(html, /No loans in this view/);
  assert.match(html, /No results for that search/);
  assert.match(html, /Give Quik1 access/);
  assert.match(html, /data-label="REVOKE ACCESS"/);
  assert.match(html, /Reset device/);
  assert.match(html, /\/quik1-devices\/reset/);
  assert.match(html, /Next instalment due/);
  assert.match(html, /Final due/);
  assert.match(html, /Quik1 invites are switched off until launch/);
  assert.match(html, /borrowerPinLive/);
  assert.match(html, /Resend invite/);
  assert.match(html, /Record payment/);
  assert.match(html, /held:\['Held'/);
  assert.match(html, /'release-held':\['Held'/);
  assert.match(html, /:focus-visible/);
});
