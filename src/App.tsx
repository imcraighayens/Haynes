import { Suspense, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './shell/Layout'
import { useAuth } from './store/auth'
import { useBook } from './store/book'
import { ModalHost } from './features/ModalHost'
import { canSee, type Area } from './domain/permissions'
import { Dashboard } from './pages/Dashboard'

const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })))
const Loans = lazy(() => import('./pages/Loans').then((m) => ({ default: m.Loans })))
const Applications = lazy(() => import('./pages/Applications').then((m) => ({ default: m.Applications })))
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })))
const Logbook = lazy(() => import('./pages/Logbook').then((m) => ({ default: m.Logbook })))
const Ledger = lazy(() => import('./pages/Ledger').then((m) => ({ default: m.Ledger })))
const PettyCash = lazy(() => import('./pages/PettyCash').then((m) => ({ default: m.PettyCash })))

function Spinner() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="h-8 w-8 animate-spin rounded-full border-2" style={{ borderColor: 'var(--line2)', borderTopColor: 'var(--acc)' }} />
    </div>
  )
}

function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth()
  if (!user || !canSee(user.role, area)) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()
  const { ready } = useBook()

  if (loading) return <Spinner />
  if (!user)
    return (
      <Suspense fallback={<Spinner />}>
        <Login />
      </Suspense>
    )
  if (!ready) return <Spinner />

  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/loans" element={<Guard area="loans"><Loans /></Guard>} />
          <Route path="/applications" element={<Guard area="applications"><Applications /></Guard>} />
          <Route path="/clients" element={<Guard area="clients"><Clients /></Guard>} />
          <Route path="/logbook" element={<Guard area="logbook"><Logbook /></Guard>} />
          <Route path="/ledger" element={<Guard area="ledger"><Ledger /></Guard>} />
          <Route path="/petty-cash" element={<Guard area="petty"><PettyCash /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ModalHost />
    </Layout>
  )
}
