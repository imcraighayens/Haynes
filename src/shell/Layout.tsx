import { useState, type ReactNode } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { Sidebar, Logo } from './Sidebar'
import { KpiStrip } from './KpiStrip'
import { Q1Dock } from '../features/q1/Q1Dock'

export function Layout({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false)
  return (
    <div className="flex min-h-full gap-5 p-3 sm:p-3.5">
      <div className="sticky top-3.5 hidden h-[calc(100vh-28px)] shrink-0 lg:block">
        <Sidebar />
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-[90] lg:hidden" style={{ background: 'var(--scrim)' }} onClick={() => setMobileNav(false)}>
          <div className="h-full p-3" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setMobileNav(false)} />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col gap-3.5 pb-10">
        <div className="flex items-center gap-3 lg:hidden">
          <button onClick={() => setMobileNav(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-full" style={{ background: 'var(--panel)', border: '1px solid var(--line2)' }} aria-label="Open menu">
            <MenuIcon size={18} />
          </button>
          <Logo />
        </div>
        <KpiStrip />
        <div className="fade-up flex min-w-0 flex-col gap-4">{children}</div>
      </main>

      <Q1Dock />
    </div>
  )
}
