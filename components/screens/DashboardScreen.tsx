'use client'
import { useApp } from '@/contexts/AppContext'
import BottomNav from '@/components/ui/BottomNav'

export default function DashboardScreen() {
  const { goto, openModal, balanceVisible, toggleBalance } = useApp()

  return (
    <>
      <div className="dash-header">
        <div className="status" style={{ padding: '14px 22px 6px' }}>
          <span>9:41</span>
          <div className="status-icons"><span>●●●●</span><span>WiFi 🔋</span></div>
        </div>
        <div className="dash-topbar">
          <button className="icon-btn" onClick={() => goto('profile')}>
            <svg viewBox="0 0 18 18" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8">
              <circle cx="9" cy="6" r="3" /><path d="M3 16c0-3.314 2.686-6 6-6s6 2.686 6 6" />
            </svg>
          </button>
          <div className="dash-topbar-logo">L<em>oo</em>p</div>
          <button className="icon-btn" style={{ position: 'relative' }} onClick={() => openModal('notifs')}>
            <svg viewBox="0 0 18 18" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="1.8">
              <path d="M9 2a5 5 0 015 5v3l1.5 2.5H2.5L4 10V7a5 5 0 015-5z" />
              <path d="M7 14.5a2 2 0 004 0" />
            </svg>
            <div className="notif-dot">2</div>
          </button>
        </div>
        <div className="dash-bal-label" onClick={toggleBalance} style={{ cursor: 'pointer' }}>
          My account →
        </div>
        <div className="dash-balance">{balanceVisible ? 'R3,500.00' : '••••••'}</div>
        <div className="dash-next">
          <svg viewBox="0 0 12 12" fill="none" stroke="var(--text-dim)" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4.5" /><path d="M6 3v3l2 2" />
          </svg>
          Available credit · Next debit 25 Apr
        </div>
        <div className="quick-actions">
          <button className="q-action" onClick={() => goto('borrow')}>
            <div className="q-circle">
              <svg viewBox="0 0 22 22" fill="none" stroke="var(--text-dark)" strokeWidth="2.5"><path d="M11 4v14M4 11h14" /></svg>
            </div>
            <span className="q-label">Borrow</span>
          </button>
          <button className="q-action" onClick={() => goto('repay')}>
            <div className="q-circle ghost">
              <svg viewBox="0 0 22 22" fill="none" stroke="white" strokeWidth="2.5"><path d="M4 17L17 5M17 5H9M17 5v8" /></svg>
            </div>
            <span className="q-label">Repay</span>
          </button>
          <button className="q-action" onClick={() => goto('contracts')}>
            <div className="q-circle ghost">
              <svg viewBox="0 0 22 22" fill="none" stroke="white" strokeWidth="2"><rect x="4" y="3" width="14" height="16" rx="2" /><path d="M8 8h6M8 11h6M8 14h4" /></svg>
            </div>
            <span className="q-label">Contracts</span>
          </button>
          <button className="q-action" onClick={() => openModal('history')}>
            <div className="q-circle ghost">
              <svg viewBox="0 0 22 22" fill="none" stroke="white" strokeWidth="2"><path d="M4 6h14M4 11h14M4 16h8" /></svg>
            </div>
            <span className="q-label">History</span>
          </button>
        </div>
      </div>

      <div className="scroll-area">
        <div className="dash-body">
          <div className="dash-tile" onClick={() => goto('borrow')}>
            <div className="tile-top">
              <div>
                <div className="tile-title">Loop Credit</div>
                <div className="tile-sub">R3,500 available to borrow</div>
              </div>
              <div className="tile-arrow">
                <svg viewBox="0 0 15 15" fill="none" stroke="#BCC" strokeWidth="2"><path d="M5 4l5 4-5 4" /></svg>
              </div>
            </div>
            <div className="tile-bar"><div className="tile-fill cyan full" /></div>
          </div>

          <div className="dash-tile" onClick={() => openModal('mandate')}>
            <div className="tile-top">
              <div>
                <div className="tile-title">DebiCheck Mandate</div>
                <div className="tile-sub">Active — debit date 25th</div>
              </div>
              <div className="pill-badge pill-green" style={{ fontSize: 10 }}>ACTIVE</div>
            </div>
            <div className="tile-bar" style={{ marginTop: 10 }}>
              <div className="tile-fill full" style={{ background: 'var(--success)' }} />
            </div>
          </div>

          <div style={{ marginTop: 6 }}>
            <div className="section-row">
              <div className="section-title">Recent Activity</div>
              <div className="section-link" onClick={() => openModal('history')}>View all</div>
            </div>
            <div className="txn-wrap">
              <div className="txn-item">
                <div className="txn-ico"><svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><path d="M9 3v12M3 9h12" /></svg></div>
                <div className="txn-info"><div className="txn-name">Credit Disbursed</div><div className="txn-date">25 Mar 2026</div></div>
                <div className="txn-amt cr">+R2,000</div>
              </div>
              <div className="txn-item">
                <div className="txn-ico"><svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><path d="M3 9h12M9 15l6-6-6-6" /></svg></div>
                <div className="txn-info"><div className="txn-name">Repayment Collected</div><div className="txn-date">25 Mar 2026 · DebiCheck</div></div>
                <div className="txn-amt db">-R2,700</div>
              </div>
              <div className="txn-item">
                <div className="txn-ico"><svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><rect x="3" y="4" width="12" height="10" rx="1.5" /><path d="M3 7h12" /></svg></div>
                <div className="txn-info"><div className="txn-name">Contract Renewed</div><div className="txn-date">25 Mar 2026</div></div>
                <div className="txn-amt" style={{ color: '#BBB', fontSize: 11 }}>AUTO</div>
              </div>
              <div className="txn-item">
                <div className="txn-ico"><svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><path d="M9 3v12M3 9h12" /></svg></div>
                <div className="txn-info"><div className="txn-name">Credit Disbursed</div><div className="txn-date">25 Feb 2026</div></div>
                <div className="txn-amt cr">+R1,500</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BottomNav active="home" light />
    </>
  )
}
