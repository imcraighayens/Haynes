import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, FileSignature, Plus } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Field, Input, Select, Textarea, Segmented, Pill } from '../../ui/bits'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { assessAffordability } from '../../domain/affordability'
import { blankLoan } from '../../domain/factories'
import { buildSchedule, clientLoans, instalmentFor, isOpen, live, nextLoanRef } from '../../domain/loans'
import { can } from '../../domain/permissions'
import { dateLabel, parseMoney, round2, toIso, zar } from '../../domain/format'
import { defaultFirstDue, TERMS } from './shared'

type Step = 1 | 2 | 3
const PURPOSES = ['Personal', 'School fees', 'Medical', 'Car repairs', 'Household', 'Business', 'Funeral', 'Other']

interface Obligations { living: string; ccDebt: string; existing: string; rent: string; groceries: string }

const money = (s: string) => {
  const n = parseMoney(s)
  return Number.isFinite(n) ? n : 0
}

export function NewLoanWizard({ clientId: initialClient, applicationId, onClose }: { clientId?: string; applicationId?: string; onClose: () => void }) {
  const { book, commit, today } = useBook()
  const { user } = useAuth()
  const actor = useActor()
  const ui = useUi()
  const role = user?.role ?? 'auditor'
  const app = applicationId ? book.applications.find((a) => a.id === applicationId) : undefined
  const clients = useMemo(() => live(book.clients).slice().sort((a, b) => a.name.localeCompare(b.name)), [book.clients])

  const appClient = app ? clients.find((c) => c.id === app.clientId) ?? clients.find((c) => !!app.idNumber && c.idNumber === app.idNumber) : undefined
  const [step, setStep] = useState<Step>(1)
  const [clientId, setClientId] = useState(initialClient ?? appClient?.id ?? '')
  const [amount, setAmount] = useState(app ? String(app.amount) : '')
  const [term, setTerm] = useState<number>(app ? TERMS.reduce((best, t) => (Math.abs(t - app.termMonths) < Math.abs(best - app.termMonths) ? t : best), 1) : 1)
  const [firstDue, setFirstDue] = useState(defaultFirstDue(today))
  const [purpose, setPurpose] = useState(app?.purpose && PURPOSES.includes(app.purpose) ? app.purpose : app ? 'Other' : 'Personal')
  const [purposeOther, setPurposeOther] = useState(app && !PURPOSES.includes(app.purpose) ? app.purpose : '')
  const [officerId, setOfficerId] = useState(user?.id ?? '')
  const [rate, setRate] = useState(String(book.settings.defaultReturnRatePct))
  const [fee, setFee] = useState(String(book.settings.defaultCollectionFee || ''))
  const [net, setNet] = useState('')
  const [obl, setObl] = useState<Obligations>({ living: '', ccDebt: '', existing: '', rent: '', groceries: '' })
  const [override, setOverride] = useState(false)
  const [note, setNote] = useState('')

  const client = clients.find((c) => c.id === clientId)

  // Pick up a client created from "+ New client" while the wizard sat underneath.
  const clientCount = useRef(book.clients.length)
  useEffect(() => {
    if (book.clients.length > clientCount.current && !clientId) setClientId(book.clients[book.clients.length - 1].id)
    clientCount.current = book.clients.length
  }, [book.clients, clientId])

  // Prefill affordability from the client file whenever the client changes.
  useEffect(() => {
    if (!client) return
    const open = clientLoans(book.loans, client.id).filter(isOpen).reduce((s, l) => s + l.instalmentAmount, 0)
    const e = client.expenses
    const s = (n: number) => (n ? String(round2(n)) : '')
    setNet(s(client.netSalary || app?.netIncome || 0))
    setObl({ living: s(e.transport + e.other), ccDebt: '', existing: s(e.otherDebt + open), rent: s(e.rent), groceries: s(e.groceries) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id])

  const amt = money(amount)
  const ratePct = money(rate)
  const feeAmt = money(fee)
  const firstIso = toIso(firstDue)
  const schedule = firstIso ? buildSchedule(firstIso, term) : []
  const instalment = instalmentFor(amt, ratePct, term)
  const obligations = Object.values(obl).reduce((s, v) => s + money(v), 0)
  const aff = assessAffordability({ netSalary: money(net), obligations, amount: amt, termMonths: term, ratePct }, (n) => zar(n))
  const verdictColor = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', dim: 'var(--dim)' }[aff.tone]
  const verdictSoft = { green: 'var(--greenSoft)', amber: 'var(--amberSoft)', red: 'var(--redSoft)', dim: 'var(--hover)' }[aff.tone]

  const step1Errors = [
    !client && 'Choose a client',
    client?.blocked && `${client.name} is blocked — unblock the client before issuing`,
    !(amt >= 100) && 'Enter an amount of at least R 100',
    !firstIso && 'Enter a valid first due date',
    firstIso && firstIso < today && 'First due date is in the past',
    !(ratePct >= 0) && 'Enter a return rate',
  ].filter(Boolean) as string[]

  const needsNote = aff.verdict === 'REFER' || aff.verdict === 'DECLINE' || aff.verdict === 'NO INCOME'
  const declineBlocked = aff.verdict === 'DECLINE' && !(override && can(role, 'loan.edit'))
  const canIssue = !step1Errors.length && !declineBlocked && (!needsNote || note.trim().length > 3)

  const issue = () => {
    if (!client || !firstIso) return
    const purposeText = purpose === 'Other' && purposeOther.trim() ? purposeOther.trim() : purpose
    let loanId = ''
    commit((b) => {
      const loan = blankLoan({
        ref: nextLoanRef(b.loans),
        clientId: client.id,
        applicationId: app?.id ?? null,
        principal: amt,
        returnRatePct: ratePct,
        instalmentAmount: instalment,
        collectionFee: feeAmt,
        schedule,
        purpose: purposeText,
        issuedOn: today,
        officerId: officerId || null,
      })
      loanId = loan.id
      const affNote = `Affordability ${aff.verdict}${aff.net ? ` · DTI ${Math.round(aff.dti * 100)}%` : ''}${note.trim() ? ` · ${note.trim()}` : ''}`
      let nb = ops.issueLoan(b, loan, actor, affNote)
      if (app) nb = ops.decideApplication(nb, app.id, 'approved', actor, { loanId: loan.id, clientId: client.id })
      return nb
    }, `Loan issued to ${client.name}`)
    onClose()
    if (loanId) ui.open({ kind: 'loan', loanId })
  }

  const stepper = (
    <div className="mb-5 flex items-center gap-2" aria-label="Steps">
      {(['Loan', 'Affordability', 'Review'] as const).map((s, i) => {
        const n = (i + 1) as Step
        const done = step > n
        const active = step === n
        return (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={active || done ? { background: 'var(--acc)', color: 'var(--accInk)' } : { background: 'var(--panel3)', color: 'var(--mut)' }}>
              {done ? <Check size={13} /> : n}
            </span>
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.08em] sm:inline" style={{ color: active ? 'var(--ink)' : 'var(--mut)' }}>{s}</span>
            {i < 2 && <span className="h-px flex-1" style={{ background: 'var(--line2)' }} />}
          </div>
        )
      })}
    </div>
  )

  const contractWarn = client && !client.contract.signature && (
    <div className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3 text-[12.5px]" style={{ background: 'var(--amberSoft)', color: 'var(--amber)' }}>
      <FileSignature size={16} className="shrink-0" />
      <span className="flex-1">Master credit agreement {client.contract.no || ''} is not signed yet.</span>
      <Button size="sm" variant="outline" onClick={() => ui.open({ kind: 'contract', clientId: client.id })}>Sign now</Button>
    </div>
  )

  return (
    <Modal
      title={app ? `New loan · ${app.ref}` : 'New loan'}
      subtitle={app ? `From application by ${app.name} · ${zar(app.amount)} over ${app.termMonths} month${app.termMonths > 1 ? 's' : ''}` : 'Issue an advance against a client’s master credit agreement'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {step > 1 && <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)}>Back</Button>}
          <span className="flex-1" />
          {step < 3 ? (
            <Button variant="primary" disabled={!!step1Errors.length} onClick={() => setStep((s) => (s + 1) as Step)}>Continue</Button>
          ) : (
            <Button variant="primary" disabled={!canIssue} onClick={issue}>Issue loan · {zar(amt)}</Button>
          )}
        </>
      }
    >
      {stepper}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" className="sm:col-span-2">
            <div className="flex gap-2">
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.ref}{c.blocked ? ' · BLOCKED' : ''}
                  </option>
                ))}
              </Select>
              {can(role, 'client.create') && (
                <Button variant="soft" icon={<Plus size={14} />} onClick={() => ui.open({ kind: 'clientForm' })}>
                  Client
                </Button>
              )}
            </div>
          </Field>
          {client && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] sm:col-span-2" style={{ color: 'var(--mut)' }}>
              <Pill tone={client.blocked ? 'red' : 'mut'}>{client.blocked ? 'BLOCKED' : client.score ? `SCORE ${client.score}` : 'UNSCORED'}</Pill>
              <span>{client.employer ?? 'Employer not captured'}</span>·
              <span>Net {client.netSalary ? zar(client.netSalary) : 'not captured'}</span>·
              <span>{clientLoans(book.loans, client.id).filter(isOpen).length} open loan(s)</span>
            </div>
          )}
          <Field label="Amount (R)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3 000" autoFocus />
          </Field>
          <div>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--mut)' }}>Term</span>
            <Segmented value={String(term)} onChange={(v) => setTerm(+v)} options={TERMS.map((t) => ({ value: String(t), label: `${t}M` }))} />
          </div>
          <Field label={term > 1 ? 'First instalment date' : 'Due date'} hint="Usually the client’s payday">
            <Input type="date" value={firstDue} min={today} onChange={(e) => setFirstDue(e.target.value)} />
          </Field>
          <Field label="Purpose">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          {purpose === 'Other' && (
            <Field label="Describe purpose" className="sm:col-span-2">
              <Input value={purposeOther} onChange={(e) => setPurposeOther(e.target.value)} />
            </Field>
          )}
          <Field label="Loan officer">
            <Select value={officerId} onChange={(e) => setOfficerId(e.target.value)}>
              <option value="">Unassigned</option>
              {book.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Return %" hint={can(role, 'loan.edit') ? 'Simple, per advance' : 'Set in Ledger › Settings'}>
              <Input inputMode="decimal" value={rate} disabled={!can(role, 'loan.edit')} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="Collection fee" hint="Per debit">
              <Input inputMode="decimal" value={fee} disabled={!can(role, 'loan.edit')} onChange={(e) => setFee(e.target.value)} placeholder="0" />
            </Field>
          </div>
          <div className="rounded-2xl p-4 sm:col-span-2" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="eyebrow">Expected return</div>
                <div className="mt-1 text-[24px] font-bold num" style={{ color: 'var(--acc)' }}>{zar(round2(instalment * term))}</div>
              </div>
              <div className="text-right text-[12.5px]" style={{ color: 'var(--mut)' }}>
                {term} × {zar(instalment)}{feeAmt > 0 ? ` · debit ${zar(instalment + feeAmt)}` : ''}
                <div>Interest {zar(round2(instalment * term - amt))}</div>
              </div>
            </div>
          </div>
          {contractWarn && <div className="sm:col-span-2">{contractWarn}</div>}
          {!!step1Errors.length && (amount || clientId) && (
            <ul className="text-[12px] sm:col-span-2" style={{ color: 'var(--red)' }}>
              {step1Errors.map((e) => <li key={e}>• {e}</li>)}
            </ul>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-5 md:grid-cols-[1fr_1.1fr]">
          <div className="grid content-start gap-3">
            <Field label="Net salary (monthly)" hint={client?.netSalary ? 'From the client file' : 'Not on file — capture it here for this check'}>
              <Input inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
            </Field>
            {(
              [
                ['living', 'Living expenses (transport, other)'],
                ['ccDebt', 'Credit-card debt (monthly)'],
                ['existing', 'Existing loan repayments'],
                ['rent', 'Rent / bond'],
                ['groceries', 'Groceries'],
              ] as [keyof Obligations, string][]
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <Input inputMode="decimal" value={obl[k]} onChange={(e) => setObl((o) => ({ ...o, [k]: e.target.value }))} placeholder="0" />
              </Field>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-[20px] p-5" style={{ background: verdictSoft, border: `1px solid ${verdictColor}` }} aria-live="polite">
              <div className="eyebrow">Affordability</div>
              <div className="mt-1 text-[28px] font-extrabold tracking-tight" style={{ color: verdictColor }}>{aff.verdict}</div>
              <p className="mt-1 text-[13px] leading-relaxed">{aff.reason}</p>
            </div>
            <div className="rounded-[20px] p-5" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
              <div className="grid grid-cols-2 gap-4 text-[12.5px]">
                <Mini label="Repayment / month" value={zar(aff.repayment)} />
                <Mini label="Obligations" value={zar(aff.obligations)} />
                <Mini label="Disposable after" value={aff.net ? zar(aff.disposable) : '—'} tone={aff.disposable < 0 ? 'var(--red)' : undefined} />
                <Mini label="Max affordable" value={aff.net ? zar(aff.maxLoan) : '—'} />
              </div>
              <div className="mt-5">
                <div className="flex justify-between text-[10px] font-semibold tracking-[0.08em]" style={{ color: 'var(--mut)' }}>
                  <span>DEBT-TO-INCOME</span>
                  <span>{aff.net ? `${Math.round(aff.dti * 100)}%` : '—'}</span>
                </div>
                <div className="relative mt-2 h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--panel3)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, aff.dti * 100)}%`, background: verdictColor }} />
                  <span className="absolute top-0 h-full w-px" style={{ left: '55%', background: 'var(--ink)', opacity: 0.5 }} />
                  <span className="absolute top-0 h-full w-px" style={{ left: '70%', background: 'var(--ink)', opacity: 0.5 }} />
                </div>
                <div className="relative mt-1 h-3 text-[9px] font-semibold tracking-[0.08em]" style={{ color: 'var(--dim)' }}>
                  <span className="absolute -translate-x-1/2" style={{ left: '55%' }}>55% SAFE</span>
                  <span className="absolute -translate-x-1/2" style={{ left: '80%' }}>70% LIMIT</span>
                </div>
              </div>
            </div>
            {aff.tone !== 'green' && amt > 0 && aff.net > 0 && aff.maxLoan > 0 && aff.maxLoan < amt && (
              <Button variant="soft" size="sm" onClick={() => setAmount(String(aff.maxLoan))}>Trim amount to {zar(aff.maxLoan)}</Button>
            )}
          </div>
        </div>
      )}

      {step === 3 && client && (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-4 rounded-[20px] p-5 sm:grid-cols-4" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
            <Mini label="Client" value={client.name} />
            <Mini label="Lent" value={zar(amt)} />
            <Mini label="Return" value={`${zar(round2(instalment * term))} @ ${ratePct}%`} />
            <Mini label="Affordability" value={aff.verdict} tone={verdictColor} />
          </div>
          <div className="overflow-hidden rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[10.5px] font-semibold tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">DATE</th>
                  <th className="px-4 py-2.5 text-right">RETURN</th>
                  {feeAmt > 0 && <th className="px-4 py-2.5 text-right">DEBIT</th>}
                </tr>
              </thead>
              <tbody>
                {schedule.map((d, i) => (
                  <tr key={d} style={{ borderTop: '1px solid var(--line)' }}>
                    <td className="px-4 py-2.5" style={{ color: 'var(--mut)' }}>{i + 1}/{term}</td>
                    <td className="px-4 py-2.5 font-semibold">{dateLabel(d)}</td>
                    <td className="px-4 py-2.5 text-right num">{zar(instalment)}</td>
                    {feeAmt > 0 && <td className="px-4 py-2.5 text-right num">{zar(instalment + feeAmt)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {contractWarn}
          {needsNote && (
            <div className="rounded-2xl p-4" style={{ background: aff.verdict === 'DECLINE' ? 'var(--redSoft)' : 'var(--amberSoft)' }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: aff.verdict === 'DECLINE' ? 'var(--red)' : 'var(--amber)' }}>
                <AlertTriangle size={15} />
                {aff.verdict === 'DECLINE' ? 'Affordability declined this loan' : aff.verdict === 'REFER' ? 'Referred — record why it is being approved' : 'No income on file — record how affordability was checked'}
              </div>
              {aff.verdict === 'DECLINE' && (
                can(role, 'loan.edit') ? (
                  <label className="mt-3 flex items-center gap-2 text-[12.5px]">
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    Override and issue anyway (logged with your name)
                  </label>
                ) : (
                  <p className="mt-2 text-[12.5px]">Only a manager or admin can override a decline.</p>
                )
              )}
              <Field label="Reason (logged)" className="mt-3">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Payslip verified; overtime income not captured" />
              </Field>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className="mt-1 truncate text-[15px] font-bold num" style={{ color: tone }}>{value}</div>
    </div>
  )
}
