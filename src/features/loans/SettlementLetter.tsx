import { useMemo } from 'react'
import { Printer } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty } from '../../ui/bits'
import { escapeHtml as e, printHtml, qrDataUrl } from '../../ui/print'
import { useActor, useBook } from '../../store/book'
import * as ops from '../../store/ops'
import { settlementData, type SettlementData } from '../../domain/settlement'
import { dateLabel, maskTail, round2 } from '../../domain/format'
import { nextDue, principalOf } from '../../domain/loans'
import type { Settings } from '../../domain/types'
import { usePiiMasked } from './shared'
import { PaidUpLetter } from './PaidUpLetter'

/** Two-decimal amount with space thousands, no currency symbol (letter tables). */
const money = (n: number) => {
  const [i, d] = Math.abs(round2(n)).toFixed(2).split('.')
  return `${n < 0 ? '−' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${d}`
}

/** Small agreement under NCA s9(2)(a): principal debt ≤ R15 000. */
const SMALL_AGREEMENT = 15000

export function letterHtml(d: SettlementData, s: Settings, masked: boolean): string {
  const c = d.client
  const l = d.loan
  const idRaw = (c.idNumber ?? '').replace(/\D/g, '')
  const idShown = !idRaw ? '—' : masked ? `•••••• •••• ${idRaw.slice(-3)}` : idRaw.length === 13 ? `${idRaw.slice(0, 6)} ${idRaw.slice(6, 10)} ${idRaw.slice(10)}` : idRaw
  const acct = c.accountNo ? (masked ? maskTail(c.accountNo, 4, 4) : c.accountNo) : '—'
  const addr = [c.address, [c.city, c.province].filter(Boolean).join(', ')].filter(Boolean).map(e).join('<br>') || '—'
  const small = principalOf(l) <= SMALL_AGREEMENT
  const qr = qrDataUrl(`https://${d.verifyUrl}`, 3)
  const S = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#14181c"
  const lab = 'font-size:7.5px;letter-spacing:2.2px;color:#8a939c;text-transform:uppercase'
  const head = 'font-size:8px;letter-spacing:2.6px;color:#14181c;text-transform:uppercase;border-bottom:1px solid #14181c;padding-bottom:5px;margin:0 0 12px'
  const kv = (k: string, v: string) => `<tr><td style="padding:4px 0;font-size:10.5px;color:#6c757d;width:44%">${k}</td><td style="padding:4px 0;font-size:10.5px;font-weight:600">${v}</td></tr>`
  const line = (k: string, v: string, bold = false) =>
    `<tr><td style="padding:8px 0;border-top:1px solid #e6e9ec;font-size:10.5px;${bold ? 'font-weight:700' : 'color:#42484e'}">${k}</td><td style="padding:8px 0;border-top:1px solid #e6e9ec;text-align:right;font-size:${bold ? 13 : 10.5}px;font-weight:${bold ? 700 : 600};font-variant-numeric:tabular-nums">${v}</td></tr>`
  const summary = (k: string, v: string, accent = false) => `<div style="flex:1;min-width:0"><div style="${lab}">${k}</div><div style="font-size:${accent ? 15 : 11.5}px;font-weight:700;margin-top:5px">${v}</div></div>`
  const org = e(s.orgLegalName).toUpperCase()
  const settledOn = d.paid ? dateLabel(l.statusAt ?? l.schedule[l.schedule.length - 1]) : dateLabel(d.expires)

  return `<div style="${S};line-height:1.55;max-width:720px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #14181c;padding-bottom:12px;margin-bottom:22px">
    <div><div style="font-size:17px;font-weight:800;letter-spacing:2px">${org}</div>
    <div style="font-size:8.5px;letter-spacing:1.4px;color:#6c757d;margin-top:4px">REGISTERED CREDIT PROVIDER${s.ncrRegNo ? ` · ${e(s.ncrRegNo)}` : ''} · NATIONAL CREDIT ACT, 34 OF 2005</div></div>
    <div style="text-align:right"><div style="font-size:8px;letter-spacing:2px;color:#8a939c">DOCUMENT</div><div style="font-size:10.5px;font-weight:700;margin-top:3px">${e(d.no)}</div></div>
  </div>
  <div style="font-size:19px;font-weight:800;letter-spacing:.4px">${d.title}</div>
  <div style="font-size:9.5px;color:#6c757d;margin:5px 0 20px">Issued in terms of Section 125 of the National Credit Act, 34 of 2005</div>
  <div style="display:flex;gap:20px;background:#f4f6f7;border-left:3px solid #14181c;padding:13px 16px;margin-bottom:22px">
    ${summary('Date of issue', dateLabel(d.issued))}
    ${summary(d.paid ? 'Settled on' : 'Settlement date quoted', settledOn)}
    ${summary(d.paid ? 'Account status' : 'Quotation expires', d.paid ? 'CLOSED' : dateLabel(d.expires))}
    ${summary(d.paid ? 'Total settled' : 'Total payable', `R ${money(d.paid ? d.collectedToDate : d.total)}`, true)}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:26px;margin-bottom:22px">
    <div><div style="${head}">Consumer</div><table style="width:100%;border-collapse:collapse">
      ${kv('Full name', e(c.name))}${kv('Identity number', e(idShown))}${kv('Physical address', addr)}${kv('Mobile', e(c.phone ?? '—'))}${kv('Email', e(c.email ?? '—'))}
    </table></div>
    <div><div style="${head}">Credit agreement</div><table style="width:100%;border-collapse:collapse">
      ${kv('Contract reference', e(c.contract.no || '—'))}${kv('Loan reference', e(l.ref))}${kv('Advanced on', dateLabel(l.issuedOn))}
      ${kv('Agreement class', small ? 'Small agreement — NCA s9(2)(a)' : 'Intermediate agreement — NCA s9(3)')}
    </table>
    <div style="${head};margin-top:18px">Scheduled collection</div><table style="width:100%;border-collapse:collapse">
      ${kv('Mandate', e(l.mandateId ?? (c.bank ? 'Debit order — on file' : 'None registered')))}${kv('Collecting bank', e(c.bank ?? '—'))}${kv('Account', e(acct))}
      ${kv('Next collection', d.paid ? '—' : dateLabel(nextDue(l)))}
    </table></div>
  </div>
  <div style="${head}">Settlement calculation as at ${settledOn}</div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:8px">
    <tr><td style="font-size:7.5px;letter-spacing:2px;color:#8a939c;padding-bottom:4px">DESCRIPTION</td><td style="font-size:7.5px;letter-spacing:2px;color:#8a939c;text-align:right;padding-bottom:4px">AMOUNT (ZAR)</td></tr>
    ${line('Total return under the agreement', money(d.totalReturn))}
    ${line('Less: collected to date', `−${money(d.collectedToDate)}`)}
    ${line('Sub-total — outstanding on the credit agreement', money(d.subtotal))}
    ${d.protectionFee > 0 ? line('Protection fee — per agreement', money(d.protectionFee)) : ''}
    ${line(`Early termination charge — ${small ? 'not applicable to a small agreement, s125(2)(b)' : 'per s125(2)(b)'}`, money(0))}
    <tr><td style="padding:10px 0;border-top:2px solid #14181c;font-size:11px;font-weight:800;letter-spacing:.5px">${d.paid ? 'BALANCE OUTSTANDING' : 'TOTAL SETTLEMENT AMOUNT'}</td><td style="padding:10px 0;border-top:2px solid #14181c;text-align:right;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums">R ${money(d.paid ? 0 : d.total)}</td></tr>
  </table>
  <p style="font-size:9.5px;color:#42484e;margin:14px 0 22px">${
    d.paid
      ? `This confirms that ${e(c.name)} has settled credit agreement ${e(l.ref)} in full and that no further amount is owing on it. Any debit-order mandate linked to this agreement is cancelled.`
      : `This quotation is valid until ${dateLabel(d.expires)} (5 business days, NCA s125). Payment of the total settlement amount by that date closes the agreement; after it a new quotation is needed. Use reference <b>${e(l.ref)}</b> when paying.`
  }</p>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:20px;border-top:1px solid #e6e9ec;padding-top:16px">
    <div style="display:flex;gap:14px;align-items:center">
      <img src="${qr}" alt="" style="width:84px;height:84px;image-rendering:pixelated"/>
      <div><div style="${lab}">Verify this document</div><div style="font-size:10.5px;font-weight:700;margin-top:4px">${e(d.verifyUrl)}</div>
      <div style="font-size:9.5px;color:#6c757d;margin-top:2px">Code ${e(d.code)}</div></div>
    </div>
    <div style="text-align:right"><div style="border-bottom:1px solid #14181c;width:200px;height:34px"></div>
    <div style="${lab};margin-top:5px">Authorised signatory · ${e(s.orgLegalName)}</div></div>
  </div>
</div>`
}

export function SettlementLetter({ loanId, onClose }: { loanId: string; onClose: () => void }) {
  const { book, commit, today } = useBook()
  const actor = useActor()
  const masked = usePiiMasked()
  const loan = book.loans.find((l) => l.id === loanId)
  const client = loan ? book.clients.find((c) => c.id === loan.clientId) : undefined
  const data = useMemo(() => (loan && client ? settlementData(loan, client, book.settings, today) : null), [loan, client, book.settings, today])
  const html = useMemo(() => (data ? letterHtml(data, book.settings, masked) : ''), [data, book.settings, masked])

  if (!loan || !client || !data) {
    return (
      <Modal title="Letter unavailable" onClose={onClose} size="sm">
        <Empty>The loan or its client is no longer on the book.</Empty>
      </Modal>
    )
  }

  // Paid accounts get the Ecoloans paid-up letter (NCA s71A), which has its own paid-in-full gate
  if (data.paid) return <PaidUpLetter loanId={loanId} onClose={onClose} />

  const print = () => {
    printHtml(html, `${data.title} ${data.no}`)
    commit((b) => ops.addNote(b, actor, { type: data.paid ? 'PAID-UP LETTER ISSUED' : 'SETTLEMENT LETTER ISSUED', ref: loan.ref, customer: client.name, amount: data.paid ? 0 : data.total, comment: `${data.no} · ${data.code}${data.paid ? '' : ` · valid to ${dateLabel(data.expires)}`}` }))
  }

  return (
    <Modal
      title={data.title === 'PAID-UP LETTER' ? 'Paid-up letter' : 'Settlement quotation'}
      subtitle={`${loan.ref} · ${client.name}${masked ? ' · ID masked — reveal details on the client to print in full' : ''}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Printer size={14} />} onClick={print}>Print / save PDF</Button>
        </>
      }
    >
      <div className="overflow-x-auto rounded-[14px] bg-white p-6 sm:p-9" style={{ boxShadow: '0 1px 0 rgba(0,0,0,.05), 0 12px 32px rgba(0,0,0,.25)' }}>
        <div className="min-w-[560px]" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </Modal>
  )
}
