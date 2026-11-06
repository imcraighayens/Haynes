-- Quik1 borrower app: support messages and a private document bucket.
-- Additive only. Do not run this from the app. Paste it once in the Supabase SQL
-- editor for ledger-ecoloans. It does not move money, does not call a bank, and
-- does not create a borrower login.

begin;

create table if not exists public.q1_messages (
  id text primary key,
  client_id text not null references public.clients (id),
  author text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint q1_messages_author check (author in ('borrower', 'staff')),
  constraint q1_messages_body_len check (char_length(body) between 1 and 2000)
);

create index if not exists q1_messages_client_created_idx
  on public.q1_messages (client_id, created_at);

alter table public.q1_messages enable row level security;
alter table public.q1_messages force row level security;

revoke all on table public.q1_messages from public, anon, authenticated;

comment on table public.q1_messages is
  'Quik1 support thread for one Ledger client. The service role is the only writer. No phone or PIN is stored.';

-- Private bucket. anon and authenticated get no policy, so they cannot read or write.
-- Vercel functions upload with the service role and never return a public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'q1-documents',
  'q1-documents',
  false,
  2097152,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

commit;
