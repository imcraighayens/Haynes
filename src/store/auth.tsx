import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../domain/types'
import { supabase, supabaseEnabled } from '../lib/supabase'

export interface User {
  id: string
  name: string
  email: string
  /** Role from the employees table (Supabase) or the demo user */
  role: Role
}

/**
 * Two modes, chosen by whether Supabase env vars are present:
 *  - supabase: Supabase Auth email/password. Name and role come from the
 *    `employees` row with the same email. If the employees table is empty,
 *    the first person to sign in is treated as admin (bootstrap).
 *  - demo: offline sign-in for the synthetic demo book.
 */
export const DEMO_LOGIN = { email: 'demo@ecoloans.co.za', password: 'ledger-demo' }
const DEMO_USER: User = { id: 'e1', name: 'Craig Moatshe', email: DEMO_LOGIN.email, role: 'admin' }
const DEMO_KEY = 'ledger.auth.v1'

interface AuthCtx {
  user: User | null
  loading: boolean
  mode: 'supabase' | 'demo'
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  /** Demo only: preview the console as another role */
  setViewRole: (r: Role) => void
}

const Ctx = createContext<AuthCtx | null>(null)

async function resolveUser(id: string, email: string, meta: Record<string, unknown> | undefined): Promise<User> {
  let name = typeof meta?.name === 'string' ? meta.name : email.split('@')[0]
  let role: Role = 'agent'
  if (supabase) {
    const { data } = await supabase.from('employees').select('id,name,role,active').eq('email', email).maybeSingle()
    if (data) {
      name = data.name as string
      role = (data.active === false ? 'auditor' : data.role) as Role
    } else {
      // No team row. The server decides: is_admin() is true only while the
      // team is empty (first-user bootstrap). Anyone else gets a read-only
      // role and RLS shows them nothing.
      const { data: bootstrap } = await supabase.rpc('is_admin')
      role = bootstrap === true ? 'admin' : 'auditor'
    }
  }
  return { id, name, email, role }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const mode = supabaseEnabled ? 'supabase' : 'demo'
  const [user, setUser] = useState<User | null>(() => {
    if (supabaseEnabled) return null
    try {
      const raw = localStorage.getItem(DEMO_KEY)
      return raw ? (JSON.parse(raw) as User) : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(supabaseEnabled)

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user
      if (u && active) setUser(await resolveUser(u.id, u.email ?? '', u.user_metadata))
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      if (!active) return
      const u = session?.user
      setUser(u ? await resolveUser(u.id, u.email ?? '', u.user_metadata) : null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (supabaseEnabled) return
    try {
      if (user) localStorage.setItem(DEMO_KEY, JSON.stringify(user))
      else localStorage.removeItem(DEMO_KEY)
    } catch {
      /* storage unavailable */
    }
  }, [user])

  const login: AuthCtx['login'] = async (email, password) => {
    const e = email.trim().toLowerCase()
    if (supabase) {
      const { error } = await supabase.auth.signInWithPassword({ email: e, password })
      return error ? { ok: false, error: error.message } : { ok: true }
    }
    if (e === DEMO_LOGIN.email && password === DEMO_LOGIN.password) {
      setUser(DEMO_USER)
      return { ok: true }
    }
    return { ok: false, error: 'Incorrect email or password.' }
  }

  const logout = async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
  }

  const setViewRole = (role: Role) => {
    if (mode !== 'demo') return
    setUser((u) => (u ? { ...u, role } : u))
  }

  return <Ctx.Provider value={{ user, loading, mode, login, logout, setViewRole }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
