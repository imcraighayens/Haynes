import { useMemo, useState } from 'react'
import { Eye, Printer, ShieldAlert } from 'lucide-react'
import logo from '../../assets/ecoloans-logo.png'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Field, Input } from '../../ui/bits'
import { escapeHtml as e, printHtml } from '../../ui/print'
import { useActor, useBook } from '../../store/book'
import { useAuth } from '../../store/auth'
import { useUi } from '../../store/ui'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import { clientLoans } from '../../domain/loans'
import {
  bankShort, idGrouped, initialsName, isFullyPaid, letterMoney, lettersIssued, longDate, paidUpBlocker, paidUpLetter,
  paymentDatesLabel, PAID_UP_LOG_TYPE, SIGNATORY_TITLE, type PaidUpLetter as Letter,
} from '../../domain/paidUp'
import type { Settings } from '../../domain/types'
import { usePiiVisible } from '../clients/shared'

const FONT_HEAD = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap">'
const PAGE = 'size:A4;margin:0'

/** The Ecoloans paid-up letter, one A4 page (flows onto a second only for very many accounts). */
export function paidUpHtml(L: Letter, s: Settings, idShown: string): string {
  const n = L.accounts.length
  const one = n === 1
  const name = e(initialsName(L.client.name))
  const org = e(s.orgLegalName || s.orgName)
  const bank = bankShort(L.bank)
  const ink = '#0b0b0b'
  const mut = '#5b5f63'
  const cap = 'font-size:9.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase'
  const th = `${cap};letter-spacing:.9px;color:${ink};padding:11px 10px;text-align:left;white-space:nowrap`
  const td = 'padding:11px 10px;font-size:12.5px;white-space:nowrap'
  const pill = `display:inline-block;border:1.2px solid ${ink};border-radius:99px;padding:2px 8px;font-size:9.5px;font-weight:700;letter-spacing:.2px`
  const rows = L.accounts
    .map((a, i) => `<tr style="border-top:${i ? `1px solid #d9dadb` : `1px solid ${ink}`}">
      <td style="${td}">${e(a.accountRef)}</td>
      <td style="${td}">${a.paidCount} of ${a.totalCount}</td>
      <td style="${td};white-space:normal">${e(paymentDatesLabel(a.paymentDates, a.earlierPayments))}</td>
      <td style="${td};text-align:right">${letterMoney(a.totalPaid)}</td>
      <td style="${td};text-align:right">${letterMoney(0)}</td>
      <td style="${td}"><span style="${pill}">PAID UP</span></td>
    </tr>`)
    .join('')
  const accounts = one ? 'this account' : 'these accounts'
  const agreements = one ? 'the credit agreement' : 'the credit agreements'
  const closed = one ? 'the account is closed' : n === 2 ? 'both accounts are closed' : `all ${n} accounts are closed`
  const how = L.debiCheck ? 'by DebiCheck debit order' : 'by debit order'
  const contact = [s.contactEmail && `at ${e(s.contactEmail)}`, s.contactPhone && `on WhatsApp at ${e(s.contactPhone)}`].filter(Boolean).join(' or ')
  const right = [s.ncrRegNo && e(s.ncrRegNo), s.companyRegNo && `Reg. No. ${e(s.companyRegNo)}`].filter(Boolean).join('<br>')

  return `<div style="font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:${ink};width:210mm;min-height:297mm;box-sizing:border-box;padding:13.5mm 18mm 0;display:flex;flex-direction:column;background:#fff;line-height:1.42;font-size:13.5px">
  <div style="display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:9mm;border-bottom:2px solid ${ink}">
    <div><img src="${logo}" alt="${e(s.orgName)}" style="display:block;height:12.4mm;width:auto"/>
      ${s.tagline ? `<div style="font-size:11px;color:${mut};margin-top:3.5mm">${e(s.tagline)}</div>` : ''}</div>
    <div style="text-align:right;font-size:10.5px;line-height:1.6;color:#2b2e31"><div style="font-weight:700;letter-spacing:.6px;color:${ink}">REGISTERED CREDIT PROVIDER</div>${right}</div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:10.5mm">
    <div><div style="${cap};color:${mut};font-size:9px">Issued to</div>
      <div style="font-size:13.5px;margin-top:2mm">${name}</div>
      <div>ID number: ${e(idShown)}</div></div>
    <div style="text-align:right"><div style="${cap};color:${mut};font-size:9px">Date issued</div>
      <div style="font-size:13.5px;margin-top:2mm">${longDate(L.issued)}</div></div>
  </div>

  <div style="${cap};font-size:10px;letter-spacing:2px;margin-top:9mm">Paid-up letter · Section 71A, National Credit Act 34 of 2005</div>
  <div style="font-size:29px;font-weight:800;letter-spacing:-.6px;line-height:1.2;margin-top:2mm">Confirmation of settlement in full</div>
  <p style="margin:3.5mm 0 0">${org} confirms that <b>${name}</b> has settled ${agreements} below in full. The balance on ${one ? 'the account' : 'each account'} is <b>${letterMoney(0)}</b> and no further amounts are due.</p>

  <table style="width:100%;border-collapse:collapse;margin-top:6mm">
    <thead><tr style="border-top:1px solid ${ink}">
      <th style="${th}">Account ref.</th><th style="${th}">Instalments</th><th style="${th}">Payments received</th>
      <th style="${th};text-align:right">Total paid</th><th style="${th};text-align:right">Balance</th><th style="${th}">Status</th>
    </tr></thead>
    <tbody>${rows}
      <tr style="border-top:2px solid ${ink}">
        <td style="${td};font-weight:700" colspan="3">Total</td>
        <td style="${td};text-align:right;font-weight:700">${letterMoney(L.total)}</td>
        <td style="${td};text-align:right;font-weight:700">${letterMoney(0)}</td><td style="${td}"></td>
      </tr>
    </tbody>
  </table>
  <div style="font-size:11px;color:${mut};margin-top:3mm">All payments were collected ${how}${bank ? ` from the client's ${e(bank)} account` : ''}.</div>

  <div style="font-size:13.5px;font-weight:700;margin-top:7.5mm">Closure of ${one ? 'account' : 'accounts'}</div>
  <p style="margin:2mm 0 0">This letter is the paid-up certificate required by section 71A of the National Credit Act. The client has met all obligations under ${one ? 'this agreement' : 'these agreements'}, and ${closed}.</p>
  <ul style="margin:2.5mm 0 0;padding-left:5mm;list-style:disc">
    ${L.debiCheck ? `<li style="margin-bottom:1.5mm">The DebiCheck ${one ? 'mandate linked to this account has' : 'mandates linked to these accounts have'} no further collections scheduled.</li>` : ''}
    <li>${e(s.orgName)} will instruct the credit bureaus to record ${accounts} as <b>paid up / settled in full</b>.</li>
  </ul>
  ${contact ? `<p style="margin:6mm 0 0">For any queries about this letter, contact us ${contact}.</p>` : ''}
  <p style="margin:5mm 0 0">Yours faithfully,</p>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:-7mm">
    <div style="padding-top:21mm">
      <div style="width:68mm;border-top:1px solid ${ink}"></div>
      <div style="font-weight:700;margin-top:3.5mm">${e(L.signatory.name)}</div>
      <div>${e(L.signatory.title)}${L.signatory.title ? ', ' : ''}${org}</div>
    </div>
    <div style="width:33.5mm;height:33.5mm;border:1px dashed ${ink};border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:9.5px;letter-spacing:1.5px;color:${mut};line-height:1.45">COMPANY<br>STAMP</div>
  </div>

  <div style="margin:auto -18mm 0;border-top:2px solid ${ink};padding:6.5mm 18mm 8mm;display:flex;justify-content:space-between;gap:6mm;font-size:10px;color:#2b2e31">
    <div><b style="color:${ink}">${org}</b>${s.address ? ` · ${e(s.address)}` : ''}</div>
    <div style="text-align:right">${[s.contactEmail, s.contactPhone, s.website].filter(Boolean).map(e).join(' · ')}</div>
  </div>
</div>`
}

export function PaidUpLetter({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book, commit, today } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const ui = useUi()
  const piiVisible = usePiiVisible()
  const role = user?.role ?? 'auditor'
  const loan = book.loans.find((l) => l.id === loanId)
  const client = loan ? book.clients.find((c) => c.id === loan.clientId) : undefined
  const blocker = loan ? paidUpBlocker(loan) : 'The loan is no longer on the book.'

  // Every fully paid account of this client can share the letter; accounts that never had one are ticked by default
  const paid = useMemo(() => (client ? clientLoans(book.loans, client.id).filter(isFullyPaid) : []), [book.loans, client])
  const issuedBefore = useMemo(() => lettersIssued(book), [book])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(paid.filter((l) => l.id === loanId || !issuedBefore.has(l.ref)).map((l) => l.id)))
  const [sigName, setSigName] = useState(user?.name ?? '')
  const [sigTitle, setSigTitle] = useState(SIGNATORY_TITLE[role])

  const chosen = paid.filter((l) => l.id === loanId || picked.has(l.id))
  const letter = useMemo(
    () => (client && chosen.length && !blocker ? paidUpLetter(chosen, client, { name: sigName.trim(), title: sigTitle.trim() }, today) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, chosen.map((l) => l.id).join(), blocker, sigName, sigTitle, today, book.loans],
  )
  const idShown = client?.idNumber ? (piiVisible ? idGrouped(client.idNumber) : `•••••• •••• ${client.idNumber.replace(/\D/g, '').slice(-3)}`) : '—'
  const html = useMemo(() => (letter ? paidUpHtml(letter, book.settings, idShown) : ''), [letter, book.settings, idShown])

  if (!loan || !client || blocker) {
    const canFix = loan && !loan.deletedAt && loan.status !== 'written_off' && can(role, 'loan.status')
    return (
      <Modal title="Paid-up letter not available" subtitle={loan ? `${loan.ref} · ${client?.name ?? '—'}` : undefined} onClose={onClose} size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            {canFix && <Button variant="primary" onClick={() => ui.swap({ kind: 'loanStatus', loanId: loan.id })}>Change status</Button>}
          </>
        }
      >
        <div className="flex gap-3 rounded-2xl p-4 text-[13px] leading-relaxed" style={{ background: 'var(--amberSoft, var(--panel2))', border: '1px solid var(--line)' }}>
          <ShieldAlert size={18} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <div>
            <div className="font-semibold">A paid-up letter is issued only once the account is fully paid.</div>
            <div className="mt-1" style={{ color: 'var(--mut)' }}>{blocker}</div>
          </div>
        </div>
      </Modal>
    )
  }

  const canIssue = can(role, 'loan.status')
  const canReveal = can(role, 'client.revealPii')
  const needsReveal = !piiVisible && !!client.idNumber
  const ready = !!letter && canIssue && !needsReveal && sigName.trim().length > 1

  const print = () => {
    if (!letter || !ready) return
    // Re-check against the live book: a status may have changed while the letter was open
    const stale = chosen.map((l) => book.loans.find((x) => x.id === l.id)).find((l) => !l || paidUpBlocker(l))
    if (stale) return
    printHtml(html, `Paid-up letter ${client.name} ${today}`, { page: PAGE, head: FONT_HEAD })
    const refs = letter.accounts.map((a) => a.loanRef)
    commit((b) =>
      letter.accounts.reduce(
        (bb, a) => ops.addNote(bb, actor, {
          type: PAID_UP_LOG_TYPE, ref: a.loanRef, customer: client.name, amount: a.totalPaid,
          comment: [`Account ${a.accountRef}`, refs.length > 1 ? `with ${refs.filter((r) => r !== a.loanRef).join(', ')}` : '', `signed ${letter.signatory.name}`].filter(Boolean).join(' · '),
        }),
        b,
      ),
      `Paid-up letter issued · ${refs.join(', ')}`,
    )
  }

  const reveal = () => {
    ui.setRevealed(true)
    commit((b) => ops.addNote(b, actor, { type: 'PII REVEALED', ref: client.ref, customer: client.name, comment: 'Full ID shown to print a paid-up letter' }))
  }

  return (
    <Modal
      title="Paid-up letter"
      subtitle={`${client.name} · ${chosen.length} account${chosen.length > 1 ? 's' : ''} fully paid`}
      onClose={onClose}
      size="xl"
      footer={
        <>
          {!canIssue && <span className="text-[12px]" style={{ color: 'var(--amber)' }}>Your role can view but not issue paid-up letters.</span>}
          {needsReveal && canIssue && <span className="text-[12px]" style={{ color: 'var(--amber)' }}>The full ID number must be on the letter.</span>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {needsReveal && canIssue && canReveal && <Button variant="outline" icon={<Eye size={14} />} onClick={reveal}>Reveal ID</Button>}
          <Button variant="primary" icon={<Printer size={14} />} disabled={!ready} onClick={print}>Generate PDF</Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-4">
          <div>
            <div className="eyebrow mb-2">Accounts on this letter</div>
            <div className="flex flex-col gap-1.5">
              {paid.map((l) => {
                const locked = l.id === loanId
                const on = locked || picked.has(l.id)
                return (
                  <label key={l.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-[12.5px]" style={{ background: 'var(--panel2)', border: '1px solid var(--line)', opacity: locked ? 0.85 : 1 }}>
                    <input type="checkbox" className="mt-0.5" checked={on} disabled={locked} onChange={() => setPicked((p) => { const n = new Set(p); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n })} />
                    <span className="min-w-0">
                      <span className="block font-mono font-semibold">{l.contractRef || l.mandateId || l.ref}</span>
                      <span className="block" style={{ color: 'var(--mut)' }}>{l.ref}{issuedBefore.has(l.ref) ? ' · letter issued before' : ''}</span>
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--dim)' }}>Only accounts with status Paid and a nil balance can be listed.</p>
          </div>
          <Field label="Signed by" error={sigName.trim().length > 1 ? null : 'Required'}><Input value={sigName} onChange={(ev) => setSigName(ev.target.value)} /></Field>
          <Field label="Title"><Input value={sigTitle} onChange={(ev) => setSigTitle(ev.target.value)} /></Field>
          <p className="text-[11.5px] leading-relaxed" style={{ color: 'var(--dim)' }}>
            Generate PDF opens the print dialog; choose <b>Save as PDF</b>. Each account is logged as {PAID_UP_LOG_TYPE.toLowerCase()}. NCA s71A: issue within 7 days of settlement and send a copy to the credit bureaus.
          </p>
        </div>
        <div className="overflow-auto rounded-[14px] bg-neutral-200 p-3 sm:p-5">
          <div className="mx-auto w-fit shadow-[0_12px_32px_rgba(0,0,0,.25)]" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </Modal>
  )
}
