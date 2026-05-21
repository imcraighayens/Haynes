'use client'
import { useApp } from '@/contexts/AppContext'

type Props = {
  active: 'home' | 'borrow' | 'contracts' | 'profile'
  light?: boolean
}

export default function BottomNav({ active, light }: Props) {
  const { goto } = useApp()
  return (
    <div className={`bottom-nav${light ? ' light' : ''}`}>
      <button className={`nav-tab${active === 'home' ? ' on' : ''}`} onClick={() => goto('dashboard')}>
        <svg viewBox="0 0 20 20">
          <path d="M3 10L10 3l7 7v8H13v-5H7v5H3z" strokeWidth="1.5" stroke="currentColor" fill="none" />
        </svg>
        <span>Home</span>
      </button>
      <button className={`nav-tab${active === 'borrow' ? ' on' : ''}`} onClick={() => goto('borrow')}>
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="7" strokeWidth="1.5" stroke="currentColor" fill="none" />
          <path d="M10 6v8M6 10h8" strokeWidth="1.5" stroke="currentColor" fill="none" />
        </svg>
        <span>Borrow</span>
      </button>
      <div className="nav-center" onClick={() => goto('menu')}>
        <svg viewBox="0 0 24 24">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="var(--text-dark)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
      <button className={`nav-tab${active === 'contracts' ? ' on' : ''}`} onClick={() => goto('contracts')}>
        <svg viewBox="0 0 20 20">
          <rect x="4" y="3" width="12" height="14" rx="2" strokeWidth="1.5" stroke="currentColor" fill="none" />
          <path d="M7 7h6M7 10h6M7 13h4" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" />
        </svg>
        <span>Contracts</span>
      </button>
      <button className={`nav-tab${active === 'profile' ? ' on' : ''}`} onClick={() => goto('profile')}>
        <svg viewBox="0 0 20 20">
          <circle cx="10" cy="7" r="3" strokeWidth="1.5" stroke="currentColor" fill="none" />
          <path d="M4 18c0-3.314 2.686-6 6-6s6 2.686 6 6" strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" />
        </svg>
        <span>Profile</span>
      </button>
    </div>
  )
}
