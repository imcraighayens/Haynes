/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** '1' for preview builds served where deep links can't resolve */
  readonly VITE_HASH_ROUTER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
