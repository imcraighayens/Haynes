-- Read-only check. Do not run this from the app, and do not apply it as a migration.
-- Lists loans whose latest status-change row in public.audit_log does not match
-- public.loans.status. A match means the saved loan and the audit trail agree.
-- Status words are compared after the arrow (OVERDUE → PAID, STATUS → PAID).

with status_audits as (
  select
    a.ref,
    a.at,
    a.type,
    a.by,
    lower(regexp_replace(split_part(a.type, '→', 2), '[^A-Za-z]+', '', 'g')) as audit_word
  from public.audit_log a
  where a.ref is not null
    and a.ref <> '—'
    and position('→' in a.type) > 0
),
latest as (
  select distinct on (ref)
    ref, at, type, by, audit_word
  from status_audits
  where audit_word <> ''
  order by ref, at desc
),
mapped as (
  select
    latest.*,
    case latest.audit_word
      when 'paid' then 'paid'
      when 'overdue' then 'overdue'
      when 'issued' then 'issued'
      when 'duetoday' then 'issued'
      when 'settled' then 'settled_early'
      when 'settledearly' then 'settled_early'
      when 'writtenoff' then 'written_off'
      else latest.audit_word
    end as audit_status
  from latest
)
select
  l.id,
  l.ref,
  l.status as loan_status,
  l.status_at,
  l.updated_at,
  l.updated_by,
  l.instalments_paid,
  m.at as audit_at,
  m.type as audit_type,
  m.by as audit_by,
  m.audit_status
from mapped m
join public.loans l
  on l.ref = m.ref
 and l.deleted_at is null
where l.status is distinct from m.audit_status
order by m.at desc;

-- The 5 Nov rebuild left audit_log with one row. A later boot pushed a stale
-- browser log back, so old PAYMENT RECEIVED, MANDATE REJECTED, DEBIT FAILED
-- and LOAN UPDATED rows reappeared. This SELECT only lists those types.
-- It does not delete anything.
select id, at, type, ref, customer, amount, by
from public.audit_log
where type in ('PAYMENT RECEIVED', 'MANDATE REJECTED', 'DEBIT FAILED', 'LOAN UPDATED')
order by at;

-- NOT RUN. Do not execute the statement below. It is a cleanup sketch only.
-- Uncommenting it would delete existing audit rows. Leave them in place.
-- delete from public.audit_log
-- where type in ('PAYMENT RECEIVED', 'MANDATE REJECTED', 'DEBIT FAILED', 'LOAN UPDATED');
