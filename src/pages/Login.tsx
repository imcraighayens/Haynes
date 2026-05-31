import { useState } from 'react'
import { Zap, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { Button } from '../components/ui/Button'
import { inputClass } from '../components/ui/Modal'

export function Login() {
  const { login, demoCredentials } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    // Simulate a brief auth round-trip.
    setTimeout(() => {
      const res = login(email, password)
      if (!res.ok) {
        setError(res.error ?? 'Login failed.')
        setLoading(false)
      }
    }, 350)
  }

  function fillDemo() {
    setEmail(demoCredentials.email)
    setPassword(demoCredentials.password)
    setError('')
  }

  return (
    <div className="min-h-full grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-violet-900">
        <div className="absolute inset-0 gradient-header opacity-60" />
        <div className="relative flex items-center gap-2">
          <div className="h-10 w-10 rounded-xl bg-white/15 grid place-items-center text-white">
            <Zap size={20} fill="currentColor" />
          </div>
          <span className="text-2xl font-extrabold text-white">e.Volt</span>
          <span className="text-[10px] align-super text-white/60">TM</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold text-white leading-tight">
            Monitor and manage your loan service operations.
          </h1>
          <p className="mt-4 text-white/70">
            Track loans, clients, repayments and cash flow — all in one modern dashboard built for micro-lenders.
          </p>
        </div>
        <div className="relative flex gap-8 text-white/80">
          <div>
            <p className="text-2xl font-bold text-white">35%</p>
            <p className="text-xs">Default return</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">Real-time</p>
            <p className="text-xs">Ledger &amp; logbook</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-white">Secure</p>
            <p className="text-xs">Role-based access</p>
          </div>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 grid place-items-center text-white">
              <Zap size={20} fill="currentColor" />
            </div>
            <span className="text-2xl font-extrabold text-slate-800 dark:text-white">e.Volt</span>
          </div>

          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Welcome back</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Sign in to your admin dashboard.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Email</span>
              <div className="relative mt-1.5">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={inputClass + ' pl-9'}
                  autoComplete="email"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Password</span>
              <div className="relative mt-1.5">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass + ' pl-9 pr-9'}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error && (
              <div className="rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 text-sm px-3 py-2 border border-red-500/20">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading} icon={!loading ? <ArrowRight size={16} /> : undefined}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <button
            onClick={fillDemo}
            className="mt-6 w-full text-center text-xs text-slate-500 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-300 transition-colors"
          >
            Use demo admin credentials →
          </button>
        </div>
      </div>
    </div>
  )
}
