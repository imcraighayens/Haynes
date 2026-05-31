import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * Supabase is optional. When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
 * provided (see .env.example), the app reads/writes live data. Otherwise the
 * app falls back to a seeded local store persisted in localStorage.
 */
export const supabaseEnabled = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url as string, anonKey as string)
  : null
