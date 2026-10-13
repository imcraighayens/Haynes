import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

const url = () => Deno.env.get('SUPABASE_URL')!;

/** Service-role client: bypasses RLS. Only for checks the database can't do as the user. */
export function admin(): SupabaseClient {
  return createClient(url(), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
}

/** Client acting as the caller: RLS applies. */
export function asUser(req: Request): SupabaseClient {
  return createClient(url(), Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { authorization: req.headers.get('authorization') ?? '' } },
  });
}
