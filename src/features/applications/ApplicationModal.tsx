import { useMemo, useRef, useState } from 'react'
import { Check, PlayCircle, UserPlus, X } from 'lucide-react'
import type { Application, Book, Client } from '../../domain/types'
import { useBook, useActor } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import { assessAffordability } from '../../domain/affordability'
import { blankClient, contractNo, expensesTotal } from '../../domain/factories'
import { isOpen, live, nextClientRef } from '../../domain/loans'
import { dateLabel, dateTimeLabel, maskTail, parseMoney, uid, zar } from '../../domain/format'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Field, Input, Pill, Select, Textarea } from '../../ui/bits'
import { BANKS, checkSaId, useMyEmployeeId, usePiiVisible } from '../clients/shared'
import { APP_STATUS } from './meta'

export const SOURCES = ['Walk-in', 'Phone', 'WhatsApp', 'Referral', 'Quik1 app', 'Other']
const TERMS = [1, 2, 3, 6]

function blankApp(book: Book): Application {
  const hi = book.applications.reduce((m, a) => Math.max(m, +(/(\d+)$/.exec(a.ref)?.[1] ?? 0)), 1000)
  return {
    id: uid('a_'), ref: `APP-${hi + 1}`, clientId: null, name: '', phone: null, email: null, idNumber: null, employer: null, jobTitle: null,
    netIncome: 0, bank: null, amount: 0, termMonths: 1, purpose: 'Personal', source: 'Walk-in', status: 'new', declineReason: null,
    decidedBy: null, decidedAt: null, loanId: null, createdAt: new Date().toISOString(),
  }
}

/** Existing client this application belongs to: linked id, then SA ID, then exact name. */
export function matchClient(clients: Client[], a: Pick<Application, 'clientId' | 'idNumber' | 'name'>): Client | null {
  const live_ = clients.filter((c) => !c.deletedAt)
  if (a.clientId) return live_.find((c) => c.id === a.clientId) ?? null
  const id = a.idNumber?.replace(/\s/g, '')
  if (id) {
    const hit = live_.find((c) => c.idNumber === id)
    if (hit) return hit
  }
  const n = a.name.trim().toLowerCase()
  return n ? live_.find((c) => c.name.trim().toLowerCase() === n) ?? null : null
}

export function ApplicationModal({ applicationId, onClose }: { applicationId?: string; onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const myEmp = useMyEmployeeId()
  const showPii = usePiiVisible()
  const existing = applicationId ? book.applications.find((a) => a.id === applicationId) : undefined
  const [d, setD] = useState<Application>(() => existing ?? blankApp(book))
  const [touched, setTouched] = useState(false)
  /** Whether this application exists in the book yet (a new one is added on first save). */
  const saved = useRef(!!existing)
  const role = user!.role
  const decided = d.status === 'approved' || d.status === 'declined'
  const canDecide = can(role, 'application.decide')
  const canEdit = !decided && (can(role, 'client.create') || can(role, 'loan.create'))

  const set = <K extends keyof Application>(k: K, v: Application[K]) => setD((x) => ({ ...x, [k]: v }))
  const txt = (k: keyof Application) => (e: { target: { value: string } }) => set(k, (e.target.value.trim() ? e.target.value : null) as never)

  const client = useMemo(() => matchClient(book.clients, d), [book.clients, d])
  const obligations = client
    ? expensesTotal(client) + live(book.loans).filter((l) => l.clientId === client.id && isOpen(l)).reduce((s, l) => s + l.instalmentAmount, 0)
    : 0
  const income = d.netIncome || client?.netSalary || 0
  const aff = assessAffordability({ netSalary: income, obligations, amount: d.amount, termMonths: d.termMonths, ratePct: book.settings.defaultReturnRatePct }, (n) => zar(n))
  const idInfo = checkSaId(d.idNumber ?? '')

  const errors = { name: !d.name.trim() ? 'Applicant name is required' : null, amount: !(d.amount > 0) ? 'Enter the amount requested' : null }
  const valid = !errors.name && !errors.amount

  /** Persist the draft; returns the saved application. */
  const persist = (patch: Partial<Application> = {}, note?: string): Application => {
    const next = { ...d, ...patch, name: d.name.trim(), clientId: d.clientId ?? client?.id ?? null }
    if (!saved.current) {
      commit((b) => ops.addApplication(b, next, actor))
      saved.current = true
    } else commit((b) => ops.updateApplication(b, next.id, next, actor, note ?? 'Application edited'))
    setD(next)
    return next
  }

  const save = () => {
    setTouched(true)
    if (!valid) return
    persist({}, undefined)
    ui.close()
  }

  const startReview = () => {
    setTouched(true)
    if (!valid) return
    persist({ status: 'reviewing' }, 'Review started')
  }

  const createClient = (): string | null => {
    setTouched(true)
    if (!valid) return null
    if (client) return client.id
    const c = blankClient({
      ref: nextClientRef(book.clients),
      name: d.name.trim(),
      idNumber: d.idNumber?.replace(/\s/g, '') || null,
      dob: idInfo.valid ? idInfo.dob : null,
      phone: d.phone,
      email: d.email,
      employer: d.employer,
      jobTitle: d.jobTitle,
      netSalary: d.netIncome,
      bank: d.bank,
      branchCode: d.bank ? BANKS[d.bank] || null : null,
      officerId: myEmp,
      createdBy: actor.name,
      contract: { no: contractNo(book.clients.length), signedOn: null, signature: null },
    })
    commit((b) => ops.addClient(b, c, actor), `${c.name} added as ${c.ref}`)
    persist({ clientId: c.id }, `Linked to new client ${c.ref}`)
    return c.id
  }

  const approve = () => {
    const cid = createClient()
    if (!cid) return
    persist({ clientId: cid, status: d.status === 'new' ? 'reviewing' : d.status }, 'Sent to loan issue')
    ui.swap({ kind: 'newLoan', applicationId: d.id, clientId: cid })
  }

  const decline = () => {
    setTouched(true)
    if (!valid) return
    ui.open({
      kind: 'confirm',
      title: `Decline ${d.name || 'application'}?`,
      body: 'The applicant is not issued a loan. The reason is kept on the application and in the logbook.',
      confirmLabel: 'Decline',
      danger: true,
      reasonLabel: 'Reason for declining',
      onConfirm: (reason) => {
        const app = persist({}, undefined)
        commit((b) => ops.decideApplication(b, app.id, 'declined', actor, { reason }), 'Application declined')
        ui.close()
      },
    })
  }

  const st = APP_STATUS[d.status]

  return (
    <Modal
      title={existing ? `${d.name || 'Application'}` : 'New application'}
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          {d.ref} · {d.source} · submitted {dateLabel(d.createdAt)}
          <Pill tone={st.tone}>{st.label}</Pill>
        </span>
      }
      onClose={onClose}
      size="lg"
      footer={
        decided ? (
          <>
            {d.status === 'approved' && d.loanId && <Button variant="outline" onClick={() => ui.swap({ kind: 'loan', loanId: d.loanId! })}>Open loan</Button>}
            {d.clientId && <Button variant="outline" onClick={() => ui.swap({ kind: 'client', clientId: d.clientId! })}>Open client</Button>}
            <Button variant="primary" onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            {canEdit && <Button variant="ghost" onClick={save}>{existing ? 'Save' : 'Save application'}</Button>}
            {canEdit && !client && <Button variant="outline" icon={<UserPlus size={14} />} onClick={createClient}>Create client</Button>}
            {canEdit && d.status === 'new' && <Button variant="outline" icon={<PlayCircle size={14} />} onClick={startReview}>Start review</Button>}
            {canDecide && <Button variant="danger" icon={<X size={14} />} onClick={decline}>Decline</Button>}
            {canDecide && can(role, 'loan.create') && (
              <Button variant="primary" icon={<Check size={14} />} onClick={approve} disabled={!!client?.blocked} title={client?.blocked ? 'Client is blocked' : undefined}>
                Approve & issue
              </Button>
            )}
          </>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <fieldset disabled={!canEdit} className="grid content-start gap-4 sm:grid-cols-2">
          <Field label="Applicant name *" error={touched ? errors.name : null} className="sm:col-span-2">
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!existing} />
          </Field>
          <Field label="SA ID number" hint={d.idNumber ? (idInfo.valid ? 'Valid ID' : idInfo.reason ?? undefined) : undefined}>
            {canEdit ? (
              <Input value={d.idNumber ?? ''} onChange={(e) => set('idNumber', e.target.value.replace(/[^\d]/g, '').slice(0, 13) || null)} inputMode="numeric" className="font-mono" />
            ) : (
              <Input value={showPii ? d.idNumber ?? '' : maskTail(d.idNumber)} readOnly className="font-mono" />
            )}
          </Field>
          <Field label="Phone"><Input value={d.phone ?? ''} onChange={txt('phone')} inputMode="tel" /></Field>
          <Field label="Email"><Input type="email" value={d.email ?? ''} onChange={txt('email')} /></Field>
          <Field label="Employer"><Input value={d.employer ?? ''} onChange={txt('employer')} /></Field>
          <Field label="Job title"><Input value={d.jobTitle ?? ''} onChange={txt('jobTitle')} /></Field>
          <Field label="Net income (monthly)">
            <Money value={d.netIncome} onChange={(n) => set('netIncome', n)} />
          </Field>
          <Field label="Bank">
            <Select value={d.bank ?? ''} onChange={txt('bank')}>
              <option value="">—</option>
              {Object.keys(BANKS).map((b) => <option key={b}>{b}</option>)}
              {d.bank && !(d.bank in BANKS) && <option>{d.bank}</option>}
            </Select>
          </Field>
          <Field label="Amount requested *" error={touched ? errors.amount : null}>
            <Money value={d.amount} onChange={(n) => set('amount', n)} />
          </Field>
          <Field label="Term">
            <Select value={d.termMonths} onChange={(e) => set('termMonths', +e.target.value)}>
              {TERMS.map((t) => <option key={t} value={t}>{t} month{t > 1 ? 's' : ''}</option>)}
            </Select>
          </Field>
          <Field label="Purpose"><Input value={d.purpose} onChange={(e) => set('purpose', e.target.value)} /></Field>
          <Field label="Source">
            <Select value={d.source} onChange={(e) => set('source', e.target.value)}>
              {[...new Set([...SOURCES, d.source])].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          {d.status === 'declined' && (
            <Field label="Decline reason" className="sm:col-span-2"><Textarea value={d.declineReason ?? ''} readOnly /></Field>
          )}
        </fieldset>

        <aside className="space-y-3">
          <div className="rounded-[18px] p-4" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
            <div className="eyebrow">Live affordability</div>
            <div className="mt-1 text-[22px] font-extrabold" style={{ color: aff.tone === 'dim' ? 'var(--dim)' : `var(--${aff.tone})` }}>{aff.verdict}</div>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--mut)' }}>{aff.reason}</p>
            <dl className="mt-3 space-y-1.5 text-[12.5px]">
              {[
                ['Net income', zar(income)],
                ['Obligations', zar(obligations)],
                ['Repayment / month', zar(aff.repayment)],
                ['Disposable after', zar(aff.disposable)],
                ['Debt-to-income', income ? `${Math.round(aff.dti * 100)}%` : '—'],
                ['Max affordable', income ? zar(aff.maxLoan) : '—'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt style={{ color: 'var(--mut)' }}>{k}</dt>
                  <dd className="font-semibold num">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[10.5px]" style={{ color: 'var(--dim)' }}>
              {book.settings.defaultReturnRatePct}% return · {client ? 'obligations from the client record' : 'no client record — obligations not captured yet'}
            </p>
          </div>
          <div className="rounded-[18px] p-4" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
            <div className="eyebrow">Client match</div>
            {client ? (
              <button className="mt-1.5 block text-left" onClick={() => ui.open({ kind: 'client', clientId: client.id })}>
                <span className="block text-[14px] font-semibold underline-offset-4 hover:underline">{client.name}</span>
                <span className="text-[11.5px]" style={{ color: 'var(--mut)' }}>
                  {client.ref} · matched by {d.clientId ? 'link' : d.idNumber && client.idNumber === d.idNumber ? 'ID number' : 'name'}
                  {client.blocked && ' · BLOCKED'}
                </span>
              </button>
            ) : (
              <p className="mt-1.5 text-[12px]" style={{ color: 'var(--mut)' }}>Not on the book yet. Approving creates the client record automatically.</p>
            )}
          </div>
          {decided && (
            <p className="px-1 text-[11.5px]" style={{ color: 'var(--mut)' }}>
              {d.status === 'approved' ? 'Approved' : 'Declined'} by {d.decidedBy ?? '—'} · {dateTimeLabel(d.decidedAt)}
            </p>
          )}
        </aside>
      </div>
    </Modal>
  )
}

function Money({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: 'var(--dim)' }}>R</span>
      <Input
        value={text}
        inputMode="decimal"
        className="!pl-8 num"
        placeholder="0"
        onChange={(e) => {
          setText(e.target.value)
          const n = parseMoney(e.target.value)
          onChange(Number.isFinite(n) ? n : 0)
        }}
      />
    </div>
  )
}
