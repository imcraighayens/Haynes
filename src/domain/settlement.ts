import type { Client, Loan, Settings } from './types'
import { addBusinessDays, round2, todayIso } from './format'
import { outstanding, collected, totalReturn } from './loans'

/** Deterministic verification code printed on letters, e.g. VC-0094-1K3FQ. */
export function verifyCode(ref: string): string {
  let h = 0
  for (let i = 0; i < ref.length; i++) h = (h * 31 + ref.charCodeAt(i)) >>> 0
  return `VC-${ref.replace(/\D/g, '').slice(-4).padStart(4, '0')}-${h.toString(36).toUpperCase().slice(0, 5)}`
}

export interface SettlementData {
  title: 'SETTLEMENT QUOTATION' | 'PAID-UP LETTER'
  no: string
  code: string
  verifyUrl: string
  issued: string
  /** Quotes are valid for 5 business days */
  expires: string
  client: Client
  loan: Loan
  /** Return still owed on the loan */
  subtotal: number
  protectionFee: number
  total: number
  collectedToDate: number
  totalReturn: number
  paid: boolean
}

export function settlementData(loan: Loan, client: Client, settings: Settings, today = todayIso()): SettlementData {
  const paid = loan.status === 'paid' || loan.status === 'settled_early' || loan.instalmentsPaid >= loan.schedule.length
  const subtotal = paid ? 0 : outstanding(loan)
  const hasBank = !!client.bank
  const protectionFee = !paid && hasBank ? settings.protectionFee : 0
  const code = verifyCode(loan.ref)
  const host = settings.orgName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'ledger'
  return {
    title: paid ? 'PAID-UP LETTER' : 'SETTLEMENT QUOTATION',
    no: `${paid ? 'PU' : 'SQ'}-${loan.ref.replace(/\D/g, '')}`,
    code,
    verifyUrl: `verify.${host}.co.za/${code}`,
    issued: today,
    expires: addBusinessDays(today, 5),
    client,
    loan,
    subtotal,
    protectionFee,
    total: round2(subtotal + protectionFee),
    collectedToDate: collected(loan),
    totalReturn: totalReturn(loan),
    paid,
  }
}
