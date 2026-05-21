'use client'
import { useApp } from '@/contexts/AppContext'

const applications = [
  {
    name: 'Thabo Nkosi',
    meta: 'Applied 17 Apr 2026 · ID: 9203145678082',
    status: 'PENDING',
    statusClass: 'pill-yellow',
    aiOffer: 'R2,500',
    income: 'R12,000',
    payday: '25th',
    docsClass: 'gr',
    docs: '✓ All Verified',
  },
  {
    name: 'Lerato Dlamini',
    meta: 'Applied 16 Apr 2026 · ID: 9508221234567',
    status: 'REVIEW',
    statusClass: 'pill-orange',
    aiOffer: 'R1,800',
    income: 'R8,500',
    payday: '15th',
    docsClass: 'rd',
    docs: '⚠ Statement unclear',
  },
  {
    name: 'Sipho Mahlangu',
    meta: 'Applied 15 Apr 2026 · ID: 9112085432109',
    status: 'PENDING',
    statusClass: 'pill-yellow',
    aiOffer: 'R3,000',
    income: 'R16,000',
    payday: '1st',
    docsClass: 'gr',
    docs: '✓ All Verified',
  },
]

export default function AdminScreen() {
  const { goto, openModal, showToast } = useApp()

  const adminAction = (action: string, name: string) => {
    if (action === 'approve') {
      showToast(`${name} approved ✓ — Mandate request sent`)
    } else {
      showToast(`${name} declined. Notification sent.`)
    }
  }

  return (
    <>
      <div className="admin-header">
        <div className="status" style={{ padding: '14px 0 6px' }}>
          <span>9:41</span>
          <div className="status-icons"><span>●●●●</span></div>
        </div>
        <div className="admin-topbar">
          <div>
            <div className="pill-badge pill-yellow" style={{ marginBottom: 6 }}>🔒 ADMIN · EcoLoans</div>
            <div className="admin-logo">Loop <em>Admin</em></div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: 'auto' }} onClick={() => goto('login')}>Sign Out</button>
        </div>
      </div>

      <div className="scroll-area">
        <div className="admin-stats-grid">
          <div className="stat-tile"><div className="stat-tile-label">Pending</div><div className="stat-tile-val yl">7</div><div className="stat-tile-sub">Applications</div></div>
          <div className="stat-tile"><div className="stat-tile-label">Active Loans</div><div className="stat-tile-val gr">124</div><div className="stat-tile-sub">Borrowers</div></div>
          <div className="stat-tile"><div className="stat-tile-label">Today&apos;s Debits</div><div className="stat-tile-val">R48K</div><div className="stat-tile-sub">18 mandates</div></div>
          <div className="stat-tile"><div className="stat-tile-label">Defaults</div><div className="stat-tile-val rd">3</div><div className="stat-tile-sub">Need action</div></div>
        </div>

        <div style={{ padding: '18px 18px 40px' }}>
          <div className="section-row" style={{ marginTop: 4 }}>
            <div className="section-title">Pending Applications</div>
            <div className="section-link" onClick={() => showToast('Viewing all 7 applications')}>View all</div>
          </div>

          {applications.map((app) => (
            <div key={app.name} className="app-card">
              <div className="app-card-head">
                <div>
                  <div className="app-name">{app.name}</div>
                  <div className="app-meta">{app.meta}</div>
                </div>
                <div className={`pill-badge ${app.statusClass}`}>{app.status}</div>
              </div>
              <div className="app-rows">
                <div className="app-row"><span className="l">AI Credit Offer</span><span className="r yl">{app.aiOffer}</span></div>
                <div className="app-row"><span className="l">Monthly Income</span><span className="r">{app.income}</span></div>
                <div className="app-row"><span className="l">Payday Identified</span><span className="r">{app.payday}</span></div>
                <div className="app-row"><span className="l">Documents</span><span className={`r ${app.docsClass}`}>{app.docs}</span></div>
              </div>
              <div className="app-card-actions">
                <button className="act-btn act-approve" onClick={() => adminAction('approve', app.name)}>Approve</button>
                <button className="act-btn act-adjust" onClick={() => openModal('adjust')}>Adjust</button>
                <button className="act-btn act-decline" onClick={() => adminAction('decline', app.name)}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
