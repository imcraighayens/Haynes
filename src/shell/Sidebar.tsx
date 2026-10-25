import { NavLink } from 'react-router-dom'
import clsx from 'clsx'
import { BarChart3, Bell, ChevronLeft, ChevronRight, FileText, Inbox, LayoutGrid, List, Power, User, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../store/auth'
import { useBook } from '../store/book'
import { useTheme } from '../store/theme'
import { useUi } from '../store/ui'
import { notifications } from '../domain/loans'
import { canSee, ROLE_LABEL, type Area } from '../domain/permissions'
import { Avatar } from '../ui/bits'
import { Q1Face } from './Q1Face'

const NAV: { to: string; label: string; area: Area; icon: ReactNode }[] = [
  { to: '/', label: 'Dashboard', area: 'dashboard', icon: <LayoutGrid size={17} /> },
  { to: '/loans', label: 'Loans', area: 'loans', icon: <FileText size={17} /> },
  { to: '/applications', label: 'Applications', area: 'applications', icon: <Inbox size={17} /> },
  { to: '/clients', label: 'Clients', area: 'clients', icon: <User size={17} /> },
  { to: '/logbook', label: 'Logbook', area: 'logbook', icon: <List size={17} /> },
  { to: '/ledger', label: 'Ledger', area: 'ledger', icon: <BarChart3 size={17} /> },
  { to: '/petty-cash', label: 'Petty cash', area: 'petty', icon: <Wallet size={17} /> },
]

export function Logo({ collapsed }: { collapsed?: boolean }) {
  const { book } = useBook()
  return (
    <div className="flex items-center gap-3 px-2">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]" style={{ background: 'var(--acc)', color: 'var(--accInk)' }}>
        <BarChart3 size={20} strokeWidth={2.6} />
      </span>
      {!collapsed && (
        <div className="leading-none">
          <div className="text-[19px] font-extrabold tracking-[-0.01em]">LEDGER</div>
          <div className="mt-1 text-[9px] font-semibold tracking-[0.2em]" style={{ color: 'var(--mut)' }}>BY {book.settings.orgName.toUpperCase()}</div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, mode } = useAuth()
  const { book, today } = useBook()
  const { theme, toggle } = useTheme()
  const ui = useUi()
  const collapsed = ui.navCollapsed
  const notifCount = notifications(book.loans, today).filter((n) => n.kind !== 'overdue').length
  if (!user) return null

  const item = (_active: boolean) =>
    clsx('group flex h-12 items-center gap-3.5 rounded-[16px] px-4 text-[14.5px] font-medium transition', collapsed && 'justify-center px-0')

  return (
    <aside
      className="flex h-full flex-col rounded-[26px] p-3"
      style={{ width: collapsed ? 88 : 234, background: `linear-gradient(180deg, var(--sideTint), var(--sideTint)), var(--panel)`, border: '1px solid var(--line)', boxShadow: 'var(--cardLift)', transition: 'width .25s ease' }}
    >
      <div className="pb-6 pt-3">
        <Logo collapsed={collapsed} />
      </div>
      <nav className="flex flex-1 flex-col gap-1.5" aria-label="Main">
        {NAV.filter((n) => canSee(user.role, n.area)).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            onClick={onNavigate}
            title={collapsed ? n.label : undefined}
            className={({ isActive }) => item(isActive)}
            style={({ isActive }) => (isActive ? { background: n.to === '/' ? 'var(--ink)' : 'var(--hover)', color: n.to === '/' ? 'var(--bg)' : 'var(--acc)' } : { color: 'var(--ink)' })}
          >
            {({ isActive }) => (
              <>
                <span style={{ color: isActive && n.to === '/' ? 'var(--acc)' : undefined, opacity: isActive ? 1 : 0.8 }}>{n.icon}</span>
                {!collapsed && <span className={clsx(isActive && 'font-semibold')}>{n.label}</span>}
              </>
            )}
          </NavLink>
        ))}
        {canSee(user.role, 'notifications') && (
          <button onClick={() => { ui.open({ kind: 'notifications' }); onNavigate?.() }} className={item(false)} style={{ color: 'var(--ink)' }} title={collapsed ? 'Notifications' : undefined}>
            <span className="relative opacity-80">
              <Bell size={17} />
              {collapsed && notifCount > 0 && <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full" style={{ background: 'var(--red)' }} />}
            </span>
            {!collapsed && (
              <>
                <span>Notifications</span>
                {notifCount > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold" style={{ background: '#e0605a', color: '#fff' }}>
                    {notifCount}
                  </span>
                )}
              </>
            )}
          </button>
        )}
      </nav>

      <button
        onClick={() => ui.open({ kind: 'q1' })}
        className={clsx('mb-4 flex h-[52px] items-center gap-3 rounded-[16px] px-2.5 text-left text-[15px] font-bold transition hover:brightness-110', collapsed && 'justify-center px-0')}
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04))', border: '1px solid rgba(255,255,255,.22)', boxShadow: '0 0 0 1px rgba(0,0,0,.3), 0 8px 18px rgba(0,0,0,.35)', color: 'var(--ink)' }}
        aria-label="Ask Q1"
      >
        <Q1Face size={34} />
        {!collapsed && 'Ask Q1'}
      </button>

      <div className={clsx('flex items-center gap-2.5 px-1.5 pb-3', collapsed && 'justify-center')}>
        <Avatar name={user.name} size={34} />
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold">{user.name}</div>
            <div className="truncate text-[9.5px] font-semibold tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
              {ROLE_LABEL[user.role].toUpperCase()}{mode === 'demo' ? ' · DEMO' : ''}
            </div>
          </div>
        )}
      </div>
      <div className={clsx('flex gap-2', collapsed && 'flex-col items-center')}>
        {!collapsed && (
          <button onClick={toggle} className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full text-[10.5px] font-semibold tracking-[0.12em]" style={{ border: '1px solid var(--line2)' }} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--acc)' }} /> THEME
          </button>
        )}
        <button onClick={() => ui.setNavCollapsed(!collapsed)} className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ border: '1px solid var(--line2)' }} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
        <button onClick={() => void logout()} className="inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ border: '1px solid var(--line2)' }} aria-label="Log out" title="Log out">
          <Power size={14} />
        </button>
      </div>
    </aside>
  )
}
