-- Retention: assistant transcripts and spent OTP challenges are deleted on a
-- schedule. With pg_cron (Supabase: Database → Extensions):
--   select cron.schedule('quik1-retention', '17 2 * * *', 'select purge_expired()');
create or replace function purge_expired() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from ai_messages where created_at < now() - make_interval(days => coalesce((config('ai') ->> 'retention_days')::int, 90));
  delete from otp_challenges where created_at < now() - interval '1 day';
end $$;
