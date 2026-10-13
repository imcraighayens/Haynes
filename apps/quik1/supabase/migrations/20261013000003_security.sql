-- Row Level Security, grants and storage.
--
-- Model: a customer can READ their own rows and nothing else. They WRITE only:
--   * support_messages (as themselves), consents (their own), via the RPCs below.
-- Staff read according to role; staff writes go through staff_* functions.
-- anon can read and execute nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- Lock down defaults (Supabase grants broad table rights to anon/authenticated)
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reads
-- ─────────────────────────────────────────────────────────────────────────────
grant select on customers, consents, devices, products, applications, documents, loans, drawdowns,
                debit_mandates, payouts, collections, support_messages, ai_messages, staff, app_config, audit_log
  to authenticated;

create policy own_or_staff on customers for select to authenticated using (id = auth.uid() or is_staff('viewer'));
create policy own_or_staff on consents for select to authenticated using (customer_id = auth.uid() or is_staff('viewer'));
create policy own_or_staff on devices for select to authenticated using (customer_id = auth.uid() or is_staff('support'));
create policy own_or_staff on applications for select to authenticated using (customer_id = auth.uid() or is_staff('viewer'));
create policy own_or_staff on documents for select to authenticated using (customer_id = auth.uid() or is_staff('credit_officer'));
create policy own_or_staff on loans for select to authenticated using (customer_id = auth.uid() or is_staff('viewer'));
create policy own_or_staff on debit_mandates for select to authenticated using (customer_id = auth.uid() or is_staff('viewer'));
create policy own_or_staff on support_messages for select to authenticated using (customer_id = auth.uid() or is_staff('support'));
create policy own_only on ai_messages for select to authenticated using (customer_id = auth.uid());

create policy via_loan on drawdowns for select to authenticated
  using (is_staff('viewer') or exists (select 1 from loans l where l.id = loan_id and l.customer_id = auth.uid()));
create policy via_loan on collections for select to authenticated
  using (is_staff('viewer') or exists (select 1 from loans l where l.id = loan_id and l.customer_id = auth.uid()));
create policy via_drawdown on payouts for select to authenticated
  using (is_staff('viewer') or exists (select 1 from drawdowns d join loans l on l.id = d.loan_id where d.id = drawdown_id and l.customer_id = auth.uid()));

create policy everyone on products for select to authenticated using (true);
create policy public_keys on app_config for select to authenticated using (key in ('lender', 'limits', 'pilot') or is_staff('admin'));
create policy self_or_admin on staff for select to authenticated using (user_id = auth.uid() or is_staff('admin'));
create policy admin_only on audit_log for select to authenticated using (is_staff('admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Customer writes
-- ─────────────────────────────────────────────────────────────────────────────
grant insert (customer_id, sender, body) on support_messages to authenticated;
create policy customer_writes on support_messages for insert to authenticated
  with check (customer_id = auth.uid() and sender = 'customer');

grant insert (customer_id, kind, version, granted) on consents to authenticated;
create policy customer_writes on consents for insert to authenticated
  with check (customer_id = auth.uid() and kind in ('ai_assistant', 'marketing'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff writes (admin only; everything else goes through staff_* functions)
-- ─────────────────────────────────────────────────────────────────────────────
grant insert, update on products, app_config to authenticated;
create policy admin_writes on products for all to authenticated using (is_staff('admin')) with check (is_staff('admin'));
create policy admin_writes on app_config for update to authenticated using (is_staff('admin')) with check (is_staff('admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Functions callable from the app
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function
  quote(bigint, int),
  my_snapshot(),
  register_document(document_kind, int, text, text),
  submit_application(bigint, int, text, bigint, bigint),
  sign_agreement(uuid),
  accept_offer(uuid, boolean),
  request_settlement(),
  update_profile(text, text),
  staff_review_customer(uuid, boolean, text),
  staff_decide_application(uuid, boolean, bigint),
  staff_reply(uuid, text),
  is_staff(staff_role)
to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: private bucket, files under <customer uuid>/...
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;

create policy quik1_documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy quik1_documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff('credit_officer')));
