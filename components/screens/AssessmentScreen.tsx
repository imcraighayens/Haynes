'use client'
import { useState, useEffect } from 'react'
import { useApp } from '@/contexts/AppContext'

const STEPS = [
  { icon: '✅', title: 'Identity Verified', desc: 'SA ID validated against Home Affairs', done: true, delay: 0 },
  { icon: '✅', title: 'Documents Received', desc: 'Bank statement and payslip confirmed', done: true, delay: 0 },
  { icon: '🤖', title: 'Analysing Income', desc: 'AI parsing your salary patterns', done: false, delay: 1800 },
  { icon: '📊', title: 'Credit Assessment', desc: 'Calculating your credit score', done: false, delay: 3400 },
  { icon: '🎯', title: 'Offer Generated', desc: 'Your personalised credit limit is ready', done: false, delay: 5000 },
]

export default function AssessmentScreen() {
  const { currentScreen, goto } = useApp()
  const [visible, setVisible] = useState<boolean[]>([true, true, false, false, false])
  const [showBtn, setShowBtn] = useState(false)

  useEffect(() => {
    if (currentScreen !== 'assessment') return

    // Reset state when screen becomes active
    setVisible([true, true, false, false, false])
    setShowBtn(false)

    const timers: ReturnType<typeof setTimeout>[] = []

    timers.push(setTimeout(() => setVisible(v => { const n = [...v]; n[2] = true; return n }), 1800))
    timers.push(setTimeout(() => setVisible(v => { const n = [...v]; n[3] = true; return n }), 3400))
    timers.push(setTimeout(() => {
      setVisible(v => { const n = [...v]; n[4] = true; return n })
      setTimeout(() => setShowBtn(true), 300)
    }, 5000))

    return () => timers.forEach(clearTimeout)
  }, [currentScreen])

  return (
    <div className="assess-content">
      <div className="assess-spinner">
        <div className="ring ring1" />
        <div className="ring ring2" />
        <span className="assess-emoji">🤖</span>
      </div>

      <div>
        <div className="assess-title">Analysing your profile</div>
        <div className="assess-sub" style={{ marginTop: 8 }}>
          Our AI is reviewing your documents and calculating the best offer for you.
        </div>
      </div>

      <div className="assess-steps">
        {STEPS.map((step, i) => (
          <div key={i} className={`assess-step${visible[i] ? ' visible' : ''}`}>
            <div className={`assess-step-icon${step.done || (visible[i] && i < 2) ? ' done' : ' pending'}`}>
              {step.icon}
            </div>
            <div>
              <h5>{step.title}</h5>
              <p>{step.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {showBtn && (
        <button
          className="btn btn-yellow"
          style={{ animation: 'popIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards' }}
          onClick={() => goto('offer')}
        >
          View My Credit Offer →
        </button>
      )}
    </div>
  )
}
