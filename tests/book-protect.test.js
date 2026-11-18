// The book migration is not applied here. Ledger Bot applies it after review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bookReloadAllowed } from '../api/_lib/auth.js';

const migration = readFileSync(new URL('../supabase/migrations/20261111070000_book_protect.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollbacks/20261111070000_book_protect_rollback.sql', import.meta.url), 'utf8');
const explicitGrants = readFileSync(new URL('../supabase/rollbacks/20261111070000_book_protect_explicit_grants.sql', import.meta.url), 'utf8');
const runbook = readFileSync(new URL('../docs/runbook.md', import.meta.url), 'utf8');
const ledger = readFileSync(new URL('../api/ledger.js', import.meta.url), 'utf8');

const TABLES = [
  ['public', 'employees'],
  ['public', 'clients'],
  ['public', 'loans'],
  ['public', 'applications'],
  ['public', 'audit_log'],
  ['public', 'bank_tx'],
  ['public', 'petty_cash'],
  ['public', 'expenses'],
  ['public', 'ledger_book'],
  ['public', 'settings'],
  ['public', 'q1_signups'],
  ['public', 'q1_requests'],
  ['public', 'q1_repayments'],
  ['quik1', 'applications']
];

test('every book table loses DELETE and TRUNCATE except postgres', () => {
  assert.equal(TABLES.length, 14);
  const revokeBlock = migration.slice(migration.indexOf('do $revoke$'), migration.indexOf('create table if not exists public.book_audit'));
  for (const [sch, rel] of TABLES) {
    const pair = `('${sch}', '${rel}')`;
    assert.equal(revokeBlock.split(pair).length - 1, 1, pair);
  }
  assert.match(migration, /revoke truncate, delete on table %I\.%I from public, anon, authenticated, service_role cascade/);
  assert.match(migration, /role_name = 'postgres'/);
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+delete\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+truncate\b/i);
  assert.doesNotMatch(migration, /drop trigger if exists \w+_no_delete/i);
});

test('the audit trigger covers every table except audit_log', () => {
  const triggerBlock = migration.slice(migration.indexOf('do $triggers$'));
  assert.doesNotMatch(triggerBlock, /\('public', 'audit_log'\)/);
  for (const [sch, rel] of TABLES) {
    if (rel === 'audit_log') continue;
    assert.match(triggerBlock, new RegExp(`\\('${sch}', '${rel}'\\)`));
  }
  assert.match(migration, /create or replace function public\.book_audit_row\(\)/);
  assert.match(migration, /security invoker/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /create schema/i);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /alter table public\.book_audit force row level security/);
  assert.match(migration, /grant select, insert on table public\.book_audit to service_role/);
  assert.match(migration, /execute function public\.book_audit_row\(\)/);
});

test('quik1 application images omit identity and bank fields', () => {
  const masked = [
    'id_number', 'id_checksum_ok', 'phone', 'email',
    'bank_name', 'bank_branch_code', 'bank_account_type',
    'bank_holder', 'bank_account_no', 'bank_last4'
  ];
  assert.match(migration, /tg_table_schema = 'quik1' and tg_table_name = 'applications'/);
  for (const col of masked) {
    assert.match(migration, new RegExp(`'${col}'`));
  }
});

test('the rollback drops objects and does not restore privileges', () => {
  const applied = readdirSync(new URL('../supabase/migrations/', import.meta.url));
  assert.equal(applied.some(name => /rollback|explicit_grant/.test(name)), false);
  for (const [sch, rel] of TABLES) {
    if (rel === 'audit_log') continue;
    assert.match(rollback, new RegExp(`drop trigger if exists book_protect_row on ${sch}\\.${rel};`));
  }
  assert.match(rollback, /drop function if exists public\.book_audit_row\(\);/);
  assert.match(rollback, /drop table if exists public\.book_audit;/);
  assert.doesNotMatch(rollback, /\bgrant\s+delete\b/i);
  assert.doesNotMatch(rollback, /\bgrant\s+truncate\b/i);
  assert.match(explicitGrants, /NOT APPLIED BY DEFAULT/);
  assert.match(explicitGrants, /grant delete, truncate on table public\.settings to anon, authenticated, service_role;/);
  assert.match(explicitGrants, /grant delete, truncate on table quik1\.applications to anon, authenticated, service_role;/);
});

test('production refuses a book reload, and the runbook forbids bulk delete', () => {
  const prev = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    assert.equal(bookReloadAllowed({ headers: { host: 'localhost' } }), true);
    assert.equal(bookReloadAllowed({ headers: { host: 'quik1ledger.com' } }), false);
    assert.equal(bookReloadAllowed({ headers: { host: 'www.quik1ledger.com' } }), false);
    assert.equal(bookReloadAllowed({ headers: { host: 'ecoloans-six.vercel.app' } }), false);
    process.env.NODE_ENV = 'production';
    assert.equal(bookReloadAllowed({ headers: { host: 'localhost' } }), false);
  } finally {
    if (prev == null) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev;
  }
  assert.match(ledger, /bookReloadAllowed\(req\)/);
  assert.match(ledger, /Book reload is refused on production/);
  assert.match(runbook, /No ad-hoc reloads, TRUNCATE, or bulk DELETE on production by any bot, agent or person\. Data fixes are single-row, audited, through the app's save path or a reviewed migration, with Craig's go for client or loan data\./);
});
