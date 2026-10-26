import { useEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * Q1's robot head — ported from "Q1 Assistant Button.dc.html". Navy head,
 * yellow eyes and mouth, twitching antenna. Idle moods rotate every
 * 1.6–3.8 s; on hover the playful moods rotate every 1.1 s and the head grows.
 */
type Mood = 'idle' | 'side' | 'bored' | 'wink' | 'attitude' | 'happy' | 'sus' | 'excited' | 'surprised' | 'shy' | 'love' | 'cheeky'
const IDLE: Mood[] = ['idle', 'side', 'bored', 'wink', 'attitude', 'happy', 'idle', 'sus']
const HOVER: Mood[] = ['excited', 'surprised', 'shy', 'love', 'cheeky']
const SPRING = 'all .32s cubic-bezier(.34,1.56,.64,1)'

type Eye = { w: number; h: number; x: number; y: number; r: number; rad: number | string; c?: string }

function eyeFor(m: Mood, left: boolean): Eye {
  const map: Record<Mood, Eye> = {
    idle: { w: 4, h: 7, x: 0, y: 0, r: 0, rad: 2 },
    side: { w: 4, h: 7, x: 2.5, y: 0, r: 0, rad: 2 },
    bored: { w: 6, h: 2.5, x: 0, y: 1.5, r: 0, rad: 1.5 },
    wink: left ? { w: 6, h: 2, x: 0, y: 1.5, r: -8, rad: 1 } : { w: 4, h: 7, x: 0, y: 0, r: 0, rad: 2 },
    attitude: { w: 6, h: 4, x: 0, y: 1, r: left ? 18 : -18, rad: 1.5 },
    happy: { w: 6, h: 3.5, x: 0, y: 0, r: 0, rad: '4px 4px 1px 1px' },
    sus: left ? { w: 6, h: 2.5, x: 1.5, y: 1, r: 0, rad: 1.5 } : { w: 4.5, h: 6, x: 1.5, y: 0, r: 0, rad: 2 },
    excited: { w: 5, h: 5, x: 0, y: -0.5, r: 0, rad: '50%' },
    surprised: { w: 5, h: 8, x: 0, y: -0.5, r: 0, rad: '50%' },
    shy: { w: 5, h: 2.5, x: 0, y: 2, r: left ? -10 : 10, rad: '4px 4px 1px 1px' },
    love: { w: 4.5, h: 4.5, x: 0, y: 0, r: 45, rad: '2px 2px 0 2px', c: '#FF6B9A' },
    cheeky: left ? { w: 6, h: 3.5, x: 0, y: 0, r: 0, rad: '4px 4px 1px 1px' } : { w: 6, h: 2, x: 0, y: 1.5, r: -8, rad: 1 },
  }
  return map[m]
}

const MOUTH: Record<Mood, { w: number; h: number; r: number; y: number; rad?: string }> = {
  idle: { w: 5, h: 1.6, r: 0, y: 0 }, side: { w: 3, h: 1.6, r: 0, y: 0 }, bored: { w: 6, h: 1.4, r: 0, y: 0 },
  wink: { w: 5, h: 1.6, r: -14, y: 0 }, attitude: { w: 5, h: 1.6, r: 8, y: 0.5 }, happy: { w: 7, h: 3, r: 0, y: 0, rad: '1px 1px 4px 4px' },
  sus: { w: 4, h: 1.6, r: -10, y: 0 }, excited: { w: 8, h: 4, r: 0, y: 0, rad: '1px 1px 5px 5px' }, surprised: { w: 4, h: 4, r: 0, y: 0.5, rad: '50%' },
  shy: { w: 4, h: 1.6, r: 0, y: 0.5 }, love: { w: 6, h: 3, r: 0, y: 0, rad: '1px 1px 4px 4px' }, cheeky: { w: 6, h: 3, r: -12, y: 0, rad: '1px 1px 4px 4px' },
}
const TILT: Record<Mood, number> = { idle: 0, side: -8, bored: 6, wink: -6, attitude: 10, happy: 0, sus: -12, excited: 0, surprised: 0, shy: -10, love: 6, cheeky: -8 }

export function Q1Robot({ hover = false, thinking = false }: { hover?: boolean; thinking?: boolean }) {
  const [idle, setIdle] = useState(0)
  const [play, setPlay] = useState<Mood>('excited')
  const t = useRef<number>()
  useEffect(() => {
    const tick = () => {
      t.current = window.setTimeout(() => {
        setIdle((n) => {
          let k = n
          while (k === n) k = Math.floor(Math.random() * IDLE.length)
          return k
        })
        tick()
      }, 1600 + Math.random() * 2200)
    }
    tick()
    return () => window.clearTimeout(t.current)
  }, [])
  useEffect(() => {
    if (!hover && !thinking) return
    const pick = () => setPlay((p) => {
      let n = p
      while (n === p) n = HOVER[Math.floor(Math.random() * HOVER.length)]
      return n
    })
    pick()
    const i = window.setInterval(pick, 1100)
    return () => window.clearInterval(i)
  }, [hover, thinking])

  const lively = hover || thinking
  const m: Mood = lively ? play : IDLE[idle]
  const eye = (left: boolean) => {
    const c = eyeFor(m, left)
    const style: CSSProperties = {
      display: 'block', width: c.w, height: c.h, borderRadius: c.rad, background: c.c ?? '#FDD10D',
      transform: `translate(${c.x}px,${c.y}px) rotate(${c.r}deg)`, transition: SPRING,
      animation: m === 'idle' || m === 'side' ? `q-blink 3.2s ${left ? '0s' : '.04s'} infinite` : 'none',
    }
    return <span style={style} />
  }
  const mo = MOUTH[m]
  const tip = m === 'attitude' ? '#FF5A4F' : m === 'love' ? '#FF6B9A' : lively ? '#FDD10D' : '#0B0620'
  return (
    <span aria-hidden style={{ position: 'relative', width: 28, height: 28, display: 'grid', placeItems: 'center', animation: lively ? 'q-bob .6s ease-in-out infinite' : 'q-bob 2.4s ease-in-out infinite', transform: lively ? 'scale(1.14)' : 'scale(1)', transition: 'transform .35s cubic-bezier(.34,1.56,.64,1)' }}>
      <span style={{ position: 'absolute', top: -4, left: '50%', width: 2, height: 5, marginLeft: -1, background: '#0B0620', borderRadius: 1, transformOrigin: '50% 100%', animation: 'q-twitch 3.6s ease-in-out infinite' }}>
        <span style={{ position: 'absolute', top: -3, left: -1.5, width: 5, height: 5, borderRadius: '50%', background: tip, transition: 'background .3s' }} />
      </span>
      {(m === 'shy' || m === 'love') && (
        <span style={{ position: 'absolute', left: 2, right: 2, top: 15, display: 'flex', justifyContent: 'space-between', zIndex: 2, pointerEvents: 'none' }}>
          <span style={{ width: 5, height: 3, borderRadius: '50%', background: 'rgba(255,107,154,.85)' }} />
          <span style={{ width: 5, height: 3, borderRadius: '50%', background: 'rgba(255,107,154,.85)' }} />
        </span>
      )}
      <span style={{ width: 26, height: 22, borderRadius: 9, background: '#0B0620', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, transform: `rotate(${TILT[m]}deg)`, transition: SPRING, boxShadow: 'inset 0 -2px 0 rgba(255,255,255,.08)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 7 }}>
          {eye(true)}
          {eye(false)}
        </span>
        <span style={{ display: 'block', width: mo.w, height: mo.h, borderRadius: mo.rad ?? 1, background: '#FDD10D', opacity: 0.85, transform: `translateY(${mo.y}px) rotate(${mo.r}deg)`, transition: SPRING }} />
      </span>
    </span>
  )
}

/** The glowing blue orb the robot lives in (40px in the bar, smaller in the sidebar). */
export function Q1Orb({ size = 40, hover = false, thinking = false, halo = false }: { size?: number; hover?: boolean; thinking?: boolean; halo?: boolean }) {
  return (
    <span
      className="q1-orb"
      style={{
        position: 'relative', width: size, height: size, borderRadius: '50%', background: '#0000FE', display: 'grid', placeItems: 'center', flex: '0 0 auto',
        boxShadow: hover
          ? '0 0 14px #0000FE,0 0 30px rgba(60,80,255,.95),0 0 60px rgba(60,80,255,.65),inset 0 1px 0 rgba(255,255,255,.35)'
          : '0 0 10px #0000FE,0 0 22px rgba(40,60,255,.85),0 0 44px rgba(40,60,255,.55),inset 0 1px 0 rgba(255,255,255,.35)',
        animation: halo ? 'q-breathe 3.6s ease-in-out infinite' : 'none',
        transition: 'box-shadow .3s cubic-bezier(.33,1,.68,1)',
      }}
    >
      {halo && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#2A3BFF', animation: 'q-halo 3.6s ease-out infinite', pointerEvents: 'none' }} />}
      <span style={{ position: 'relative', display: 'grid', placeItems: 'center', transform: size < 36 ? `scale(${size / 40})` : undefined }}>
        <Q1Robot hover={hover} thinking={thinking} />
      </span>
    </span>
  )
}
