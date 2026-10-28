import { useState, type FormEvent } from 'react'
import { ArrowRight, BarChart3, Eye, EyeOff, Lock } from 'lucide-react'
import { useAuth } from '../store/auth'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/bits'
import { useTheme } from '../store/theme'

export function Login() {
  const { login, loginLocal, mode } = useAuth()
  const [name, setName] = useState('')
  const { theme, toggle } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shakeKey, setShakeKey] = useState(0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'local') {
      if (name.trim().length < 2) {
        setError('Enter your name — it is recorded against everything you do in the logbook.')
        setShakeKey((k) => k + 1)
        return
      }
      loginLocal(name, email)
      return
    }
    if (!email || !password) {
      setError('Enter your email and password.')
      setShakeKey((k) => k + 1)
      return
    }
    setBusy(true)
    setError(null)
    const r = await login(email, password)
    setBusy(false)
    if (!r.ok) {
      setError(r.error ?? 'Sign-in failed.')
      setShakeKey((k) => k + 1)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10" style={{ background: 'var(--appbg)' }}>
      <div className="w-full max-w-[420px]">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-[15px]" style={{ background: 'var(--acc)', color: 'var(--accInk)', boxShadow: '0 10px 30px -6px rgba(195,245,60,.5)' }}>
            <BarChart3 size={22} strokeWidth={2.6} />
          </span>
          <div className="leading-none">
            <div className="text-[24px] font-extrabold tracking-[-0.01em]">LEDGER</div>
            <div className="mt-1 text-[9.5px] font-semibold tracking-[0.22em]" style={{ color: 'var(--mut)' }}>BY ECOLOANS</div>
          </div>
        </div>

        <form key={shakeKey} onSubmit={submit} className={`glass p-7 ${shakeKey ? 'shake' : ''}`} style={{ background: 'var(--glass)', borderColor: 'var(--glassLine)' }} noValidate>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em]" style={{ color: 'var(--mut)' }}>
            <Lock size={12} /> LOAN BOOK CONSOLE
          </div>
          <h1 className="mb-6 text-[24px] font-extrabold">{mode === 'local' ? 'Open LEDGER' : 'Sign in'}</h1>

          <div className="flex flex-col gap-4">
            {mode === 'local' && (
              <Field label="Your name">
                <Input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Craig Moatshe" autoFocus />
              </Field>
            )}
            <Field label={mode === 'local' ? 'Email (optional)' : 'Email'}>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ecoloans.co.za" autoFocus={mode !== 'local'} />
            </Field>
            {mode !== 'local' && (
            <Field label="Password">
              <div className="relative">
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-11" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full" style={{ color: 'var(--mut)' }} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Field>
            )}
            {error && (
              <div role="alert" className="rounded-xl px-3.5 py-2.5 text-[12.5px] font-medium" style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
                {error}
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" block disabled={busy} icon={busy ? undefined : <ArrowRight size={16} />}>
              {busy ? 'Signing in…' : mode === 'local' ? 'Open on this device' : 'Sign in'}
            </Button>
          </div>

          {mode === 'local' ? (
            <div className="mt-6 rounded-2xl p-4 text-[12.5px] leading-relaxed" style={{ background: 'var(--panel2)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
              <div className="mb-1 font-semibold" style={{ color: 'var(--amber)' }}>No database connected</div>
              Your book is kept in this browser only and starts empty — bring it in from Ledger › Data (prototype book) or Ledger › Overview (NuPay report). Anyone using this browser can open it; connect Supabase for real sign-in and shared data.
            </div>
          ) : (
            <p className="mt-6 text-[12px] leading-relaxed" style={{ color: 'var(--mut)' }}>
              Accounts are created by an admin in Supabase Auth. Your role comes from your row in the team list (Ledger › Employees &amp; roles) — ask an admin if you can sign in but see the wrong screens.
            </p>
          )}
        </form>

        <div className="mt-5 flex items-center justify-between px-2 text-[11px]" style={{ color: 'var(--dim)' }}>
          <span>Access is logged. Records are retained per NCA / FICA.</span>
          <button onClick={toggle} className="font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
            {theme === 'dark' ? 'LIGHT' : 'DARK'} THEME
          </button>
        </div>
      </div>
    </div>
  )
}
