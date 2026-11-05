-- Preserves the live sign-up gate on ledger-ecoloans (auth.users).
-- An insert is refused unless public.employees has an active row for that email.
-- Admin sign-in uses the same predicate. Do not weaken this.
-- Already installed in the live project as trigger ledger_signup_allowlist.
-- This file records it. It does not add an address and it does not open sign-up.

begin;

create or replace function public.auth_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is null or not exists (
    select 1 from public.employees e
    where lower(e.email) = lower(new.email) and e.active
  ) then
    raise exception 'Sign-up is closed. An admin must add % to the team (Ledger › Employees) first.', coalesce(new.email, 'this user')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;

drop trigger if exists ledger_signup_allowlist on auth.users;
create trigger ledger_signup_allowlist
  before insert on auth.users
  for each row execute function public.auth_signup_allowlist();

commit;
