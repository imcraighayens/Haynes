import { FileSpreadsheet, FolderInput, UserPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import { can } from '../../domain/permissions'

/**
 * Shown on the dashboard while the book has no clients and no loans. There is
 * no sample data: the book is filled from the real sources.
 */
export function EmptyBook() {
  const { user, mode } = useAuth()
  const ui = useUi()
  const nav = useNavigate()
  const role = user!.role
  const Step = ({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action: ReactNode }) => (
    <div className="flex flex-col gap-3 rounded-[20px] p-5" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px]" style={{ background: 'var(--accSoft)', color: 'var(--acc)' }}>{icon}</span>
      <div>
        <div className="text-[15px] font-bold">{title}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--mut)' }}>{body}</p>
      </div>
      <div className="mt-auto">{action}</div>
    </div>
  )
  const btn = (label: string, onClick: () => void, disabled = false) => (
    <button disabled={disabled} onClick={onClick} className="rounded-full px-4 py-2 text-[11.5px] font-bold uppercase tracking-[0.04em] transition hover:brightness-110 disabled:opacity-40" style={{ background: 'var(--acc)', color: 'var(--accInk)' }}>
      {label}
    </button>
  )
  return (
    <section className="panel p-6 sm:p-7" aria-labelledby="empty-book">
      <div className="eyebrow">Getting started</div>
      <h2 id="empty-book" className="mt-1 text-[22px] font-extrabold">Your book is empty</h2>
      <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed" style={{ color: 'var(--mut)' }}>
        LEDGER holds no sample data. Bring in your real book from any of these — every import is previewed first and written to the logbook.
        {mode === 'local' && ' No database is connected yet, so the book is saved in this browser only.'}
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Step
          icon={<FileSpreadsheet size={18} />}
          title="NuPay transaction report"
          body="Upload the .xlsx or .csv export. Each debit-order mandate becomes a loan, clients are matched on ID number, and collections are marked paid."
          action={btn('Import report', () => ui.open({ kind: 'recon' }), !can(role, 'bank.manage'))}
        />
        <Step
          icon={<FolderInput size={18} />}
          title="Prototype book"
          body="Bring over everything you captured in the LEDGER prototype — clients, loans, the logbook, petty cash and the bank — in one step."
          action={btn('Import book', () => nav('/ledger?pane=data'), !can(role, 'data.import'))}
        />
        <Step
          icon={<UserPlus size={18} />}
          title="Start by hand"
          body="Add a client and issue their loan with the affordability check. Bulk upload takes a list of loans for clients already on the book."
          action={btn('Add client', () => ui.open({ kind: 'clientForm' }), !can(role, 'client.create'))}
        />
      </div>
    </section>
  )
}
