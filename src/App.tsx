import { Suspense, lazy } from 'react'
import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { Login } from './pages/Login'
import { useAuth } from './context/AuthContext'

const Loans = lazy(() => import('./pages/Loans').then((m) => ({ default: m.Loans })))
const Clients = lazy(() => import('./pages/Clients').then((m) => ({ default: m.Clients })))
const Roles = lazy(() => import('./pages/Roles').then((m) => ({ default: m.Roles })))
const Logbook = lazy(() => import('./pages/Logbook').then((m) => ({ default: m.Logbook })))
const Ledger = lazy(() => import('./pages/Ledger').then((m) => ({ default: m.Ledger })))
const PettyCash = lazy(() => import('./pages/PettyCash').then((m) => ({ default: m.PettyCash })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-32">
      <div className="h-8 w-8 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-brand-500/30 border-t-brand-500 animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/roles" element={<Roles />} />
          <Route path="/logbook" element={<Logbook />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/petty-cash" element={<PettyCash />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </Suspense>
    </Layout>
  )
}
