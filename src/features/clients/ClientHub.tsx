import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  Activity, Archive, Ban, Briefcase, Eye, EyeOff, FileSignature, Landmark, LayoutGrid, MessageSquare, Pencil, Phone, Scale,
  User, Wallet, Zap,
} from 'lucide-react'
import type { Client, Loan } from '../../domain/types'
import { useBook, useActor } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi, type ClientTab } from '../../store/ui'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import {
  collected, effectiveStatus, instalmentNo, isOpen, live, nextDue, outstanding, principalOf, totalReturn,
} from '../../domain/loans'
import { clientDebtRatio } from '../../domain/affordability'
import { expensesTotal } from '../../domain/factories'
import { dateLabel, dateTimeLabel, maskTail, zar } from '../../domain/format'
import { Modal, CloseButton } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Avatar, Empty, KV, Pill, StatusPill } from '../../ui/bits'
import { officerName, usePiiVisible } from './shared'

const TABS: { key: ClientTab; label: string; icon: ReactNode; sub: string }[] = [
  { key: 'overview', label: 'Overview', icon: <LayoutGrid size={16} />, sub: 'Balance, next due and loans' },
  { key: 'loans', label: 'Loans', icon: <Wallet size={16} />, sub: 'Every advance on this client' },
  { key: 'personal', label: 'Personal details', icon: <User size={16} />, sub: 'Identity and contact' },
  { key: 'employment', label: 'Employment', icon: <Briefcase size={16} />, sub: 'Employer and income' },
  { key: 'banking', label: 'Account & banking', icon: <Landmark size={16} />, sub: 'Debit account and officer' },
  { key: 'affordability', label: 'Income & affordability', icon: <Scale size={16} />, sub: 'Monthly income, expenses and what the client can afford' },
  { key: 'activity', label: 'Activity', icon: <Activity size={16} />, sub: 'Everything logged against this client' },
]

export function ClientHub({ clientId, tab: initialTab, onClose }: { clientId: string; tab?: ClientTab; onClose: () => void }) {
  const { book } = useBook()
  const client = book.clients.find((c) => c.id === clientId)
  const [tab, setTab] = useState<ClientTab>(initialTab ?? 'overview')

  if (!client)
    return (
      <Modal title="Client not found" onClose={onClose} size="sm">
        <Empty>This client is no longer on the book.</Empty>
      </Modal>
    )

  return <Hub client={client} tab={tab} setTab={setTab} onClose={onClose} />
}

function Hub({ client: c, tab, setTab, onClose }: { client: Client; tab: ClientTab; setTab: (t: ClientTab) => void; onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const role = user!.role
  const archived = !!c.deletedAt
  const loans = useMemo(() => (archived ? book.loans.filter((l) => l.clientId === c.id) : live(book.loans).filter((l) => l.clientId === c.id)), [book.loans, c.id, archived])
  const showPii = usePiiVisible()
  const meta = TABS.find((t) => t.key === tab)!

  const note = (type: string, comment: string) => commit((b) => ops.addNote(b, actor, { type, ref: c.ref, customer: c.name, comment }))

  const actions: { label: string; icon: ReactNode; onClick: () => void; tone?: string; hidden?: boolean; disabled?: boolean; title?: string }[] = [
    {
      label: 'Quick loan', icon: <Zap size={16} />, tone: 'var(--amber)', hidden: archived || !can(role, 'loan.create'), disabled: c.blocked,
      title: c.blocked ? 'Client is blocked' : undefined, onClick: () => ui.open({ kind: 'newLoan', clientId: c.id }),
    },
    {
      label: 'Call client', icon: <Phone size={16} />, tone: 'var(--green)', disabled: !c.phone, hidden: archived,
      onClick: () => {
        note('CALL (DEVICE)', `Call started from this device to ${c.phone}`)
        window.location.href = `tel:${c.phone}`
      },
    },
    {
      label: 'Send SMS', icon: <MessageSquare size={16} />, tone: 'var(--blue)', disabled: !c.phone, hidden: archived,
      onClick: () => {
        note('SMS (DEVICE)', `SMS app opened on this device for ${c.phone} — delivery not tracked`)
        window.location.href = `sms:${c.phone}`
      },
    },
    { label: 'Contract', icon: <FileSignature size={16} />, tone: 'var(--amber)', onClick: () => ui.open({ kind: 'contract', clientId: c.id }) },
    {
      label: showPii ? 'Hide details' : 'Reveal details', icon: showPii ? <EyeOff size={16} /> : <Eye size={16} />, tone: 'var(--red)',
      hidden: !book.settings.maskPii || !can(role, 'client.revealPii'),
      onClick: () => {
        if (showPii) return ui.setRevealed(false)
        ui.setRevealed(true)
        note('PII REVEALED', 'Full ID and bank details shown for this session')
      },
    },
    {
      label: c.blocked ? 'Unblock client' : 'Block client', icon: <Ban size={16} />, tone: 'var(--red)', hidden: archived || !can(role, 'client.edit'),
      onClick: () =>
        c.blocked
          ? commit((b) => ops.setClientBlocked(b, c.id, false, actor, 'Unblocked'), `${c.name} unblocked`)
          : ui.open({
              kind: 'confirm', title: `Block ${c.name}?`, body: 'A blocked client cannot be issued new loans until unblocked. Existing loans are unchanged.',
              confirmLabel: 'Block client', danger: true, reasonLabel: 'Reason',
              onConfirm: (reason) => commit((b) => ops.setClientBlocked(b, c.id, true, actor, reason), `${c.name} blocked`),
            }),
    },
    {
      label: 'Archive client', icon: <Archive size={16} />, tone: 'var(--red)', hidden: archived || !can(role, 'client.delete'),
      onClick: () =>
        ui.open({
          kind: 'confirm', title: `Archive ${c.name}?`,
          body: `The client and their ${loans.length} loan(s) leave the book but are kept for the 5-year NCA/FICA retention period. Nothing is deleted.`,
          confirmLabel: 'Archive', danger: true, requireText: c.ref, reasonLabel: 'Reason for archiving',
          onConfirm: (reason) => {
            commit((b) => ops.archiveClient(b, c.id, actor, reason), `${c.name} archived`)
            onClose()
          },
        }),
    },
  ]

  return (
    <Modal onClose={onClose} size="xl" bare>
      <div className="flex min-h-0 flex-1 flex-col md:h-[min(860px,calc(100vh-48px))] md:flex-row">
        {/* rail */}
        <aside className="shrink-0 border-b p-3 md:w-[236px] md:overflow-y-auto md:border-b-0 md:border-r md:p-3" style={{ borderColor: 'var(--modalLine)' }}>
          <div className="flex items-center gap-3 px-1.5 py-2 md:pb-4" style={{ borderBottom: '1px solid var(--modalLine)' }}>
            <Avatar name={c.name} size={44} ring />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold">{c.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full px-2 py-[1px] text-[9.5px] font-semibold tracking-[0.1em]" style={{ border: '1px solid var(--line2)', color: 'var(--mut)' }}>
                  {c.score ? `SCORE ${c.score}` : 'UNSCORED'}
                </span>
                <span className="text-[10.5px] font-semibold" style={{ color: 'var(--mut)' }}>{c.ref}</span>
                {c.blocked && <Pill tone="red">Blocked</Pill>}
                {archived && <Pill tone="mut">Archived</Pill>}
              </div>
            </div>
            <span className="md:hidden">
              <CloseButton onClick={onClose} />
            </span>
          </div>

          <div className="eyebrow mb-1.5 mt-4 hidden px-2 md:block">Manage</div>
          <nav className="-mx-1 mt-2 flex gap-1 overflow-x-auto px-1 pb-1 md:mt-0 md:flex-col md:overflow-visible" aria-label="Client sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={(e) => {
                  setTab(t.key)
                  e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
                }}
                aria-current={tab === t.key}
                className={clsx('flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-medium transition md:py-2.5', tab !== t.key && 'hover:bg-[var(--hover)]')}
                style={tab === t.key ? { background: 'var(--accSoft)', border: '1px solid var(--acc)', color: 'var(--ink)' } : { border: '1px solid transparent', color: 'var(--ink)' }}
              >
                <span style={{ opacity: 0.85 }}>{t.icon}</span>
                {t.label}
                {t.key === 'loans' && <span className="ml-auto pl-2 text-[11px]" style={{ color: 'var(--mut)' }}>{loans.length}</span>}
              </button>
            ))}
          </nav>

          <div className="mx-2 my-3 hidden md:block" style={{ borderTop: '1px solid var(--modalLine)' }} />
          <div className="eyebrow mb-1.5 hidden px-2 md:block">Actions</div>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:flex-col md:overflow-visible">
            {actions.filter((a) => !a.hidden).map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                disabled={a.disabled}
                title={a.title}
                className="flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px] font-medium transition hover:bg-[var(--hover)] disabled:opacity-40 md:py-2.5"
                style={{ color: 'var(--ink)' }}
              >
                <span style={{ color: a.tone }}>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
        </aside>

        {/* pane */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-5 sm:px-6">
            <div>
              <h2 className="text-[19px] font-bold leading-tight">{meta.label}</h2>
              <div className="mt-1 text-[12px]" style={{ color: 'var(--mut)' }}>{meta.sub}</div>
            </div>
            <span className="hidden md:block">
              <CloseButton onClick={onClose} />
            </span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-6">
            {tab === 'overview' && <Overview c={c} loans={loans} />}
            {tab === 'loans' && <LoansTab c={c} loans={loans} archived={archived} />}
            {tab === 'personal' && <Personal c={c} showPii={showPii} archived={archived} />}
            {tab === 'employment' && <Employment c={c} showPii={showPii} archived={archived} />}
            {tab === 'banking' && <Banking c={c} showPii={showPii} archived={archived} />}
            {tab === 'affordability' && <Affordability c={c} loans={loans} showPii={showPii} archived={archived} />}
            {tab === 'activity' && <ActivityTab c={c} loans={loans} />}
          </div>
        </section>
      </div>
    </Modal>
  )
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-[18px] p-4 sm:p-5', className)} style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
      {children}
    </div>
  )
}

function EditBtn({ c, section, label, archived }: { c: Client; section: ClientTab; label: string; archived: boolean }) {
  const ui = useUi()
  const { user } = useAuth()
  if (archived || !can(user!.role, 'client.edit')) return null
  return (
    <div className="mt-5 flex justify-end">
      <Button size="sm" variant="outline" icon={<Pencil size={13} />} onClick={() => ui.open({ kind: 'clientForm', clientId: c.id, section })} className="!normal-case !tracking-normal">
        Edit {label}
      </Button>
    </div>
  )
}

// ───────────────────────── Overview ─────────────────────────

function Overview({ c, loans }: { c: Client; loans: Loan[] }) {
  const { book, today } = useBook()
  const ui = useUi()
  const total = loans.reduce((s, l) => s + totalReturn(l), 0)
  const got = loans.reduce((s, l) => s + collected(l), 0)
  const owed = loans.reduce((s, l) => s + outstanding(l), 0)
  const instTotal = loans.reduce((s, l) => s + l.schedule.length, 0)
  const instPaid = loans.reduce((s, l) => s + Math.min(l.instalmentsPaid, l.schedule.length), 0)
  const lent = loans.reduce((s, l) => s + (l.principal ?? 0), 0)
  const pct = total ? Math.round((got / total) * 100) : 0
  const overdue = loans.filter((l) => effectiveStatus(l, today) === 'overdue')
  const open = loans.filter(isOpen)
  const next = open
    .map((l) => ({ l, d: nextDue(l) }))
    .filter((x): x is { l: Loan; d: string } => !!x.d)
    .sort((a, b) => a.d.localeCompare(b.d))[0]
  const lastDate = open.map((l) => l.schedule[l.schedule.length - 1]).sort().at(-1)

  return (
    <div className="space-y-3.5">
      <Panel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-0">
          {[
            { k: 'Total return', v: zar(total), s: `${instTotal} instalments across ${loans.length} loans`, color: 'var(--ink)' },
            { k: 'Collected', v: zar(got), s: `${instPaid} of ${instTotal} instalments paid`, color: 'var(--green)' },
            { k: 'Still to collect', v: zar(owed), s: owed ? `${open.length} open loan${open.length === 1 ? '' : 's'}` : 'All settled', color: 'var(--blue)' },
          ].map((x, i) => (
            <div key={x.k} className={clsx(i > 0 && 'sm:border-l sm:pl-5', i < 2 && 'sm:pr-5')} style={{ borderColor: 'var(--line)' }}>
              <div className="text-[12px] font-medium" style={{ color: 'var(--mut)' }}>{x.k}</div>
              <div className="mt-1 text-[20px] font-bold num" style={{ color: x.color }}>{x.v}</div>
              <div className="text-[11.5px]" style={{ color: 'var(--mut)' }}>{x.s}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--acc)', transition: 'width .5s ease' }} />
          </div>
          <span className="text-[12px] font-bold num">{pct}% repaid</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {overdue.length ? <Pill tone="red">{overdue.length} overdue</Pill> : <Pill tone="green" className="!normal-case !tracking-normal !text-[11.5px]">Nothing overdue</Pill>}
          <span className="text-[11.5px]" style={{ color: 'var(--mut)' }}>
            Amount lent: {lent ? zar(lent) : 'not entered yet'} · Client since {dateLabel(c.createdAt)}
            {c.createdBy ? ` · added by ${c.createdBy}` : ''} · officer {officerName(book, c.officerId)}
          </span>
        </div>
      </Panel>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Panel>
          <div className="eyebrow">Next collection</div>
          <div className="mt-1.5 text-[20px] font-bold num">{next ? zar(next.l.instalmentAmount) : '—'}</div>
          <div className="mt-1 font-mono text-[10.5px] tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
            {next ? `${dateLabel(next.d).toUpperCase()} · ${next.l.ref}` : 'NOTHING OPEN'}
          </div>
        </Panel>
        <Panel>
          <div className="eyebrow">Return date</div>
          <div className="mt-1.5 text-[20px] font-bold uppercase">{lastDate ? dateLabel(lastDate) : 'Nothing due'}</div>
          <div className="mt-1 font-mono text-[10.5px] tracking-[0.1em]" style={{ color: 'var(--mut)' }}>{lastDate ? 'FINAL INSTALMENT' : 'ALL SETTLED'}</div>
        </Panel>
      </div>

      <div className="overflow-hidden rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
        <div className="eyebrow px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>Loans & what's due · {loans.length}</div>
        {loans.length ? (
          loans
            .slice()
            .sort((a, b) => (nextDue(a) ?? '9999').localeCompare(nextDue(b) ?? '9999'))
            .map((l) => {
              const n = instalmentNo(l)
              return (
                <button key={l.id} onClick={() => ui.open({ kind: 'loan', loanId: l.id })} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-[13px] transition hover:bg-[var(--hover)]" style={{ borderTop: '1px solid var(--line)' }}>
                  <span className="w-[74px] font-semibold num">{l.ref}</span>
                  <StatusPill status={effectiveStatus(l, today)} />
                  <span className="num" style={{ color: 'var(--mut)' }}>INST {n.no}/{n.total}</span>
                  <span className="num" style={{ color: 'var(--mut)' }}>{nextDue(l) ? `next ${dateLabel(nextDue(l))}` : 'settled'}</span>
                  <span className="ml-auto font-semibold num">{zar(outstanding(l) || totalReturn(l))}</span>
                </button>
              )
            })
        ) : (
          <div className="px-4 py-4 text-[13px]" style={{ color: 'var(--mut)' }}>No loans yet — issue one with Quick loan.</div>
        )}
      </div>
    </div>
  )
}

// ───────────────────────── Loans ─────────────────────────

function LoansTab({ c, loans, archived }: { c: Client; loans: Loan[]; archived: boolean }) {
  const { today } = useBook()
  const ui = useUi()
  const { user } = useAuth()
  return (
    <div className="space-y-3">
      {!archived && can(user!.role, 'loan.create') && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" icon={<Zap size={13} />} disabled={c.blocked} onClick={() => ui.open({ kind: 'newLoan', clientId: c.id })}>
            Quick loan
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
        <table className="w-full min-w-[620px] text-left text-[13px]">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
              <th className="px-4 py-3 font-semibold">Ref</th>
              <th className="py-3 text-right font-semibold">Lent</th>
              <th className="py-3 text-right font-semibold">Return</th>
              <th className="py-3 pl-6 font-semibold">Status</th>
              <th className="py-3 font-semibold">Next due</th>
              <th className="py-3 pr-4 text-right font-semibold">Inst</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => {
              const n = instalmentNo(l)
              return (
                <tr key={l.id} onClick={() => ui.open({ kind: 'loan', loanId: l.id })} className="cursor-pointer transition hover:bg-[var(--hover)]" style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="px-4 py-3 font-semibold num">{l.ref}</td>
                  <td className="py-3 text-right num">
                    {zar(principalOf(l))}
                    {l.principal == null && <span className="ml-1 text-[10px]" style={{ color: 'var(--dim)' }} title="Back-calculated from the return">est.</span>}
                  </td>
                  <td className="py-3 text-right font-semibold num">{zar(totalReturn(l))}</td>
                  <td className="py-3 pl-6"><StatusPill status={effectiveStatus(l, today)} /></td>
                  <td className="py-3 num" style={{ color: 'var(--mut)' }}>{nextDue(l) ? dateLabel(nextDue(l)) : '—'}</td>
                  <td className="py-3 pr-4 text-right num" style={{ color: 'var(--mut)' }}>{n.no}/{n.total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!loans.length && <Empty>No loans on this client yet.</Empty>}
      </div>
    </div>
  )
}

// ───────────────────────── Details ─────────────────────────

const v = (s: string | null | undefined) => s || '—'
const hiddenMoney = (n: number, show: boolean) => (show ? (n ? zar(n) : 'R 0') : 'R •••')

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-7 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
}

function Personal({ c, showPii, archived }: { c: Client; showPii: boolean; archived: boolean }) {
  return (
    <Panel>
      <Grid>
        <KV label="Full name" value={c.name} />
        <KV label="ID number" value={showPii ? v(c.idNumber) : maskTail(c.idNumber)} mono />
        <KV label="Date of birth" value={c.dob ? dateLabel(c.dob) : '—'} />
        <KV label="Phone" value={v(c.phone)} />
        <KV label="Email" value={v(c.email)} />
        <KV label="Address" value={v(c.address)} />
        <KV label="City" value={v(c.city)} />
        <KV label="Province" value={v(c.province)} />
        <KV label="Client since" value={dateLabel(c.createdAt)} />
        <KV label="Credit agreement" value={`${c.contract.no || '—'} · ${c.contract.signature ? `signed ${dateLabel(c.contract.signedOn)}` : 'not signed'}`} />
        <KV label="Retain records until" value={c.retainUntil ? dateLabel(c.retainUntil) : '—'} />
      </Grid>
      <EditBtn c={c} section="personal" label="personal details" archived={archived} />
    </Panel>
  )
}

function Employment({ c, showPii, archived }: { c: Client; showPii: boolean; archived: boolean }) {
  return (
    <Panel>
      <Grid>
        <KV label="Employment" value={v(c.employment)} />
        <KV label="Employer" value={v(c.employer)} />
        <KV label="Job title" value={v(c.jobTitle)} />
        <KV label="Time employed" value={v(c.tenure)} />
        <KV label="Net salary" value={hiddenMoney(c.netSalary, showPii)} />
        <KV label="Gross salary" value={hiddenMoney(c.grossSalary, showPii)} />
      </Grid>
      <EditBtn c={c} section="employment" label="employment" archived={archived} />
    </Panel>
  )
}

function Banking({ c, showPii, archived }: { c: Client; showPii: boolean; archived: boolean }) {
  const { book } = useBook()
  return (
    <Panel>
      <Grid>
        <KV label="Bank" value={v(c.bank)} />
        <KV label="Account number" value={showPii ? v(c.accountNo) : c.accountNo ? `••• ${c.accountNo.slice(-4)}` : '—'} mono />
        <KV label="Account type" value={v(c.accountType)} />
        <KV label="Branch code" value={v(c.branchCode)} />
        <KV label="Assigned officer" value={officerName(book, c.officerId)} />
        <KV label="Risk" value={c.score ? `SCORE ${c.score}` : 'UNSCORED'} />
      </Grid>
      <EditBtn c={c} section="banking" label="account & banking" archived={archived} />
    </Panel>
  )
}

// ───────────────────────── Affordability ─────────────────────────

const SAFE = 0.3
const LIMIT = 0.45

function Affordability({ c, loans, showPii, archived }: { c: Client; loans: Loan[]; showPii: boolean; archived: boolean }) {
  const exp = expensesTotal(c)
  const current = loans.filter(isOpen).reduce((s, l) => s + l.instalmentAmount, 0)
  const { ratio, disposable } = clientDebtRatio(c.netSalary, exp, current)
  const verdict =
    ratio == null
      ? { label: 'NOT ASSESSED', text: 'Add net salary and expenses to assess this client.', color: 'var(--dim)' }
      : ratio <= SAFE
        ? { label: 'AFFORDABLE', text: `Debt ratio ${Math.round(ratio * 100)}% is inside the 30% safe band.`, color: 'var(--green)' }
        : ratio <= LIMIT
          ? { label: 'STRETCHED', text: `Debt ratio ${Math.round(ratio * 100)}% is above 30% — new credit needs care.`, color: 'var(--amber)' }
          : { label: 'OVER LIMIT', text: `Debt ratio ${Math.round(ratio * 100)}% exceeds the 45% limit — do not extend further credit.`, color: 'var(--red)' }
  const marker = ratio == null ? null : Math.min(100, Math.round(ratio * 100))

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] px-4 py-3.5" style={{ background: 'var(--panel3)', border: '1px solid var(--line2)' }}>
        <div>
          <div className="eyebrow">Affordability</div>
          <div className="mt-1 text-[21px] font-extrabold" style={{ color: verdict.color }}>{verdict.label}</div>
          <div className="text-[12px]" style={{ color: 'var(--mut)' }}>{verdict.text}</div>
        </div>
        <div className="flex gap-6 text-right">
          {[
            ['Income', c.netSalary ? hiddenMoney(c.netSalary, showPii) : '—'],
            ['Expenses', zar(exp)],
            ['Debt ratio', ratio == null ? '—' : `${Math.round(ratio * 100)}%`],
          ].map(([k, val]) => (
            <div key={k}>
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>{k}</div>
              <div className="mt-1 text-[15px] font-bold num">{val}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="relative mb-6 mt-4">
        <div className="flex h-2 overflow-hidden rounded-full">
          <div style={{ width: '30%', background: 'var(--greenSoft)' }} />
          <div style={{ width: '15%', background: 'var(--amberSoft)' }} />
          <div style={{ width: '55%', background: 'var(--redSoft)' }} />
        </div>
        {marker != null && <div className="absolute -top-1 h-4 w-1 rounded-full" style={{ left: `calc(${marker}% - 2px)`, background: verdict.color }} aria-label={`Debt ratio ${marker}%`} />}
        <div className="relative mt-1.5 h-3 text-[9.5px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>
          <span className="absolute left-0">0%</span>
          <span className="absolute" style={{ left: '30%', transform: 'translateX(-50%)' }}>30% SAFE</span>
          <span className="absolute" style={{ left: '45%' }}>45% LIMIT</span>
          <span className="absolute right-0">100%</span>
        </div>
      </div>

      <Grid>
        <KV label="Net salary" value={hiddenMoney(c.netSalary, showPii)} />
        <KV label="Gross salary" value={hiddenMoney(c.grossSalary, showPii)} />
        <KV label="Other income" value={zar(c.otherIncome)} />
        <KV label="Rent / bond" value={zar(c.expenses.rent)} />
        <KV label="Transport" value={zar(c.expenses.transport)} />
        <KV label="Groceries" value={zar(c.expenses.groceries)} />
        <KV label="Other debt repayments" value={zar(c.expenses.otherDebt)} />
        <KV label="Other expenses" value={zar(c.expenses.other)} />
        <KV label="Total expenses" value={zar(exp)} />
        <KV label="Current loan instalments" value={zar(current)} />
        <KV label="Disposable income" value={disposable == null ? '—' : <span style={{ color: disposable < 0 ? 'var(--red)' : undefined }}>{zar(disposable)}</span>} />
      </Grid>
      <EditBtn c={c} section="affordability" label="income & affordability" archived={archived} />
    </Panel>
  )
}

// ───────────────────────── Activity ─────────────────────────

function ActivityTab({ c, loans }: { c: Client; loans: Loan[] }) {
  const { book } = useBook()
  const refs = new Set([c.ref, ...loans.map((l) => l.ref)])
  const rows = book.logbook.filter((g) => refs.has(g.ref) || g.customer === c.name)
  if (!rows.length) return <Empty>Nothing logged against this client yet.</Empty>
  return (
    <ol className="relative space-y-0">
      {rows.slice(0, 200).map((g) => (
        <li key={g.id} className="flex gap-3 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: g.type.includes('OVERDUE') || g.type.includes('BLOCK') || g.type.includes('ARCHIV') ? 'var(--red)' : g.type.includes('PAID') || g.type.includes('PAYMENT') ? 'var(--green)' : 'var(--acc)' }} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[12px] font-bold tracking-[0.04em]">{g.type}</span>
              <span className="text-[11.5px] num" style={{ color: 'var(--mut)' }}>{g.ref}</span>
              {g.amount ? <span className="text-[12px] font-semibold num">{zar(g.amount)}</span> : null}
            </div>
            {g.comment && <div className="mt-0.5 text-[12.5px]" style={{ color: 'var(--mut)' }}>{g.comment}</div>}
          </div>
          <div className="shrink-0 text-right text-[11px]" style={{ color: 'var(--dim)' }}>
            {dateTimeLabel(g.at)}
            <div>{g.by}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}
