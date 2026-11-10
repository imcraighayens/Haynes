// Static smoke for the Ledger staff presentation. The boot test still drives the live book.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../ledger/index.html', import.meta.url), 'utf8');

test('the staff shell is a short nav and the dashboard leads with today', () => {
  for (const item of ['DASHBOARD', 'CLIENTS', 'LOANS', 'COLLECTIONS', 'ACCESS', 'REPORTS', 'ADMIN']) {
    assert.match(html, new RegExp("\\['" + item.toLowerCase() + "','" + item + "'"));
  }
  assert.match(html, /What needs action today/);
  assert.match(html, /Each count opens a filtered list/);
  assert.match(html, /class="ledger-side"/);
  assert.match(html, /aria-label="Open menu"/);
  assert.match(html, /@media \(max-width:820px\)/);
});

test('loan and client collections are tables with a search, status text, and paging', () => {
  assert.match(html, /role="table" aria-label="Loan book"/);
  assert.match(html, /data-col="ref">REF NUMBER/);
  assert.match(html, /Days overdue/);
  assert.match(html, /Needs action/);
  assert.match(html, /All clear/);
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
