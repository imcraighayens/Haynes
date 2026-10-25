import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, Upload } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Pill, Segmented, type Tone } from '../../ui/bits'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useToast } from '../../store/toast'
import { can } from '../../domain/permissions'
import { zar } from '../../domain/format'
import { analyse, applyRecon, readReport, type ReconKind, type ReconRow } from './recon'

const KIND: Record<ReconKind, { label: string; tone: Tone }> = {
  paid: { label: 'PAID', tone: 'green' },
  unpaid: { label: 'UNPAID', tone: 'red' },
  new: { label: 'NEW LOAN', tone: 'blue' },
  skip: { label: 'NO CHANGE', tone: 'mut' },
}

type Filter = 'all' | ReconKind

/** Import a NuPay debit-order transaction report and reconcile it against the book. */
export function ReconModal({ onClose }: { onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<string | null>(null)
  const [rows, setRows] = useState<ReconRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const allowed = !!user && can(user.role, 'loan.status')

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true)
    setErr(null)
    try {
      const raw = await readReport(f)
      if (!raw.length) throw new Error(`No transactions found in ${f.name}`)
      setRows(analyse(raw, book))
      setFile(f.name)
    } catch (e) {
      setErr(String((e as Error).message ?? e))
      setRows([])
      setFile(null)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, paid: 0, unpaid: 0, new: 0, skip: 0 }
    rows.forEach((r) => c[r.kind]++)
    return c
  }, [rows])
  const selected = rows.filter((r) => r.on && r.kind !== 'skip')
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter)

  const apply = () => {
    if (!file || !selected.length) return
    let summary = ''
    commit((b) => {
      const { book: nb, counts: n } = applyRecon(b, rows, file, actor)
      summary = [n.paid && `${n.paid} paid`, n.unpaid && `${n.unpaid} unpaid`, n.new && `${n.new} new loan${n.new > 1 ? 's' : ''}`].filter(Boolean).join(' · ')
      return nb
    })
    toast(summary || 'Report applied')
    onClose()
  }

  return (
    <Modal
      size="xl"
      title="Import NuPay report"
      subtitle="Reconcile a debit-order transaction report against the book. Rows match on Mandate ID, then on the debtor’s ID number."
      onClose={onClose}
      footer={
        rows.length ? (
          <>
            <span className="mr-auto text-[12px]" style={{ color: 'var(--mut)' }}>
              {selected.length} of {rows.length} rows will be applied · every change is written to the logbook
            </span>
            <Button variant="ghost" onClick={() => { setRows([]); setFile(null) }}>Choose another file</Button>
            <Button variant="primary" disabled={!selected.length || !allowed} onClick={apply}>Apply {selected.length} change{selected.length === 1 ? '' : 's'}</Button>
          </>
        ) : undefined
      }
    >
      <input ref={input} type="file" accept=".csv,.tsv,.txt,.xlsx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
      {!rows.length ? (
        <div className="flex flex-col gap-4">
          <button
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void onFile(e.dataTransfer.files?.[0])
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-[22px] px-6 py-14 text-center transition hover:brightness-110"
            style={{ border: '1.5px dashed var(--line2)', background: 'var(--panel2)' }}
            disabled={busy}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--accSoft)', color: 'var(--acc)' }}>
              {busy ? <FileSpreadsheet size={22} className="pulse" /> : <Upload size={22} />}
            </span>
            <span className="text-[15px] font-bold">{busy ? 'Reading report…' : 'Drop the NuPay transaction report here'}</span>
            <span className="text-[12.5px]" style={{ color: 'var(--mut)' }}>.xlsx or .csv export · needs a “Mandate ID” column · nothing changes until you press Apply</span>
          </button>
          {err && (
            <div className="shake flex items-start gap-2 rounded-2xl px-4 py-3 text-[13px]" style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}
          <div className="grid gap-3 text-[12.5px] sm:grid-cols-3" style={{ color: 'var(--mut)' }}>
            <p><b style={{ color: 'var(--green)' }}>Success</b> rows mark that instalment (and any earlier unpaid ones) collected and add it to the bank.</p>
            <p><b style={{ color: 'var(--red)' }}>Failed / reversed</b> rows mark the loan overdue with the bank’s reason.</p>
            <p><b style={{ color: 'var(--blue)' }}>Unknown mandates</b> are added as new loans (ECL-F…), creating the client when the ID number isn’t on the book.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <FileSpreadsheet size={16} style={{ color: 'var(--acc)' }} /> {file}
            </div>
            <Segmented<Filter>
              size="sm"
              value={filter}
              onChange={setFilter}
              options={(['all', 'paid', 'unpaid', 'new', 'skip'] as Filter[]).map((k) => ({ value: k, label: `${k === 'all' ? 'ALL' : KIND[k].label} ${counts[k]}` }))}
            />
          </div>
          {!allowed && <div className="text-[12.5px]" style={{ color: 'var(--amber)' }}>Your role can review this report but not apply it.</div>}
          <div className="overflow-x-auto rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
            <table className="w-full min-w-[920px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                  <th className="w-10 px-3 py-2.5" />
                  <th className="px-3 py-2.5">Mandate</th>
                  <th className="px-3 py-2.5">Client</th>
                  <th className="px-3 py-2.5">Inst</th>
                  <th className="px-3 py-2.5 text-right">Debit</th>
                  <th className="px-3 py-2.5">Bank result</th>
                  <th className="px-3 py-2.5">Change</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} style={{ borderTop: '1px solid var(--line)', opacity: r.on || r.kind === 'skip' ? 1 : 0.5 }}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Apply ${r.mid}`}
                        checked={r.on && r.kind !== 'skip'}
                        disabled={r.kind === 'skip'}
                        onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, on: e.target.checked } : x)))}
                        style={{ accentColor: 'var(--acc)', width: 16, height: 16 }}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px]">
                      {r.mid}
                      {r.ref && <div className="font-sans text-[10.5px] font-semibold" style={{ color: 'var(--acc)' }}>{r.ref}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-semibold">{r.clientName}{!r.clientId && r.kind === 'new' && <div className="text-[10.5px] font-medium" style={{ color: 'var(--blue)' }}>new client</div>}</td>
                    <td className="px-3 py-2.5 num">{r.K}/{r.V}<div className="text-[10.5px]" style={{ color: 'var(--dim)' }}>{r.dueLbl ?? r.cycle}</div></td>
                    <td className="px-3 py-2.5 text-right num">{zar(r.deb)}</td>
                    <td className="px-3 py-2.5" style={{ color: r.outcome === 'paid' ? 'var(--green)' : r.outcome === 'unpaid' ? 'var(--red)' : 'var(--mut)' }}>{r.res || '—'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2"><Pill tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Pill><span>{r.action}</span></div>
                      {r.warn && <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: 'var(--amber)' }}><AlertTriangle size={11} /> {r.warn}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <Empty>No rows in this view.</Empty>}
          </div>
        </div>
      )}
    </Modal>
  )
}
