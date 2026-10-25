import { useState, type ReactNode } from 'react'
import { Menu as MenuIcon } from 'lucide-react'
import { Sidebar, Logo } from './Sidebar'
import { Ticker } from './Ticker'
import { KpiStrip } from './KpiStrip'
import { Q1Face } from './Q1Face'
import { useUi } from '../store/ui'
import { useBook } from '../store/book'
import { notifications } from '../domain/loans'

export function Layout({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false)
  const ui = useUi()
  const { book, today } = useBook()
  const alert = notifications(book.loans, today).some((n) => n.kind !== 'overdue')
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
        <Ticker />
        <KpiStrip />
        <div className="fade-up flex min-w-0 flex-col gap-4">{children}</div>
      </main>

      <button
        onClick={() => ui.open({ kind: 'q1' })}
        className="fixed bottom-5 right-5 z-[60] inline-flex h-[54px] w-[54px] items-center justify-center rounded-full transition hover:scale-105"
        style={{ background: 'rgba(14,15,19,.82)', border: '1.5px solid rgba(255,255,255,.9)', boxShadow: '0 0 0 1px rgba(255,255,255,.3), 0 0 14px rgba(255,255,255,.45), 0 10px 18px -4px rgba(0,0,0,.35)' }}
        aria-label="Ask Q1"
      >
        <Q1Face size={38} alert={alert} />
      </button>
    </div>
  )
}
