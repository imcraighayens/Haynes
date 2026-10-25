import { useRef, useState } from 'react'
import { Eraser, PenLine, Printer } from 'lucide-react'
import type { Client, Settings } from '../../domain/types'
import { useBook, useActor } from '../../store/book'
import { useAuth } from '../../store/auth'
import * as ops from '../../store/ops'
import { can } from '../../domain/permissions'
import { fillContract } from '../../domain/factories'
import { dateLabel, maskTail, todayIso } from '../../domain/format'
import { Modal } from '../../ui/Modal'
import { Button } from '../../ui/Button'
import { Empty, Pill } from '../../ui/bits'
import { escapeHtml, printHtml } from '../../ui/print'
import { SignaturePad, type SignaturePadHandle } from './SignaturePad'
import { usePiiVisible } from './shared'

function contractVars(c: Client, s: Settings, showPii: boolean) {
  return {
    org: s.orgLegalName || s.orgName,
    client: c.name || 'the client',
    id: showPii ? c.idNumber ?? '—' : maskTail(c.idNumber),
    rate: `${s.defaultReturnRatePct}%`,
  }
}

/** Print-ready agreement (inline styles only — it is printed in an isolated iframe). */
function contractHtml(c: Client, s: Settings, showPii: boolean): string {
  const v = contractVars(c, s, showPii)
  const acct = c.accountNo ? (showPii ? c.accountNo : `••• ${c.accountNo.slice(-4)}`) : '—'
  const sig = c.contract.signature
    ? `<img src="${c.contract.signature}" alt="Client signature" style="height:64px"/>`
    : '<div style="border-bottom:1px solid #999;width:240px;height:44px"></div>'
  return `<div style="max-width:720px;margin:0 auto;color:#111;line-height:1.7">
<div style="text-align:center;border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px">
<div style="font-size:20px;font-weight:700;letter-spacing:.5px">${escapeHtml(v.org)}</div>
${s.ncrRegNo ? `<div style="font-size:11px;color:#555;margin-top:4px">Registered credit provider ${escapeHtml(s.ncrRegNo)}</div>` : ''}
<div style="font-size:11px;letter-spacing:2px;color:#555;margin-top:6px">MASTER CREDIT AGREEMENT · ${escapeHtml(c.contract.no || '—')}</div></div>
<p style="margin:0 0 16px">${escapeHtml(fillContract(s.contractIntro, v))}</p>
${s.contractClauses.map((cl, i) => `<p style="margin:0 0 10px;display:flex;gap:10px"><b>${i + 1}.</b><span>${escapeHtml(fillContract(cl, v))}</span></p>`).join('')}
<table style="margin:22px 0;font-size:13px"><tr><td><b>Client:</b> ${escapeHtml(c.name)}</td><td><b>ID:</b> ${escapeHtml(v.id)}</td></tr>
<tr><td><b>Debit account:</b> ${escapeHtml(c.bank ?? '—')} · ${escapeHtml(acct)}</td><td><b>Signed on:</b> ${c.contract.signature ? escapeHtml(dateLabel(c.contract.signedOn)) : '—'}</td></tr></table>
<div style="margin-top:40px"><div style="font-size:11px;letter-spacing:1px;color:#555;margin-bottom:6px">CLIENT SIGNATURE</div>${sig}</div></div>`
}

export function ContractModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { book, commit } = useBook()
  const actor = useActor()
  const { user } = useAuth()
  const showPii = usePiiVisible()
  const pad = useRef<SignaturePadHandle>(null)
  const c = book.clients.find((x) => x.id === clientId)
  const [signing, setSigning] = useState(() => !c?.contract.signature)
  const [hasInk, setHasInk] = useState(false)

  if (!c)
    return (
      <Modal title="Contract" onClose={onClose} size="sm">
        <Empty>Client not found.</Empty>
      </Modal>
    )

  const s = book.settings
  const v = contractVars(c, s, showPii)
  const canSign = !c.deletedAt && can(user!.role, 'client.edit')
  const signed = !!c.contract.signature

  const accept = () => {
    const url = pad.current?.toDataUrl()
    if (!url) return
    const today = todayIso()
    commit(
      (b) => ops.updateClient(b, c.id, { contract: { ...c.contract, signature: url, signedOn: today } }, actor, `Contract ${c.contract.no} signed`),
      'Agreement signed',
    )
    setSigning(false)
  }

  return (
    <Modal
      title="Master credit agreement"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-2">
          {c.name} · {c.contract.no || 'no agreement number'}
          {signed ? <Pill tone="green">Signed {dateLabel(c.contract.signedOn)}</Pill> : <Pill tone="amber">Not signed</Pill>}
        </span>
      }
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="ghost" icon={<Printer size={15} />} onClick={() => printHtml(contractHtml(c, s, showPii), `${c.contract.no} ${c.name}`)}>
            Print / save PDF
          </Button>
          {signing ? (
            <>
              {signed && <Button variant="outline" onClick={() => setSigning(false)}>Keep existing</Button>}
              <Button variant="primary" icon={<PenLine size={15} />} disabled={!hasInk} onClick={accept}>Accept signature</Button>
            </>
          ) : (
            canSign && <Button variant="outline" icon={<PenLine size={15} />} onClick={() => { setSigning(true); setHasInk(false) }}>Re-sign</Button>
          )}
        </>
      }
    >
      <article className="rounded-2xl px-6 py-7 sm:px-9" style={{ background: '#fbfaf6', color: '#141414', fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1.7 }}>
        <header className="mb-6 pb-4 text-center" style={{ borderBottom: '2px solid #141414' }}>
          <div className="text-[19px] font-bold">{v.org}</div>
          {s.ncrRegNo && <div className="mt-1 text-[11px]" style={{ color: '#555' }}>Registered credit provider {s.ncrRegNo}</div>}
          <div className="mt-1.5 text-[11px] tracking-[0.2em]" style={{ color: '#555' }}>MASTER CREDIT AGREEMENT · {c.contract.no || '—'}</div>
        </header>
        <p className="mb-4 text-[14px]">{fillContract(s.contractIntro, v)}</p>
        <ol className="space-y-2 text-[14px]">
          {s.contractClauses.map((cl, i) => (
            <li key={i} className="flex gap-2.5">
              <b>{i + 1}.</b>
              <span>{fillContract(cl, v)}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          <div><b>Client:</b> {c.name}</div>
          <div><b>ID:</b> {v.id}</div>
          <div><b>Debit account:</b> {c.bank ?? '—'} · {c.accountNo ? (showPii ? c.accountNo : `••• ${c.accountNo.slice(-4)}`) : '—'}</div>
          <div><b>Signed on:</b> {signed ? dateLabel(c.contract.signedOn) : '—'}</div>
        </div>

        <div className="mt-8">
          <div className="mb-2 text-[11px] tracking-[0.12em]" style={{ color: '#555' }}>CLIENT SIGNATURE</div>
          {signing && canSign ? (
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <SignaturePad ref={pad} onChange={(empty) => setHasInk(!empty)} />
              <div className="mt-2 flex items-center justify-between text-[11.5px]" style={{ color: '#6b685e' }}>
                <span>The client signs once; the agreement covers every future advance.</span>
                <button onClick={() => pad.current?.clear()} className="inline-flex items-center gap-1.5 font-semibold" style={{ color: '#141414' }}>
                  <Eraser size={13} /> Clear
                </button>
              </div>
            </div>
          ) : signed ? (
            <img src={c.contract.signature!} alt={`Signature of ${c.name}`} className="h-[72px]" />
          ) : (
            <div className="h-11 w-60" style={{ borderBottom: '1px solid #999' }} />
          )}
        </div>
      </article>
    </Modal>
  )
}
