import { Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { Dashboard } from './pages/Dashboard'
import { Loans } from './pages/Loans'
import { Clients } from './pages/Clients'
import { Roles } from './pages/Roles'
import { Logbook } from './pages/Logbook'
import { Ledger } from './pages/Ledger'
import { PettyCash } from './pages/PettyCash'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/clients" element={<Clients />} />
        <Route path="/roles" element={<Roles />} />
        <Route path="/logbook" element={<Logbook />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/petty-cash" element={<PettyCash />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
    </Layout>
  )
}
