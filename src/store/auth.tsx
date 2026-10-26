import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../domain/types'
import { supabase, supabaseEnabled } from '../lib/supabase'

export interface User {
  id: string
  name: string
  email: string
  /** Role from the employees table (Supabase); admin on a local device */
  role: Role
}

/**
 * Two modes, chosen by whether Supabase env vars are present:
 *  - supabase: Supabase Auth email/password. Name and role come from the
 *    `employees` row with the same email. If the employees table is empty,
 *    the first person to sign in is treated as admin (bootstrap).
 *  - local: no database connected. The book lives in this browser only, so
 *    there is nothing to authenticate against — the operator just says who
 *    they are (for the logbook) and works as admin on this device.
 */
const LOCAL_KEY = 'ledger.auth.v1'

interface AuthCtx {
  user: User | null
  loading: boolean
  mode: 'supabase' | 'local'
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  /** Local mode only: open the console on this device as the named operator */
  loginLocal: (name: string, email: string) => void
  logout: () => Promise<void>
  /** Local mode only: preview the console as another role */
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
  const mode = supabaseEnabled ? 'supabase' : 'local'
  const [user, setUser] = useState<User | null>(() => {
    if (supabaseEnabled) return null
    try {
      const raw = localStorage.getItem(LOCAL_KEY)
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
      if (user) localStorage.setItem(LOCAL_KEY, JSON.stringify(user))
      else localStorage.removeItem(LOCAL_KEY)
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
    void password
    return { ok: false, error: `No database is connected — use “Open on this device” (${e || 'no email'}).` }
  }

  const loginLocal = (name: string, email: string) => {
    if (supabaseEnabled) return
    setUser({ id: 'local', name: name.trim(), email: email.trim().toLowerCase(), role: 'admin' })
  }

  const logout = async () => {
    if (supabase) await supabase.auth.signOut()
    setUser(null)
  }

  const setViewRole = (role: Role) => {
    if (mode !== 'local') return
    setUser((u) => (u ? { ...u, role } : u))
  }

  return <Ctx.Provider value={{ user, loading, mode, login, loginLocal, logout, setViewRole }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth outside AuthProvider')
  return c
}
