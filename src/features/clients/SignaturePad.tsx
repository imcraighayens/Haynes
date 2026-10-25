import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface SignaturePadHandle {
  clear: () => void
  isEmpty: () => boolean
  /** Trimmed PNG data URL of the ink (dark ink on transparent) */
  toDataUrl: () => string | null
}

/**
 * Canvas signature pad. Pointer events cover mouse, touch and pen; the
 * backing store is scaled by devicePixelRatio so strokes stay crisp, and
 * pressure (when the device reports it) varies the line width.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number; onChange?: (empty: boolean) => void }>(function SignaturePad(
  { height = 190, onChange },
  ref,
) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [empty, setEmpty] = useState(true)
  const strokes = useRef(0)

  const fit = useCallback(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth
    // keep existing ink when the size changes
    const snapshot = strokes.current ? c.toDataURL() : null
    c.width = Math.round(w * dpr)
    c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111318'
    if (snapshot) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, w, height)
      img.src = snapshot
    }
  }, [height])

  useEffect(() => {
    fit()
    const ro = new ResizeObserver(() => fit())
    if (canvas.current) ro.observe(canvas.current)
    return () => ro.disconnect()
  }, [fit])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const markInk = () => {
    strokes.current++
    if (empty) {
      setEmpty(false)
      onChange?.(false)
    }
  }

  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    canvas.current!.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pos(e)
    last.current = p
    const ctx = canvas.current!.getContext('2d')!
    ctx.beginPath()
    ctx.fillStyle = '#111318'
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
    ctx.fill()
    markInk()
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return
    const ctx = canvas.current!.getContext('2d')!
    const events = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
    const r = canvas.current!.getBoundingClientRect()
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top }
      const pressure = ev.pressure && ev.pointerType === 'pen' ? ev.pressure : 0.5
      ctx.lineWidth = 1.4 + pressure * 2.2
      ctx.beginPath()
      ctx.moveTo(last.current.x, last.current.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      last.current = p
    }
  }
  const up = () => {
    drawing.current = false
    last.current = null
  }

  useImperativeHandle(ref, () => ({
    clear() {
      const c = canvas.current!
      c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
      strokes.current = 0
      setEmpty(true)
      onChange?.(true)
    },
    isEmpty: () => strokes.current === 0,
    toDataUrl() {
      const c = canvas.current
      if (!c || !strokes.current) return null
      // trim to the inked area with a little padding
      const ctx = c.getContext('2d')!
      const { width: w, height: h } = c
      const data = ctx.getImageData(0, 0, w, h).data
      let x0 = w, y0 = h, x1 = 0, y1 = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (data[(y * w + x) * 4 + 3] > 0) {
            if (x < x0) x0 = x
            if (y < y0) y0 = y
            if (x > x1) x1 = x
            if (y > y1) y1 = y
          }
      if (x1 < x0) return null
      const pad = 12
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad)
      const out = document.createElement('canvas')
      out.width = x1 - x0
      out.height = y1 - y0
      out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
      return out.toDataURL('image/png')
    },
  }))

  return (
    <div className="relative overflow-hidden rounded-2xl" style={{ background: '#fbfaf6', border: '1px solid var(--line2)' }}>
      <canvas
        ref={canvas}
        aria-label="Signature pad — sign with mouse, finger or pen"
        role="img"
        className="block w-full cursor-crosshair"
        style={{ height, touchAction: 'none' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="pointer-events-none absolute bottom-9 left-6 right-6 border-b border-dashed" style={{ borderColor: '#b9b6aa' }} />
      <div className="pointer-events-none absolute bottom-3 left-6 text-[10px] font-semibold tracking-[0.14em]" style={{ color: '#8a8778' }}>
        {empty ? 'SIGN ABOVE THE LINE' : 'CLIENT SIGNATURE'}
      </div>
    </div>
  )
})
