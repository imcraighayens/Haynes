import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Role } from '../data/types'

export interface AuthUser {
  name: string
  email: string
  role: Role
}

/** Demo credentials — replace with Supabase Auth for production. */
const ADMIN = { email: 'ecoakcess@mail.com', password: 'admin123' }
const DEFAULT_USER: AuthUser = { name: 'Ecoloan Dev', email: ADMIN.email, role: 'admin' }
const KEY = 'evolt.auth.v1'

interface AuthCtx {
  user: AuthUser | null
  login: (email: string, password: string) => { ok: boolean; error?: string }
  logout: () => void
  updateProfile: (patch: Partial<AuthUser>) => void
  demoCredentials: { email: string; password: string }
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as AuthUser) : null
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (user) localStorage.setItem(KEY, JSON.stringify(user))
    else localStorage.removeItem(KEY)
  }, [user])

  const login: AuthCtx['login'] = (email, password) => {
    const e = email.trim().toLowerCase()
    if (e === ADMIN.email && password === ADMIN.password) {
      setUser(DEFAULT_USER)
      return { ok: true }
    }
    return { ok: false, error: 'Incorrect email or password.' }
  }

  const logout = () => setUser(null)

  const updateProfile: AuthCtx['updateProfile'] = (patch) =>
    setUser((u) => (u ? { ...u, ...patch } : u))

  return (
    <Ctx.Provider value={{ user, login, logout, updateProfile, demoCredentials: ADMIN }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
