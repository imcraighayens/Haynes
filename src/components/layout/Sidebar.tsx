import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard,
  CreditCard,
  Users,
  ShieldCheck,
  BookOpen,
  BookText,
  Wallet,
  Settings as SettingsIcon,
  LogOut,
  Zap,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/loans', label: 'Loans', icon: CreditCard },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/roles', label: 'Role', icon: ShieldCheck },
  { to: '/logbook', label: 'Logbook', icon: BookOpen },
  { to: '/ledger', label: 'Ledger', icon: BookText },
  { to: '/petty-cash', label: 'Petty Cash Loan', icon: Wallet },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, logout } = useAuth()
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onClose} />}
      <aside
        className={clsx(
          'fixed lg:static z-40 h-full w-64 shrink-0 flex flex-col transition-transform',
          'bg-white border-r border-slate-200 dark:bg-[#070b1a] dark:border-white/5',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div className="h-16 flex items-center gap-2 px-6 border-b border-slate-200 dark:border-white/5">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 grid place-items-center text-white shadow-lg shadow-brand-900/40">
            <Zap size={18} fill="currentColor" />
          </div>
          <div className="leading-none">
            <span className="text-lg font-extrabold text-slate-800 dark:text-white">e.Volt</span>
            <span className="text-[9px] align-super text-slate-400 ml-0.5">TM</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/40'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-white/5 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="h-9 w-9 rounded-full bg-brand-500/20 text-brand-400 grid place-items-center text-sm font-semibold">
              {user ? initials(user.name) : 'ED'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-white truncate">{user?.name ?? 'Guest'}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email ?? ''}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600/90 hover:bg-red-600 text-white py-2.5 text-sm font-medium transition-colors"
          >
            <LogOut size={16} /> LogOut
          </button>
        </div>
      </aside>
    </>
  )
}
