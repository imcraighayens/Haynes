'use client'
import { useApp } from '@/contexts/AppContext'
import BottomNav from '@/components/ui/BottomNav'

const contracts = [
  {
    month: 'April 2026',
    meta: 'Loan: R2,000 · Due: 25 Apr',
    status: 'ACTIVE',
    statusClass: 'pill-yellow',
    amount: 'R2,000.00',
    interest: 'R700.00',
    total: 'R2,700.00',
    totalLabel: 'Total Repayment',
    totalClass: '',
    debitDate: '25 Apr 2026',
    mandateRef: 'ECL-2604-0042',
    contractId: 'CTR-26040042',
  },
  {
    month: 'March 2026',
    meta: 'Loan: R2,000 · Repaid 25 Mar',
    status: 'SETTLED',
    statusClass: 'pill-green',
    amount: 'R2,000.00',
    interest: 'R700.00',
    total: 'R2,700.00 ✓',
    totalLabel: 'Total Repaid',
    totalClass: 'gr',
    debitDate: '25 Mar 2026',
    mandateRef: 'ECL-2603-0039',
    contractId: 'CTR-26030039',
  },
  {
    month: 'February 2026',
    meta: 'Loan: R1,500 · Repaid 25 Feb',
    status: 'SETTLED',
    statusClass: 'pill-green',
    amount: 'R1,500.00',
    interest: 'R525.00',
    total: 'R2,025.00 ✓',
    totalLabel: 'Total Repaid',
    totalClass: 'gr',
    debitDate: '25 Feb 2026',
    mandateRef: 'ECL-2602-0031',
    contractId: 'CTR-26020031',
  },
]

export default function ContractsScreen() {
  const { goto, showToast } = useApp()

  return (
    <>
      <div style={{ background: 'var(--charcoal)', padding: '0 22px 18px', flexShrink: 0 }}>
        <div className="status" style={{ padding: '14px 0 6px' }}>
          <span>9:41</span>
          <div className="status-icons"><span>●●●●</span></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 6 }}>
          <button className="back-btn" style={{ marginBottom: 0 }} onClick={() => goto('dashboard')}>
            <svg viewBox="0 0 18 18"><path d="M11 14l-5-5 5-5" /></svg>
          </button>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'white' }}>My Contracts</div>
        </div>
      </div>

      <div className="scroll-area">
        <div className="contracts-inner">
          <div style={{ fontSize: 12, color: '#999', marginBottom: 14 }}>
            Auto-generated monthly. Each loan cycle creates a new contract.
          </div>

          {contracts.map((c) => (
            <div key={c.contractId} className="contract-card">
              <div className="contract-head">
                <div>
                  <div className="contract-month">{c.month}</div>
                  <div style={{ fontSize: 11, color: '#BBB', marginTop: 2 }}>{c.meta}</div>
                </div>
                <div className={`pill-badge ${c.statusClass}`}>{c.status}</div>
              </div>
              <div className="contract-body">
                <div className="app-row"><span className="l">Amount Borrowed</span><span className="r">{c.amount}</span></div>
                <div className="app-row"><span className="l">Interest</span><span className="r yl">{c.interest}</span></div>
                <div className="app-row"><span className={`r ${c.totalClass}`} style={{ marginLeft: 'auto' }}>{c.total}</span></div>
                <div className="app-row"><span className="l">Debit Date</span><span className="r">{c.debitDate}</span></div>
                <div className="app-row">
                  <span className="l">Mandate Ref</span>
                  <span className="r" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{c.mandateRef}</span>
                </div>
              </div>
              <div className="contract-footer">
                <span>Contract ID: {c.contractId}</span>
                <button onClick={() => showToast('Downloading contract PDF...')}>Download PDF</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav active="contracts" light />
    </>
  )
}
