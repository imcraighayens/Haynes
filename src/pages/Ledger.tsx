import { useSearchParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { PageHeader } from '../shell/PageHeader'
import { useAuth } from '../store/auth'
import { ROLE_LABEL } from '../domain/permissions'
import { Segmented } from '../ui/bits'
import { LedgerOverview } from '../features/ledger/LedgerOverview'
import { LedgerTeam } from '../features/ledger/LedgerTeam'
import { LedgerSettings } from '../features/ledger/LedgerSettings'
import { LedgerData } from '../features/ledger/LedgerData'

type Pane = 'overview' | 'team' | 'settings' | 'data'
const PANES: { value: Pane; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'team', label: 'Employees & roles' },
  { value: 'settings', label: 'Settings' },
  { value: 'data', label: 'Data' },
]

/**
 * Admin area: bank, expenses, team, settings and data. Access is decided by
 * the signed-in user's role (route guard + per-action permissions). The
 * prototype's 6-digit passcode screen is intentionally gone — a code checked
 * in the browser is not access control.
 */
export function Ledger() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const pane = (PANES.some((p) => p.value === params.get('pane')) ? params.get('pane') : 'overview') as Pane

  return (
    <>
      <PageHeader title="Ledger" sub="Admin">
        <span className="hidden items-center gap-1.5 text-[10.5px] font-medium sm:inline-flex" style={{ color: 'var(--dim)' }} title="Access to this area comes from your role, not a passcode">
          <ShieldCheck size={13} /> Role-based access · {user ? ROLE_LABEL[user.role] : ''}
        </span>
      </PageHeader>
      <div className="-mx-1 overflow-x-auto px-1">
        <Segmented<Pane> value={pane} onChange={(v) => setParams(v === 'overview' ? {} : { pane: v }, { replace: true })} options={PANES} />
      </div>
      {pane === 'overview' && <LedgerOverview />}
      {pane === 'team' && <LedgerTeam />}
      {pane === 'settings' && <LedgerSettings />}
      {pane === 'data' && <LedgerData />}
    </>
  )
}
