import { Upload } from 'lucide-react'
import { PageHeader } from '../shell/PageHeader'
import { Button } from '../ui/Button'
import { useAuth } from '../store/auth'
import { useBook } from '../store/book'
import { useUi } from '../store/ui'
import { can } from '../domain/permissions'
import { dayStamp, parseDate } from '../domain/format'
import { CollectionsCalendar } from '../features/dashboard/CollectionsCalendar'
import { ExpectedReturnCard } from '../features/dashboard/ExpectedReturnCard'
import { AttentionPanel } from '../features/dashboard/AttentionPanel'

export function Dashboard() {
  const { user } = useAuth()
  const { today } = useBook()
  const ui = useUi()
  const role = user!.role
  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={dayStamp(parseDate(today) ?? new Date())}
        actions={
          <>
            {can(role, 'petty.create') && <Button variant="dark" onClick={() => ui.open({ kind: 'petty' })}>Log petty cash</Button>}
            {can(role, 'loan.create') && (
              <Button variant="blue" icon={<Upload size={14} />} onClick={() => ui.open({ kind: 'bulkUpload' })}>
                Bulk upload
              </Button>
            )}
            {can(role, 'loan.create') && <Button variant="primary" onClick={() => ui.open({ kind: 'newLoan' })}>New loan</Button>}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <CollectionsCalendar />
          <ExpectedReturnCard />
        </div>
        <div className="min-w-0">
          <AttentionPanel />
        </div>
      </div>
    </>
  )
}
