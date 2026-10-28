import { useRef, useState } from 'react'
import { AlertTriangle, Cloud, CloudOff, Database, Download, FileJson, RefreshCw, Upload } from 'lucide-react'
import { useBook } from '../../store/book'
import { DEFAULT_SETTINGS } from '../../domain/factories'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import { can } from '../../domain/permissions'
import { supabaseHost } from '../../lib/supabase'
import { importPrototypeBook } from '../../domain/importPrototype'
import { dateTimeLabel } from '../../domain/format'
import { principalOf } from '../../domain/loans'
import type { Book } from '../../domain/types'
import { Button } from '../../ui/Button'
import { Eyebrow, Pill, Textarea } from '../../ui/bits'
import { download, toCsv } from '../../ui/print'

interface Pending {
  book: Book
  source: string
  summary: string
  warnings: string[]
}

/** A LEDGER export is a Book: it has settings and loans in the new shape. */
function isLedgerExport(v: unknown): v is Book {
  const o = v as Partial<Book> | null
  return !!o && typeof o === 'object' && !!o.settings && Array.isArray(o.loans) && Array.isArray(o.clients) && (o.loans.length === 0 || 'instalmentAmount' in (o.loans[0] as object))
}

export function LedgerData() {
  const { book, today, sync, replace, reload } = useBook()
  const { user, mode } = useAuth()
  const ui = useUi()
  const file = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const canImport = !!user && can(user.role, 'data.import')

  const parse = (raw: string, source: string) => {
    setErr(null)
    setPending(null)
    try {
      const json = JSON.parse(raw.trim())
      if (isLedgerExport(json)) {
        setPending({ book: json, source, summary: `${json.clients.length} clients · ${json.loans.length} loans · ${json.logbook?.length ?? 0} log entries`, warnings: [] })
        return
      }
      const r = importPrototypeBook(json, book)
      setPending({ book: r.book, source, summary: r.summary, warnings: r.warnings })
    } catch (e) {
      setErr(e instanceof SyntaxError ? 'That is not valid JSON — copy the whole value, including the outer { }.' : String((e as Error).message ?? e))
    }
  }

  const confirmImport = () => {
    if (!pending) return
    ui.open({
      kind: 'confirm',
      title: 'Replace the book?',
      body: `This replaces every client, loan and log entry ${mode === 'supabase' ? 'in Supabase' : 'in this browser'} with the imported book (${pending.summary}). Export the current book first if you may need it.`,
      confirmLabel: 'Import book',
      danger: true,
      requireText: 'IMPORT',
      onConfirm: () => {
        void replace(pending.book, `Imported ${pending.summary}`)
        setPending(null)
        setText('')
      },
    })
  }

  const exportJson = () => download(`ledger-book-${today}.json`, JSON.stringify(book, null, 2), 'application/json')
  const exportClients = () =>
    download(
      `ledger-clients-${today}.csv`,
      toCsv([
        ['Ref', 'Name', 'ID number', 'Phone', 'Email', 'City', 'Province', 'Employer', 'Net salary', 'Bank', 'Account', 'Blocked', 'Added', 'Archived'],
        ...book.clients.map((c) => [c.ref, c.name, c.idNumber, c.phone, c.email, c.city, c.province, c.employer, c.netSalary, c.bank, c.accountNo, c.blocked ? 'yes' : '', c.createdAt.slice(0, 10), c.deletedAt?.slice(0, 10)]),
      ]),
      'text/csv',
    )
  const exportLoans = () =>
    download(
      `ledger-loans-${today}.csv`,
      toCsv([
        ['Ref', 'Client ref', 'Client', 'Lent', 'Lent estimated', 'Return %', 'Instalment', 'Collection fee', 'Instalments', 'Paid', 'Status', 'Next due', 'Mandate', 'Issued', 'Archived'],
        ...book.loans.map((l) => {
          const c = book.clients.find((x) => x.id === l.clientId)
          return [l.ref, c?.ref, c?.name, principalOf(l), l.principal == null ? 'yes' : '', l.returnRatePct, l.instalmentAmount, l.collectionFee, l.schedule.length, l.instalmentsPaid, l.status, l.schedule[l.instalmentsPaid] ?? '', l.mandateId, l.issuedOn, l.deletedAt?.slice(0, 10)]
        }),
      ]),
      'text/csv',
    )
  const exportLog = () =>
    download(`ledger-logbook-${today}.csv`, toCsv([['Date', 'Type', 'Ref', 'Customer', 'Amount', 'By', 'Comment'], ...book.logbook.map((g) => [g.at, g.type, g.ref, g.customer, g.amount, g.by, g.comment])]), 'text/csv')

  const statusTone = sync.status === 'error' ? 'red' : mode === 'local' ? 'amber' : 'green'

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel flex flex-col gap-4 p-6">
        <Eyebrow className="flex items-center gap-2"><Database size={13} /> Connection</Eyebrow>
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl" style={{ background: 'var(--panel3)', color: `var(--${statusTone})` }}>
            {mode === 'local' ? <CloudOff size={20} /> : <Cloud size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-bold">{mode === 'local' ? 'This browser only — no database connected' : `Supabase · ${supabaseHost}`}</span>
              <Pill tone={statusTone}>{sync.status === 'error' ? 'ERROR' : sync.status === 'idle' ? (mode === 'local' ? 'LOCAL' : 'CONNECTED') : sync.status.toUpperCase()}</Pill>
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed" style={{ color: 'var(--mut)' }}>
              {mode === 'local'
                ? 'No database is configured, so the book lives in this browser’s storage. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to share one book across devices and users.'
                : `Every change is written to Supabase as it happens and cached on this device. Last sync: ${sync.lastSync ? dateTimeLabel(sync.lastSync) : '—'}.`}
            </p>
            {sync.error && (
              <div className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {sync.error}
              </div>
            )}
          </div>
        </div>
        {mode === 'supabase' && canImport && (
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" size="sm" icon={<RefreshCw size={13} />} onClick={() => void reload()}>Reload from Supabase</Button>
            <Button
              variant="outline"
              size="sm"
              icon={<Upload size={13} />}
              onClick={() =>
                ui.open({
                  kind: 'confirm',
                  title: 'Upload this browser’s book?',
                  body: 'Writes every row cached in this browser to Supabase (insert or overwrite by id). Use it once to move a local book into the database.',
                  confirmLabel: 'Upload',
                  requireText: 'UPLOAD',
                  onConfirm: () => void replace(book, 'Book uploaded to Supabase'),
                })
              }
            >
              Upload this browser’s book
            </Button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Clients', book.clients.filter((c) => !c.deletedAt).length],
            ['Loans', book.loans.filter((l) => !l.deletedAt).length],
            ['Log entries', book.logbook.length],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl px-3 py-3" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
              <div className="text-[20px] font-bold num">{v}</div>
              <div className="text-[10px] font-semibold tracking-[0.1em]" style={{ color: 'var(--mut)' }}>{String(k).toUpperCase()}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel flex flex-col gap-4 p-6">
        <Eyebrow className="flex items-center gap-2"><Download size={13} /> Export</Eyebrow>
        <p className="text-[12.5px]" style={{ color: 'var(--mut)' }}>
          Exports contain borrowers’ personal information (ID and bank numbers). Store them encrypted and delete copies you no longer need (POPIA).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" icon={<FileJson size={13} />} onClick={exportJson}>Full book (JSON)</Button>
          <Button variant="outline" size="sm" onClick={exportClients}>Clients CSV</Button>
          <Button variant="outline" size="sm" onClick={exportLoans}>Loans CSV</Button>
          <Button variant="outline" size="sm" onClick={exportLog}>Logbook CSV</Button>
        </div>
        {mode === 'local' && canImport && (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background: 'var(--panel2)', border: '1px solid var(--line)' }}>
            <span className="text-[12.5px]" style={{ color: 'var(--mut)' }}>Remove every record from this browser and start with an empty book.</span>
            <Button
              variant="ghost"
              size="sm"
              style={{ color: 'var(--red)' }}
              onClick={() =>
                ui.open({
                  kind: 'confirm',
                  title: 'Clear this device’s book?',
                  body: 'Deletes every client, loan and log entry stored in this browser. This cannot be undone — export the book first if you need it.',
                  confirmLabel: 'Reset',
                  danger: true,
                  requireText: 'RESET',
                  onConfirm: () => void replace({ clients: [], loans: [], applications: [], logbook: [], petty: [], expenses: [], bankTx: [], employees: book.employees, settings: { ...DEFAULT_SETTINGS, ...book.settings } }, 'This device’s book is now empty'),
                })
              }
            >
              Clear this device’s book
            </Button>
          </div>
        )}
      </section>

      {canImport && (
        <section className="panel flex flex-col gap-4 p-6 xl:col-span-2">
          <Eyebrow className="flex items-center gap-2"><Upload size={13} /> Import a book</Eyebrow>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <div className="flex flex-col gap-3 text-[13px] leading-relaxed" style={{ color: 'var(--mut)' }}>
              <p><b style={{ color: 'var(--ink)' }}>From the LEDGER prototype.</b> In the browser where you used the prototype, open the DevTools console and run:</p>
              <code className="block select-all rounded-xl px-3 py-2.5 font-mono text-[12px]" style={{ background: 'var(--panel3)', color: 'var(--acc)' }}>copy(localStorage.getItem('evoltConsoleV4'))</code>
              <p>then paste here. The prototype’s Supabase payload (schema ledger-book/2) works too.</p>
              <p><b style={{ color: 'var(--ink)' }}>From a LEDGER export.</b> Choose a “Full book (JSON)” file.</p>
              <p className="text-[12px]" style={{ color: 'var(--dim)' }}>Nothing changes until you confirm. The import is written to the logbook.</p>
            </div>
            <div className="flex flex-col gap-3">
              <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder='{"clients":[…],"loans":[…], …}' className="!min-h-[150px] font-mono !text-[12px]" aria-label="Paste book JSON" />
              <input
                ref={file}
                type="file"
                accept=".json,application/json,.txt"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) parse(await f.text(), f.name)
                  e.target.value = ''
                }}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" disabled={!text.trim()} onClick={() => parse(text, 'pasted JSON')}>Check pasted book</Button>
                <Button variant="outline" size="sm" icon={<FileJson size={13} />} onClick={() => file.current?.click()}>Choose file…</Button>
              </div>
              {err && (
                <div className="shake flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--redSoft)', color: 'var(--red)' }}>
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {err}
                </div>
              )}
              {pending && (
                <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: 'var(--panel2)', border: '1px solid var(--acc)' }}>
                  <div className="text-[13px]"><b>Ready to import</b> from {pending.source}: {pending.summary}</div>
                  {pending.warnings.map((w) => (
                    <div key={w} className="flex items-start gap-2 text-[12px]" style={{ color: 'var(--amber)' }}><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}</div>
                  ))}
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={confirmImport}>Replace book with this…</Button>
                    <Button variant="ghost" size="sm" onClick={() => setPending(null)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
