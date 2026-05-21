'use client'
import { useState } from 'react'
import { useApp } from '@/contexts/AppContext'

const txns = [
  { type: 'cr', name: 'Credit Disbursed', date: '25 Apr 2026', amt: '+R2,000', category: 'Loans' },
  { type: 'db', name: 'Repayment Collected', date: '25 Mar 2026 · DebiCheck', amt: '-R2,700', category: 'Repayments' },
  { type: 'cr', name: 'Credit Disbursed', date: '25 Mar 2026', amt: '+R2,000', category: 'Loans' },
  { type: 'db', name: 'Repayment Collected', date: '25 Feb 2026 · DebiCheck', amt: '-R2,025', category: 'Repayments' },
  { type: 'cr', name: 'Credit Disbursed', date: '25 Feb 2026', amt: '+R1,500', category: 'Loans' },
]

const filters = ['All', 'Loans', 'Repayments', 'Contracts']

export default function HistoryModal() {
  const { modal, closeModal } = useApp()
  const [filter, setFilter] = useState('All')

  const visible = txns.filter(t => filter === 'All' || t.category === filter)

  return (
    <div className={`modal-overlay${modal === 'history' ? ' open' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}>
      <div className="modal-sheet">
        <div className="modal-handle" />
        <div className="modal-title">Transaction History</div>

        <div className="history-filter">
          {filters.map(f => (
            <button key={f} className={`hf-pill${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        <div className="txn-wrap" style={{ boxShadow: 'none', borderRadius: 0 }}>
          {visible.map((t, i) => (
            <div key={i} className="txn-item">
              <div className="txn-ico">
                {t.type === 'cr'
                  ? <svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><path d="M9 3v12M3 9h12" /></svg>
                  : <svg viewBox="0 0 18 18" fill="none" stroke="#666" strokeWidth="1.8"><path d="M3 9h12M9 15l6-6-6-6" /></svg>
                }
              </div>
              <div className="txn-info">
                <div className="txn-name">{t.name}</div>
                <div className="txn-date">{t.date}</div>
              </div>
              <div className={`txn-amt ${t.type}`}>{t.amt}</div>
            </div>
          ))}
        </div>

        <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={closeModal}>Close</button>
      </div>
    </div>
  )
}
