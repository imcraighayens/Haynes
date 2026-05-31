import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/loans': 'Loans',
  '/clients': 'Clients',
  '/roles': 'Roles & Permissions',
  '/logbook': 'Activity Logbook',
  '/ledger': 'Ledger',
  '/petty-cash': 'Petty Cash Loan',
}

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const title = titles[pathname] ?? 'Dashboard'

  return (
    <div className="flex h-full">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenu={() => setOpen(true)} title={title} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-[1400px] animate-fade-in">{children}</div>
        </main>
      </div>
    </div>
  )
}
