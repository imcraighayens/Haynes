// Static checks for the applications privilege and audit migration.
// The file is not applied here. Ledger Bot applies it after review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261111063000_applications_protect.sql', import.meta.url), 'utf8');

test('the migration is a single transaction and does not touch application rows', () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;\s*$/m);
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\btruncate\s+(table\s+)?(only\s+)?(public|quik1)\.applications\b/i);
  assert.doesNotMatch(migration, /\balter\s+table\s+(public|quik1)\.applications\b/i);
  assert.doesNotMatch(migration, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+delete\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+truncate\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+[^;]*\bto\s+anon\b/i);
  assert.doesNotMatch(migration, /\bgrant\s+[^;]*\bto\s+authenticated\b/i);
});

test('DELETE and TRUNCATE are revoked from the API roles and kept for postgres', () => {
  assert.match(migration, /revoke truncate, delete on table %I\.%I from public, anon, authenticated, service_role cascade/i);
  assert.match(migration, /'public', 'applications'/);
  assert.match(migration, /'quik1', 'applications'/);
  assert.match(migration, /role_name = 'postgres'/);
  assert.match(migration, /acl_row\.grantee = owner_oid/);
  assert.match(migration, /privilege_type in \('DELETE', 'TRUNCATE'\)/);
});

test('applications_audit is new, locked down, and written by one security-definer trigger', () => {
  assert.match(migration, /create table if not exists public\.applications_audit/i);
  assert.match(migration, /id bigserial/i);
  assert.match(migration, /table_name text not null/i);
  assert.match(migration, /op text not null/i);
  assert.match(migration, /row_id text/i);
  assert.match(migration, /changed_at timestamptz not null default now\(\)/i);
  assert.match(migration, /actor text default current_user/i);
  assert.match(migration, /\bold jsonb\b/i);
  assert.match(migration, /\bnew jsonb\b/i);
  assert.match(migration, /alter table public\.applications_audit enable row level security/i);
  assert.match(migration, /alter table public\.applications_audit force row level security/i);
  assert.match(migration, /revoke all on table public\.applications_audit from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert on table public\.applications_audit to service_role/i);
  assert.match(migration, /create schema if not exists audit/i);
  assert.match(migration, /revoke all on schema audit from public, anon, authenticated, service_role/i);
  assert.match(migration, /create or replace function audit\.applications_audit_row\(\)/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /pg_catalog\.to_jsonb\(new\)/);
  assert.match(migration, /pg_catalog\.to_jsonb\(old\)/);
  assert.match(migration, /insert into public\.applications_audit/i);
  assert.match(migration, /revoke all on function audit\.applications_audit_row\(\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /drop trigger if exists applications_protect_row on public\.applications;/i);
  assert.match(migration, /drop trigger if exists applications_protect_row on quik1\.applications;/i);
  assert.match(migration, /after insert or update or delete\s+on public\.applications\s+for each row/i);
  assert.match(migration, /after insert or update or delete\s+on quik1\.applications\s+for each row/i);
  assert.match(migration, /execute function audit\.applications_audit_row\(\)/i);
});
