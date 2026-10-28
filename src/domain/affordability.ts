import { round2 } from './format'

export type Verdict = 'APPROVE' | 'REFER' | 'DECLINE' | 'NO INCOME' | 'ENTER AMOUNT'

export interface AffordabilityInput {
  netSalary: number
  /** Monthly obligations: living expenses, credit-card debt, existing loans, rent, groceries… */
  obligations: number
  amount: number
  termMonths: number
  ratePct: number
}

export interface AffordabilityResult {
  net: number
  obligations: number
  repayment: number
  disposable: number
  dti: number
  /** Largest loan (rounded down to R500) whose repayment stays within 33% of net pay */
  maxLoan: number
  verdict: Verdict
  tone: 'green' | 'amber' | 'red' | 'dim'
  reason: string
}

/** Repayment must stay ≤ 33% of net pay. */
export const MAX_REPAY_SHARE = 0.33
/** Debt-to-income bands: ≤ 55% approve, ≤ 70% refer, above that decline. */
export const DTI_APPROVE = 0.55
export const DTI_REFER = 0.7

/**
 * The prototype's affordability rule, kept identical so verdicts match:
 * APPROVE when disposable > 0, DTI ≤ 55% and repayment ≤ 33% of net;
 * REFER when disposable > 0 and DTI ≤ 70%; otherwise DECLINE.
 */
export function assessAffordability(i: AffordabilityInput, fmt: (n: number) => string): AffordabilityResult {
  const net = i.netSalary || 0
  const term = Math.max(1, i.termMonths || 1)
  const due = round2(i.amount * (1 + i.ratePct / 100))
  const repayment = round2(due / term)
  const disposable = round2(net - i.obligations - repayment)
  const dti = net ? (i.obligations + repayment) / net : 0
  const maxRepay = net * MAX_REPAY_SHARE
  const maxLoan = net ? Math.max(0, Math.floor((maxRepay * term) / (1 + i.ratePct / 100) / 500) * 500) : 0
  const pct = `${Math.round(dti * 100)}%`
  const base = { net, obligations: i.obligations, repayment, disposable, dti, maxLoan }
  if (!net) return { ...base, verdict: 'NO INCOME', tone: 'dim', reason: 'Capture the client’s net salary to run the affordability check.' }
  if (!i.amount) return { ...base, verdict: 'ENTER AMOUNT', tone: 'dim', reason: 'Enter a loan amount to see the live verdict.' }
  if (disposable > 0 && dti <= DTI_APPROVE && repayment <= maxRepay)
    return { ...base, verdict: 'APPROVE', tone: 'green', reason: `Within safe limits — ${fmt(disposable)} disposable after this repayment.` }
  if (disposable > 0 && dti <= DTI_REFER)
    return { ...base, verdict: 'REFER', tone: 'amber', reason: `Borderline at ${pct} DTI — refer to a senior officer or trim the amount toward ${fmt(maxLoan)}.` }
  return {
    ...base,
    verdict: 'DECLINE',
    tone: 'red',
    reason:
      disposable <= 0
        ? `Repayment exceeds disposable income by ${fmt(Math.abs(disposable))}. Max affordable ≈ ${fmt(maxLoan)}.`
        : `DTI ${pct} exceeds the 70% ceiling. Max affordable ≈ ${fmt(maxLoan)}.`,
  }
}

/** Client-level snapshot used by the client hub (no new loan). */
export function clientDebtRatio(netSalary: number, expensesTotal: number, currentInstalments: number) {
  if (!netSalary) return { ratio: null as number | null, disposable: null as number | null }
  const ratio = (expensesTotal + currentInstalments) / netSalary
  return { ratio, disposable: round2(netSalary - expensesTotal - currentInstalments) }
}
