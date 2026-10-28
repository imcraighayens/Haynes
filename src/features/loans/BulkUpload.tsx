import { useMemo, useState, type ChangeEvent } from 'react'
import { Download, FileUp } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Pill, Textarea } from '../../ui/bits'
import { download } from '../../ui/print'
import { useActor, useBook } from '../../store/book'
import * as ops from '../../store/ops'
import type { Client } from '../../domain/types'
import { blankLoan } from '../../domain/factories'
import { buildSchedule, instalmentFor, live, nextLoanRef } from '../../domain/loans'
import { dateLabel, parseMoney, round2, toIso, zar } from '../../domain/format'
import { TERMS } from './shared'

export interface BulkRow {
  line: number
  raw: string
  client: string
  clientId: string | null
  amount: number
  term: number
  due: string | null
  purpose: string
  errors: string[]
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Split a CSV line, honouring quotes. Accepts comma, semicolon or tab. */
function cells(line: string): string[] {
  const d = line.includes('\t') ? '\t' : (line.match(/;/g)?.length ?? 0) > (line.match(/,/g)?.length ?? 0) ? ';' : ','
  const out: string[] = []
  let cur = '', q = false
  for (const ch of line) {
    if (ch === '"') q = !q
    else if (ch === d && !q) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

/** Port of the prototype's bulkParse: "client, amount, term, due[, purpose]" per line. */
export function parseBulk(text: string, clients: Client[], today: string): BulkRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const start = /client/i.test(lines[0]) && /amount/i.test(lines[0]) ? 1 : 0
  return lines.slice(start).map((raw, i) => {
    const [rawClient = '', rawAmt = '', rawTerm = '', rawDue = '', ...rest] = cells(raw)
    const key = norm(rawClient)
    const match =
      clients.find((c) => norm(c.name) === key) ||
      clients.find((c) => norm(c.ref) === key) ||
      clients.find((c) => !!c.idNumber && c.idNumber === rawClient.trim()) ||
      (key.length > 3 ? clients.find((c) => norm(c.name).startsWith(key)) : undefined)
    const amount = Math.round(parseMoney(rawAmt) || 0)
    const term = parseInt(rawTerm.replace(/[^\d]/g, ''), 10) || 0
    const due = toIso(rawDue)
    const errors: string[] = []
    if (!match) errors.push(`No client matching “${rawClient || '—'}”`)
    else if (match.blocked) errors.push(`${match.name} is blocked`)
    if (!amount) errors.push('Amount missing or invalid')
    else if (amount < 500 || amount > 200000) errors.push('Amount outside R500–R200 000')
    if (!(TERMS as readonly number[]).includes(term)) errors.push('Term must be 1, 2, 3 or 6 months')
    if (!rawDue.trim()) errors.push('Due date missing')
    else if (!due) errors.push(`Can’t read date “${rawDue}”`)
    else if (due < today) errors.push('Due date is in the past')
    return { line: start + i + 1, raw, client: match?.name ?? (rawClient || '—'), clientId: match?.id ?? null, amount, term, due, purpose: rest.join(', ').trim() || 'Personal', errors }
  })
}

const TEMPLATE = 'client,amount,term,due,purpose\nThando Mokoena,2500,1,2026-11-25,School fees\nEC-011,6000,3,25 Nov 2026,Car repairs\n'

export function BulkUpload({ onClose }: { onClose: () => void }) {
  const { book, commit, today } = useBook()
  const actor = useActor()
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const clients = useMemo(() => live(book.clients), [book.clients])
  const rows = useMemo(() => parseBulk(text, clients, today), [text, clients, today])
  const ready = rows.filter((r) => !r.errors.length && !skip.has(r.line))
  const rate = book.settings.defaultReturnRatePct
  const fee = book.settings.defaultCollectionFee

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    setText(await f.text())
    setSkip(new Set())
    e.target.value = ''
  }

  const apply = () => {
    const n = ready.length
    commit((b) => {
      let nb = b
      for (const r of ready) {
        const loan = blankLoan({
          ref: nextLoanRef(nb.loans),
          clientId: r.clientId!,
          principal: r.amount,
          returnRatePct: rate,
          instalmentAmount: instalmentFor(r.amount, rate, r.term),
          collectionFee: fee,
          schedule: buildSchedule(r.due!, r.term),
          purpose: r.purpose,
          issuedOn: today,
        })
        nb = ops.issueLoan(nb, loan, actor, `Bulk upload${fileName ? ` · ${fileName}` : ''} · line ${r.line}`)
      }
      return ops.addNote(nb, actor, { type: 'BULK UPLOAD', ref: `BULK-${n}`, amount: round2(ready.reduce((s, r) => s + r.amount, 0)), comment: `${n} loan(s) issued${rows.length - n ? ` · ${rows.length - n} skipped` : ''}${fileName ? ` · ${fileName}` : ''}` })
    }, `${n} loan${n === 1 ? '' : 's'} issued`)
    onClose()
  }

  return (
    <Modal
      title="Bulk upload loans"
      subtitle="Paste or upload one loan per line: client, amount, term (1/2/3/6), due date, purpose"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon={<Download size={14} />} onClick={() => download('ledger-bulk-template.csv', TEMPLATE, 'text/csv')}>Template</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready.length} onClick={apply}>
            Issue {ready.length} loan{ready.length === 1 ? '' : 's'}{ready.length ? ` · ${zar(ready.reduce((s, r) => s + r.amount, 0))}` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-[12px] font-bold uppercase" style={{ border: '1px solid var(--line2)' }}>
            <FileUp size={14} /> {fileName || 'Choose CSV'}
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={onFile} />
          </label>
          <span className="text-[12px]" style={{ color: 'var(--mut)' }}>Clients match on name, ref (EC-0nn) or ID number. Return {rate}%{fee ? ` · fee ${zar(fee)}` : ''} from settings.</span>
        </div>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSkip(new Set())
          }}
          className="min-h-[120px] font-mono text-[12.5px]"
          placeholder={'client, amount, term, due, purpose\nThando Mokoena, 2500, 1, 25 Nov 2026, School fees'}
          aria-label="Loans to upload"
        />
        {!!rows.length && (
          <>
            <div className="flex flex-wrap gap-2 text-[12px]">
              <Pill tone="green">{rows.filter((r) => !r.errors.length).length} valid</Pill>
              {rows.some((r) => r.errors.length) && <Pill tone="red">{rows.filter((r) => r.errors.length).length} with errors</Pill>}
              {skip.size > 0 && <Pill tone="mut">{skip.size} skipped</Pill>}
            </div>
            <div className="overflow-x-auto rounded-[18px]" style={{ border: '1px solid var(--line)' }}>
              <table className="w-full min-w-[620px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] font-semibold tracking-[0.08em]" style={{ background: 'var(--panel3)', color: 'var(--mut)' }}>
                    <th className="px-3 py-2.5">USE</th>
                    <th className="px-3 py-2.5">LINE</th>
                    <th className="px-3 py-2.5">CLIENT</th>
                    <th className="px-3 py-2.5 text-right">AMOUNT</th>
                    <th className="px-3 py-2.5">TERM</th>
                    <th className="px-3 py-2.5">FIRST DUE</th>
                    <th className="px-3 py-2.5">PURPOSE / ISSUE</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const bad = r.errors.length > 0
                    return (
                      <tr key={r.line} style={{ borderTop: '1px solid var(--line)', background: bad ? 'var(--redSoft)' : undefined, opacity: skip.has(r.line) ? 0.5 : 1 }}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={bad}
                            checked={!bad && !skip.has(r.line)}
                            aria-label={`Include line ${r.line}`}
                            onChange={() => setSkip((s) => {
                              const n = new Set(s)
                              if (n.has(r.line)) n.delete(r.line)
                              else n.add(r.line)
                              return n
                            })}
                          />
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--dim)' }}>{r.line}</td>
                        <td className="px-3 py-2 font-semibold">{r.client}</td>
                        <td className="px-3 py-2 text-right num">{r.amount ? zar(r.amount) : '—'}</td>
                        <td className="px-3 py-2">{r.term ? `${r.term}M` : '—'}</td>
                        <td className="px-3 py-2">{r.due ? dateLabel(r.due) : '—'}</td>
                        <td className="px-3 py-2" style={{ color: bad ? 'var(--red)' : 'var(--mut)' }}>{bad ? r.errors.join(' · ') : r.purpose}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
