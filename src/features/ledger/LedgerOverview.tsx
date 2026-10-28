import { useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, FileSpreadsheet, Landmark, Pencil, Plus, Trash2 } from 'lucide-react'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import { bankPosition, monthFlows, monthlyExpenses } from '../../domain/bank'
import { collected, expectedReturn, live, principalOf, remainingInstalments } from '../../domain/loans'
import { dateTimeLabel, MONTH_NAMES, parseMoney, round2, uid, zar } from '../../domain/format'
import type { Expense } from '../../domain/types'
import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { Empty, Eyebrow, Field, Input, Pill, Textarea } from '../../ui/bits'

type BankDialog = null | { kind: 'balance' } | { kind: 'in' | 'out' }

export function LedgerOverview() {
  const { book, today, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const canBank = !!user && can(user.role, 'bank.manage')
  const canRecon = !!user && can(user.role, 'loan.status')
  const [dialog, setDialog] = useState<BankDialog>(null)

  const bank = bankPosition(book)
  const flows = monthFlows(book, today)
  const month = `${MONTH_NAMES[+today.slice(5, 7) - 1]} ${today.slice(0, 4)}`

  const summary = useMemo(() => {
    const loans = live(book.loans)
    const er = expectedReturn(loans)
    const open = loans.filter((l) => l.status === 'issued' || l.status === 'overdue')
    return {
      expected: er,
      collected: round2(loans.reduce((s, l) => s + collected(l), 0)),
      writtenOff: round2(loans.filter((l) => l.status === 'written_off').reduce((s, l) => s + l.instalmentAmount * remainingInstalments(l), 0)),
      writtenOffCount: loans.filter((l) => l.status === 'written_off').length,
      principalOut: round2(open.reduce((s, l) => s + principalOf(l), 0)),
      openCount: open.length,
      unrecorded: open.filter((l) => l.principal == null).length,
    }
  }, [book.loans])

  return (
    <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
      <div className="flex flex-col gap-4">
        {/* Bank */}
        <section className="glass flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Eyebrow className="flex items-center gap-2"><Landmark size={13} /> Bank balance</Eyebrow>
              <div className="mt-2 text-[38px] font-extrabold leading-none tracking-[-0.02em] num">{zar(bank.balance)}</div>
              <div className="mt-2 text-[12px]" style={{ color: bank.derived ? 'var(--amber)' : 'var(--mut)' }}>
                {bank.derived
                  ? 'Derived from activity — collections minus loans issued. Capture the real balance to anchor it.'
                  : `Anchored to the balance captured ${dateTimeLabel(book.settings.bankOpeningAt)} plus ${bank.moves.length} movement${bank.moves.length === 1 ? '' : 's'} since.`}
              </div>
            </div>
            {canBank && (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'balance' })}>Set balance</Button>
                <Button variant="outline" size="sm" icon={<ArrowDownLeft size={13} />} onClick={() => setDialog({ kind: 'in' })}>Money in</Button>
                <Button variant="outline" size="sm" icon={<ArrowUpRight size={13} />} onClick={() => setDialog({ kind: 'out' })}>Money out</Button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Flow label={`IN · ${month.toUpperCase()}`} value={zar(flows.inflow)} color="var(--green)" />
            <Flow label={`OUT · ${month.toUpperCase()}`} value={zar(flows.outflow)} color="var(--red)" />
            <Flow label="NET" value={zar(round2(flows.inflow - flows.outflow))} color={flows.inflow - flows.outflow >= 0 ? 'var(--ink)' : 'var(--red)'} />
          </div>
        </section>

        {/* Movements */}
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <Eyebrow>Recent bank movements</Eyebrow>
            {canRecon && (
              <Button variant="blue" size="sm" icon={<FileSpreadsheet size={13} />} onClick={() => ui.open({ kind: 'recon' })}>Import NuPay report</Button>
            )}
          </div>
          {bank.moves.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <tbody>
                  {bank.moves.slice(0, 14).map((t) => (
                    <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td className="whitespace-nowrap px-5 py-2.5 num" style={{ color: 'var(--mut)' }}>{dateTimeLabel(t.at)}</td>
                      <td className="px-3 py-2.5 font-semibold">{t.ref}</td>
                      <td className="px-3 py-2.5" style={{ color: 'var(--mut)' }}>{t.label}</td>
                      <td className="whitespace-nowrap px-3 py-2.5" style={{ color: 'var(--dim)' }}>{t.by}</td>
                      <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold num" style={{ color: t.type === 'in' ? 'var(--green)' : 'var(--red)' }}>
                        {t.type === 'in' ? '+' : '−'}{zar(t.amount).replace('R ', 'R ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No bank movements yet. Issuing loans, recording payments and NuPay imports add them automatically.</Empty>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-4">
        {/* Book summary */}
        <section className="panel p-6">
          <Eyebrow>Book summary</Eyebrow>
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5">
            <Big label="Expected return" value={zar(summary.expected.total)} sub={`${summary.expected.open} open · principal ${zar(summary.expected.principal)} · interest ${zar(summary.expected.interest)}`} />
            <Big label="Collected to date" value={zar(summary.collected)} sub="all instalments marked paid" color="var(--green)" />
            <Big label="Principal on the street" value={zar(summary.principalOut)} sub={`${summary.openCount} open loans${summary.unrecorded ? ` · ${summary.unrecorded} with lent amount estimated` : ''}`} />
            <Big label="Written off" value={zar(summary.writtenOff)} sub={`${summary.writtenOffCount} loan${summary.writtenOffCount === 1 ? '' : 's'}`} color={summary.writtenOff ? 'var(--red)' : undefined} />
          </div>
        </section>

        <Expenses canEdit={canBank} onChange={(fn) => commit(fn)} items={book.expenses.filter((x) => !x.deletedAt)} actor={actor} />
      </div>

      {dialog && (
        <BankDialogModal
          dialog={dialog}
          current={bank.balance}
          onClose={() => setDialog(null)}
          onSave={(amount, note) => {
            if (dialog.kind === 'balance') commit((b) => ops.setBankBalance(b, amount, actor, note), `Bank balance set to ${zar(amount)}`)
            else commit((b) => ops.addBankTx(b, dialog.kind as 'in' | 'out', amount, 'MANUAL', note || (dialog.kind === 'in' ? 'Money in' : 'Money out'), actor), `${dialog.kind === 'in' ? 'Money in' : 'Money out'} · ${zar(amount)}`)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function Flow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
      <div className="truncate text-[9.5px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className="mt-1 text-[16px] font-bold num" style={{ color }}>{value}</div>
    </div>
  )
}

function Big({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium" style={{ color: 'var(--mut)' }}>{label}</div>
      <div className="mt-1 text-[22px] font-bold num" style={{ color: color ?? 'var(--ink)' }}>{value}</div>
      <div className="text-[11px] leading-snug" style={{ color: 'var(--dim)' }}>{sub}</div>
    </div>
  )
}

function Expenses({ items, canEdit, onChange, actor }: { items: Expense[]; canEdit: boolean; onChange: (fn: (b: import('../../domain/types').Book) => import('../../domain/types').Book) => void; actor: ops.Actor }) {
  const [editing, setEditing] = useState<{ id: string | null; name: string; amount: string } | null>(null)
  const total = monthlyExpenses(items)
  const save = () => {
    if (!editing) return
    const amount = parseMoney(editing.amount)
    if (!editing.name.trim() || !(amount >= 0)) return
    const x: Expense = { id: editing.id ?? uid('x_'), name: editing.name.trim(), amount: round2(amount), deletedAt: null }
    onChange((b) => ops.upsertExpense(b, x, actor))
    setEditing(null)
  }
  return (
    <section className="panel p-6">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>Monthly office expenses</Eyebrow>
        {canEdit && !editing && (
          <Button variant="soft" size="sm" icon={<Plus size={13} />} onClick={() => setEditing({ id: null, name: '', amount: '' })}>Add</Button>
        )}
      </div>
      <div className="mt-3 flex flex-col">
        {items.map((x) =>
          editing?.id === x.id ? (
            <ExpenseEditor key={x.id} editing={editing} setEditing={setEditing} save={save} />
          ) : (
            <div key={x.id} className="group flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--line)' }}>
              <span className="flex-1 text-[13.5px]">{x.name}</span>
              <span className="text-[13.5px] font-semibold num">{zar(x.amount)}</span>
              {canEdit && (
                <span className="flex gap-1">
                  <button className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]" aria-label={`Edit ${x.name}`} onClick={() => setEditing({ id: x.id, name: x.name, amount: String(x.amount) })}><Pencil size={13} /></button>
                  <button className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)]" style={{ color: 'var(--red)' }} aria-label={`Remove ${x.name}`} onClick={() => onChange((b) => ops.removeExpense(b, x.id, actor))}><Trash2 size={13} /></button>
                </span>
              )}
            </div>
          ),
        )}
        {editing && editing.id === null && <ExpenseEditor editing={editing} setEditing={setEditing} save={save} />}
        {!items.length && !editing && <div className="py-4 text-[13px]" style={{ color: 'var(--mut)' }}>No recurring expenses captured.</div>}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>TOTAL PER MONTH</span>
        <span className="text-[18px] font-bold num">{zar(total)}</span>
      </div>
    </section>
  )
}

function ExpenseEditor({ editing, setEditing, save }: { editing: { id: string | null; name: string; amount: string }; setEditing: (e: { id: string | null; name: string; amount: string } | null) => void; save: () => void }) {
  return (
    <form className="flex flex-wrap items-center gap-2 py-2" style={{ borderBottom: '1px solid var(--line)' }} onSubmit={(e) => { e.preventDefault(); save() }}>
      <Input className="min-w-[140px] flex-1 !py-2" placeholder="Expense name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus aria-label="Expense name" />
      <Input className="!w-[120px] !py-2" placeholder="R / month" inputMode="decimal" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} aria-label="Monthly amount" />
      <Button type="submit" variant="primary" size="sm">Save</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
    </form>
  )
}

function BankDialogModal({ dialog, current, onClose, onSave }: { dialog: NonNullable<BankDialog>; current: number; onClose: () => void; onSave: (amount: number, note: string) => void }) {
  const [amount, setAmount] = useState(dialog.kind === 'balance' ? String(current) : '')
  const [note, setNote] = useState('')
  const n = parseMoney(amount)
  const ok = Number.isFinite(n) && (dialog.kind === 'balance' ? true : n > 0)
  const title = dialog.kind === 'balance' ? 'Set bank balance' : dialog.kind === 'in' ? 'Record money in' : 'Record money out'
  return (
    <Modal
      title={title}
      subtitle={dialog.kind === 'balance' ? 'Capture the balance from your banking app. Later movements are added on top of it.' : 'For movements that are not a loan or a collection — e.g. capital injected, bank charges.'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onSave(round2(n), note.trim())}>Save</Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (ok) onSave(round2(n), note.trim()) }}>
        <Field label="Amount (R)">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label={dialog.kind === 'balance' ? 'Note (e.g. statement date)' : 'Description'}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {dialog.kind === 'balance' && (
          <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--mut)' }}>
            Current figure <Pill tone="mut">{zar(current)}</Pill>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}
