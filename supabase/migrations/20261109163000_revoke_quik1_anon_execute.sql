-- Close anonymous execute on the two Quik1 RPCs recorded from 7 Nov 2026.
-- public.quik1_submit_application(jsonb) and public.quik1_application_status(text, text)
-- are SECURITY DEFINER and were granted to anon. This repo's borrower app does not
-- call them (it uses /api/quik1 with the service role). Borrower login is not live,
-- and the submit function stores an SA ID number and bank details, so anon must not
-- run them. Authenticated and service_role grants are left as they are.
--
-- Apply this file once in the Supabase SQL editor for ledger-ecoloans.
-- Do not run it from the app, and do not re-apply 20261107111340 or 20261107165938
-- on production: those statements grant anon again.

revoke execute on function public.quik1_submit_application(jsonb) from public;
revoke execute on function public.quik1_submit_application(jsonb) from anon;

revoke execute on function public.quik1_application_status(text, text) from public;
revoke execute on function public.quik1_application_status(text, text) from anon;

-- public.loop_submit_application(jsonb) and public.loop_application_status(text, text)
-- were granted to anon by 20261107094307. Nothing in this repo calls them, and the
-- Quik1 borrower path uses /api/quik1, not these RPCs. The live catalog had the
-- migration row and did not have the functions when this was written, so revoke
-- only when the exact signature is present. Authenticated and service_role stay.
do $$
begin
  if to_regprocedure('public.loop_submit_application(jsonb)') is not null then
    revoke execute on function public.loop_submit_application(jsonb) from public;
    revoke execute on function public.loop_submit_application(jsonb) from anon;
  end if;
  if to_regprocedure('public.loop_application_status(text, text)') is not null then
    revoke execute on function public.loop_application_status(text, text) from public;
    revoke execute on function public.loop_application_status(text, text) from anon;
  end if;
end $$;
