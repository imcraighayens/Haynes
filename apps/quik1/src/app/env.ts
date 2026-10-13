/// <reference types="vite/client" />
// LIVE when a Supabase project is configured. Without it the app runs the
// delivered prototype unchanged (demo persona, no network) — useful for design
// review and the parity check.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const LIVE = !!(SUPABASE_URL && SUPABASE_ANON_KEY) && !new URLSearchParams(globalThis.location?.search ?? '').has('demo');
