import { useState } from 'react'
import { Check, UserPlus } from 'lucide-react'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import * as ops from '../../store/ops'
import { ACTION_LABEL, can, PERMISSION_GRID, ROLE_LABEL, type Action } from '../../domain/permissions'
import { dateLabel, parseMoney, uid, zar } from '../../domain/format'
import type { Employee, Role } from '../../domain/types'
import { Button } from '../../ui/Button'
import { Avatar, Eyebrow, Field, Input, Pill, Select } from '../../ui/bits'

const ROLES = Object.keys(ROLE_LABEL) as Role[]
const ALL_ACTIONS = Object.keys(ACTION_LABEL) as Action[]

export function LedgerTeam() {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user, mode, setViewRole } = useAuth()
  const canManage = !!user && can(user.role, 'employees.manage')
  const [draft, setDraft] = useState({ name: '', email: '', role: 'agent' as Role, limit: '' })
  const [tried, setTried] = useState(false)

  const email = draft.email.trim().toLowerCase()
  const errors = {
    name: draft.name.trim().length < 2 ? 'Enter a name' : null,
    email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Enter a valid email' : book.employees.some((e) => e.email.toLowerCase() === email) ? 'Someone already uses this email' : null,
  }

  const update = (e: Employee, patch: Partial<Employee>) => commit((b) => ops.upsertEmployee(b, { ...e, ...patch }, actor), `${e.name} updated`)

  const add = () => {
    setTried(true)
    if (errors.name || errors.email) return
    const e: Employee = { id: uid('e_'), name: draft.name.trim(), email, role: draft.role, active: true, approvalLimit: Math.max(0, parseMoney(draft.limit) || 0), createdAt: new Date().toISOString() }
    commit((b) => ops.upsertEmployee(b, e, actor), `${e.name} added as ${ROLE_LABEL[e.role]}`)
    setDraft({ name: '', email: '', role: 'agent', limit: '' })
    setTried(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Eyebrow>Team · {book.employees.filter((e) => e.active).length} active</Eyebrow>
          {mode === 'supabase' && (
            <span className="text-[11.5px]" style={{ color: 'var(--mut)' }}>Each person also needs a Supabase Auth user with the same email to sign in.</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                <th className="px-5 py-3">Name</th>
                <th className="px-3 py-3">Role</th>
                <th className="px-3 py-3">Approval limit</th>
                <th className="px-3 py-3">Added</th>
                <th className="px-5 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {book.employees.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--line)', opacity: e.active ? 1 : 0.55 }}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={e.name} size={32} />
                      <div className="min-w-0">
                        <div className="font-semibold">{e.name}{e.email === user?.email && <span className="ml-2 text-[10px]" style={{ color: 'var(--acc)' }}>YOU</span>}</div>
                        <div className="text-[11.5px]" style={{ color: 'var(--mut)' }}>{e.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <Select value={e.role} onChange={(ev) => update(e, { role: ev.target.value as Role })} className="!w-[150px] !py-1.5" aria-label={`Role for ${e.name}`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </Select>
                    ) : (
                      <Pill tone="blue">{ROLE_LABEL[e.role]}</Pill>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {canManage ? (
                      <LimitInput value={e.approvalLimit} onSave={(v) => update(e, { approvalLimit: v })} label={`Approval limit for ${e.name}`} />
                    ) : (
                      <span className="num">{e.approvalLimit ? zar(e.approvalLimit) : 'None'}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3" style={{ color: 'var(--mut)' }}>{dateLabel(e.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    {canManage && e.email !== user?.email ? (
                      <button onClick={() => update(e, { active: !e.active })} className="rounded-full px-3 py-1 text-[10px] font-bold tracking-[0.08em]" style={{ background: e.active ? 'var(--greenSoft)' : 'var(--hover)', color: e.active ? 'var(--green)' : 'var(--mut)' }} aria-label={`${e.active ? 'Disable' : 'Enable'} ${e.name}`}>
                        {e.active ? 'ACTIVE' : 'DISABLED'}
                      </button>
                    ) : (
                      <Pill tone={e.active ? 'green' : 'mut'}>{e.active ? 'ACTIVE' : 'DISABLED'}</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canManage && (
          <form className="grid gap-3 p-5 sm:grid-cols-[1.2fr_1.4fr_1fr_0.8fr_auto] sm:items-end" style={{ borderTop: '1px solid var(--line)', background: 'var(--panel2)' }} onSubmit={(ev) => { ev.preventDefault(); add() }}>
            <Field label="Name" error={tried ? errors.name : null}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Email" error={tried ? errors.email : null}><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
            <Field label="Approval limit"><Input inputMode="decimal" placeholder="0" value={draft.limit} onChange={(e) => setDraft({ ...draft, limit: e.target.value })} /></Field>
            <Button type="submit" variant="primary" icon={<UserPlus size={14} />}>Add</Button>
          </form>
        )}
      </section>

      {mode === 'local' && user && (
        <section className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <Eyebrow>Preview as role</Eyebrow>
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--mut)' }}>This device only — see the console as another role. Roles without Ledger access leave this page; sign out and back in to return to Admin.</p>
          </div>
          <Select value={user.role} onChange={(e) => setViewRole(e.target.value as Role)} className="!w-[180px]" aria-label="Preview as role">
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="px-5 py-4"><Eyebrow>What each role can do</Eyebrow></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                <th className="px-5 py-3 text-left">Permission</th>
                {PERMISSION_GRID.map((g) => <th key={g.role} className="px-3 py-3 text-center">{ROLE_LABEL[g.role]}</th>)}
              </tr>
            </thead>
            <tbody>
              {ALL_ACTIONS.map((a) => (
                <tr key={a} style={{ borderTop: '1px solid var(--line)' }}>
                  <td className="px-5 py-2.5">{ACTION_LABEL[a]}</td>
                  {PERMISSION_GRID.map((g) => (
                    <td key={g.role} className="px-3 py-2.5 text-center">
                      {g.actions.includes(a) ? <Check size={15} className="inline" style={{ color: 'var(--green)' }} aria-label="Allowed" /> : <span style={{ color: 'var(--line2)' }} aria-label="Not allowed">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--line)' }}>
                <td className="px-5 py-2.5" style={{ color: 'var(--mut)' }}>Screens</td>
                {PERMISSION_GRID.map((g) => (
                  <td key={g.role} className="px-3 py-2.5 text-center text-[10.5px]" style={{ color: 'var(--mut)' }}>{g.areas.length === 8 ? 'All' : g.areas.join(', ')}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function LimitInput({ value, onSave, label }: { value: number; onSave: (v: number) => void; label: string }) {
  const [v, setV] = useState(String(value || ''))
  const commitIfChanged = () => {
    const n = Math.max(0, parseMoney(v) || 0)
    if (n !== value) onSave(n)
    setV(String(n || ''))
  }
  return (
    <Input
      inputMode="decimal"
      value={v}
      placeholder="None"
      onChange={(e) => setV(e.target.value)}
      onBlur={commitIfChanged}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="!w-[120px] !py-1.5"
      aria-label={label}
    />
  )
}
