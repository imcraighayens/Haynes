import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../data/types'
import { supabase, supabaseEnabled } from '../lib/supabase'

export interface AuthUser {
  name: string
  email: string
  role: Role
}

/**
 * Auth has two modes:
 *  - 'supabase': real email/password auth via Supabase Auth (production).
 *  - 'demo':     offline fallback used when no Supabase env vars are set, so
 *                the app still runs (e.g. a static preview). Credentials below.
 */
const DEMO_ADMIN = { email: 'ecoakcess@mail.com', password: 'admin123' }
const DEMO_USER: AuthUser = { name: 'Ecoloan Dev', email: DEMO_ADMIN.email, role: 'admin' }
const DEMO_KEY = 'evolt.auth.v1'

export type AuthMode = 'supabase' | 'demo'

interface AuthCtx {
  user: AuthUser | null
  loading: boolean
  mode: AuthMode
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  updateProfile: (patch: Partial<AuthUser>) => Promise<void>
  demoCredentials: { email: string; password: string }
}

const Ctx = createContext<AuthCtx | null>(null)

/** Build an app user from a Supabase auth user, enriching name/role from the team table. */
async function buildUser(email: string, metadata: Record<string, unknown> | undefined): Promise<AuthUser> {
  const metaName = typeof metadata?.name === 'string' ? (metadata.name as string) : undefined
  const metaRole = typeof metadata?.role === 'string' ? (metadata.role as Role) : undefined
  let name = metaName
  let role = metaRole
  if ((!name || !role) && supabase) {
    try {
      const { data } = await supabase.from('team').select('name, role').eq('email', email).maybeSingle()
      if (data) {
        name = name ?? (data.name as string)
        role = role ?? (data.role as Role)
      }
    } catch {
      /* ignore — fall back to defaults below */
    }
  }
  return { email, name: name ?? email.split('@')[0], role: role ?? 'admin' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode: AuthMode = supabaseEnabled ? 'supabase' : 'demo'
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (supabaseEnabled) return null
    try {
      const raw = localStorage.getItem(DEMO_KEY)
      return raw ? (JSON.parse(raw) as AuthUser) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(supabaseEnabled)

  // Supabase: restore session on load and subscribe to auth changes.
  useEffect(() => {
    if (!supabaseEnabled || !supabase) return
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session
      if (session?.user && active) {
        setUser(await buildUser(session.user.email ?? '', session.user.user_metadata))
      }
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return
      if (session?.user) setUser(await buildUser(session.user.email ?? '', session.user.user_metadata))
      else setUser(null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Demo: persist the fake session locally.
  useEffect(() => {
    if (supabaseEnabled) return
    if (user) localStorage.setItem(DEMO_KEY, JSON.stringify(user))
    else localStorage.removeItem(DEMO_KEY)
  }, [user])

  const login: AuthCtx['login'] = async (email, password) => {
    const e = email.trim().toLowerCase()
    if (supabaseEnabled && supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password })
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    }
    // demo mode
    if (e === DEMO_ADMIN.email && password === DEMO_ADMIN.password) {
      setUser(DEMO_USER)
      return { ok: true }
    }
    return { ok: false, error: 'Incorrect email or password.' }
  }

  const logout: AuthCtx['logout'] = async () => {
    if (supabaseEnabled && supabase) await supabase.auth.signOut()
    setUser(null)
  }

  const updateProfile: AuthCtx['updateProfile'] = async (patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u))
    if (supabaseEnabled && supabase && patch.name) {
      try {
        await supabase.auth.updateUser({ data: { name: patch.name } })
      } catch {
        /* non-fatal */
      }
    }
  }

  return (
    <Ctx.Provider value={{ user, loading, mode, login, logout, updateProfile, demoCredentials: DEMO_ADMIN }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
