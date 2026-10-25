import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase is optional. With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set
 * (see .env.example) the console signs in with Supabase Auth and reads/writes
 * the normalized tables in supabase/schema.sql. Without them it runs offline
 * on a synthetic demo book kept in localStorage.
 */
export const supabaseEnabled = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = supabaseEnabled ? createClient(url as string, anonKey as string) : null

export const supabaseHost = url ? url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null
