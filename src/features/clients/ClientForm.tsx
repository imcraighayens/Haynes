import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Client } from '../../domain/types'
import type { ClientTab } from '../../store/ui'
import { useBook, useActor } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { blankClient, contractNo, expensesTotal } from '../../domain/factories'
import { nextClientRef } from '../../domain/loans'
import { parseMoney, zar } from '../../domain/format'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Field, Input, Select } from '../../ui/bits'
import { ACCOUNT_TYPES, BANKS, checkSaId, EMPLOYMENT_TYPES, PROVINCES, useMyEmployeeId } from './shared'

type Section = 'personal' | 'employment' | 'banking' | 'affordability'

const LABELS: Partial<Record<keyof Client | string, string>> = {
  name: 'name', idNumber: 'ID number', dob: 'date of birth', phone: 'phone', email: 'email', address: 'address', city: 'city',
  province: 'province', employment: 'employment', employer: 'employer', jobTitle: 'job title', tenure: 'tenure',
  netSalary: 'net salary', grossSalary: 'gross salary', otherIncome: 'other income', bank: 'bank', branchCode: 'branch code',
  accountNo: 'account number', accountType: 'account type', officerId: 'officer', expenses: 'expenses',
}

const sectionOf = (t?: ClientTab): Section | null =>
  t === 'personal' || t === 'overview' ? 'personal' : t === 'employment' ? 'employment' : t === 'banking' ? 'banking' : t === 'affordability' ? 'affordability' : null

export function ClientFormModal({ clientId, section, onClose }: { clientId?: string; section?: ClientTab; onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const myEmp = useMyEmployeeId()
  const existing = clientId ? book.clients.find((c) => c.id === clientId) : undefined
  const [d, setD] = useState<Client>(() => existing ?? blankClient({ officerId: myEmp, employment: 'Full-time', accountType: 'Savings Account' }))
  const [touched, setTouched] = useState(false)
  const refs = {
    personal: useRef<HTMLElement>(null),
    employment: useRef<HTMLElement>(null),
    banking: useRef<HTMLElement>(null),
    affordability: useRef<HTMLElement>(null),
  }

  useEffect(() => {
    const s = sectionOf(section)
    if (!s || s === 'personal') return
    const el = refs[s].current
    el?.scrollIntoView({ block: 'start' })
    el?.querySelector<HTMLElement>('input,select')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = <K extends keyof Client>(k: K, v: Client[K]) => setD((x) => ({ ...x, [k]: v }))
  const str = (k: keyof Client) => (e: { target: { value: string } }) => set(k, (e.target.value.trim() === '' ? null : e.target.value) as never)
  const money = (k: 'netSalary' | 'grossSalary' | 'otherIncome') => (e: { target: { value: string } }) => {
    const n = parseMoney(e.target.value)
    set(k, Number.isFinite(n) ? n : 0)
  }
  const exp = (k: keyof Client['expenses']) => (e: { target: { value: string } }) => {
    const n = parseMoney(e.target.value)
    setD((x) => ({ ...x, expenses: { ...x.expenses, [k]: Number.isFinite(n) ? n : 0 } }))
  }

  const idCheck = useMemo(() => checkSaId(d.idNumber ?? ''), [d.idNumber])
  const nameErr = touched && !d.name.trim() ? 'Name is required' : null
  const dupe = useMemo(() => {
    const id = (d.idNumber ?? '').replace(/\s/g, '')
    if (!id) return null
    return book.clients.find((c) => c.id !== d.id && !c.deletedAt && c.idNumber === id) ?? null
  }, [d.idNumber, d.id, book.clients])

  const onId = (e: { target: { value: string } }) => {
    const raw = e.target.value.replace(/[^\d]/g, '').slice(0, 13)
    const info = checkSaId(raw)
    setD((x) => ({ ...x, idNumber: raw || null, dob: info.valid && info.dob && !x.dob ? info.dob : x.dob }))
  }

  const onBank = (e: { target: { value: string } }) => {
    const bank = e.target.value || null
    setD((x) => {
      const universal = Object.values(BANKS)
      const branch = !x.branchCode || universal.includes(x.branchCode) ? (bank && BANKS[bank]) || x.branchCode : x.branchCode
      return { ...x, bank, branchCode: branch || null }
    })
  }

  const save = () => {
    setTouched(true)
    if (!d.name.trim()) {
      refs.personal.current?.querySelector('input')?.focus()
      return
    }
    const clean: Client = { ...d, name: d.name.trim(), idNumber: d.idNumber?.replace(/\s/g, '') || null }
    if (!existing) {
      const ref = nextClientRef(book.clients)
      const c: Client = { ...clean, ref, createdBy: actor.name, contract: { no: contractNo(book.clients.length), signedOn: null, signature: null } }
      commit((b) => ops.addClient(b, c, actor), `${c.name} added · ${ref}`)
      ui.swap({ kind: 'client', clientId: c.id })
      return
    }
    const changed = (Object.keys(LABELS) as (keyof Client)[]).filter((k) => JSON.stringify(existing[k]) !== JSON.stringify(clean[k]))
    if (!changed.length) return onClose()
    const patch = Object.fromEntries(changed.map((k) => [k, clean[k]])) as Partial<Client>
    commit((b) => ops.updateClient(b, existing.id, patch, actor, `Updated ${changed.map((k) => LABELS[k]).join(', ')}`), 'Client updated')
    onClose()
  }

  const officers = book.employees.filter((e) => e.active || e.id === d.officerId)

  return (
    <Modal
      title={existing ? `Edit ${existing.name}` : 'Add client'}
      subtitle={existing ? `${existing.ref} · changes are logged` : 'Capture the borrower once — every future loan reuses this record'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>{existing ? 'Save changes' : 'Add client'}</Button>
        </>
      }
    >
      <form
        className="space-y-7"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Block title="Personal details" refEl={refs.personal}>
          <Field label="Full name *" error={nameErr} className="sm:col-span-2">
            <Input value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!section || sectionOf(section) === 'personal'} autoComplete="off" />
          </Field>
          <Field
            label="SA ID number"
            error={dupe ? `Already on the book as ${dupe.name} (${dupe.ref})` : idCheck.reason && (d.idNumber?.length ?? 0) >= 13 ? idCheck.reason : null}
            hint={idCheck.valid ? 'Valid ID · date of birth filled in' : (d.idNumber?.length ?? 0) > 0 && (d.idNumber?.length ?? 0) < 13 ? `${d.idNumber?.length}/13 digits` : 'Special personal information — masked on screen'}
          >
            <Input value={d.idNumber ?? ''} onChange={onId} inputMode="numeric" className="font-mono" autoComplete="off" />
          </Field>
          <Field label="Date of birth">
            <Input type="date" value={d.dob ?? ''} onChange={str('dob')} />
          </Field>
          <Field label="Phone">
            <Input value={d.phone ?? ''} onChange={str('phone')} inputMode="tel" placeholder="060 000 0000" />
          </Field>
          <Field label="Email">
            <Input type="email" value={d.email ?? ''} onChange={str('email')} />
          </Field>
          <Field label="Street address" className="sm:col-span-2">
            <Input value={d.address ?? ''} onChange={str('address')} />
          </Field>
          <Field label="City / town">
            <Input value={d.city ?? ''} onChange={str('city')} />
          </Field>
          <Field label="Province">
            <Select value={d.province ?? ''} onChange={str('province')}>
              <option value="">—</option>
              {PROVINCES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
        </Block>

        <Block title="Employment" refEl={refs.employment}>
          <Field label="Employment type">
            <Select value={d.employment ?? ''} onChange={str('employment')}>
              <option value="">—</option>
              {EMPLOYMENT_TYPES.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Employer">
            <Input value={d.employer ?? ''} onChange={str('employer')} />
          </Field>
          <Field label="Job title">
            <Input value={d.jobTitle ?? ''} onChange={str('jobTitle')} />
          </Field>
          <Field label="Time employed">
            <Input value={d.tenure ?? ''} onChange={str('tenure')} placeholder="e.g. 4 years" />
          </Field>
          <Field label="Net salary (monthly)">
            <MoneyInput value={d.netSalary} onChange={money('netSalary')} />
          </Field>
          <Field label="Gross salary (monthly)">
            <MoneyInput value={d.grossSalary} onChange={money('grossSalary')} />
          </Field>
          <Field label="Other income (monthly)">
            <MoneyInput value={d.otherIncome} onChange={money('otherIncome')} />
          </Field>
        </Block>

        <Block title="Account & banking" refEl={refs.banking}>
          <Field label="Bank">
            <Select value={d.bank ?? ''} onChange={onBank}>
              <option value="">—</option>
              {Object.keys(BANKS).map((b) => <option key={b}>{b}</option>)}
              {d.bank && !(d.bank in BANKS) && <option>{d.bank}</option>}
            </Select>
          </Field>
          <Field label="Branch code" hint={d.bank && BANKS[d.bank] ? 'Universal branch code' : undefined}>
            <Input value={d.branchCode ?? ''} onChange={str('branchCode')} inputMode="numeric" className="font-mono" />
          </Field>
          <Field label="Account number" hint="Debit-order account — masked on screen">
            <Input value={d.accountNo ?? ''} onChange={(e) => set('accountNo', e.target.value.replace(/[^\d]/g, '') || null)} inputMode="numeric" className="font-mono" autoComplete="off" />
          </Field>
          <Field label="Account type">
            <Select value={d.accountType ?? ''} onChange={str('accountType')}>
              <option value="">—</option>
              {ACCOUNT_TYPES.map((p) => <option key={p}>{p}</option>)}
              {d.accountType && !ACCOUNT_TYPES.includes(d.accountType) && <option>{d.accountType}</option>}
            </Select>
          </Field>
          <Field label="Assigned officer">
            <Select value={d.officerId ?? ''} onChange={str('officerId')} disabled={user?.role === 'agent' && !!existing}>
              <option value="">Unassigned</option>
              {officers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </Field>
        </Block>

        <Block title="Monthly expenses" refEl={refs.affordability} aside={<span className="text-[12px] num" style={{ color: 'var(--mut)' }}>Total {zar(expensesTotal(d))}</span>}>
          <Field label="Rent / bond"><MoneyInput value={d.expenses.rent} onChange={exp('rent')} /></Field>
          <Field label="Transport"><MoneyInput value={d.expenses.transport} onChange={exp('transport')} /></Field>
          <Field label="Groceries"><MoneyInput value={d.expenses.groceries} onChange={exp('groceries')} /></Field>
          <Field label="Other debt repayments"><MoneyInput value={d.expenses.otherDebt} onChange={exp('otherDebt')} /></Field>
          <Field label="Other expenses"><MoneyInput value={d.expenses.other} onChange={exp('other')} /></Field>
        </Block>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function Block({ title, children, refEl, aside }: { title: string; children: ReactNode; refEl: React.RefObject<HTMLElement>; aside?: ReactNode }) {
  return (
    <section ref={refEl} className="scroll-mt-4">
      <div className="mb-3 flex items-center justify-between gap-3 pb-2" style={{ borderBottom: '1px solid var(--line)' }}>
        <h3 className="text-[12px] font-bold uppercase tracking-[0.12em]">{title}</h3>
        {aside}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/** Rand input that keeps the user's typing and reports a parsed number. */
function MoneyInput({ value, onChange }: { value: number; onChange: (e: { target: { value: string } }) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: 'var(--dim)' }}>R</span>
      <Input
        value={text}
        inputMode="decimal"
        className="!pl-8 num"
        onChange={(e) => {
          setText(e.target.value)
          onChange(e)
        }}
        placeholder="0"
      />
    </div>
  )
}
