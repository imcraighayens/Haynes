/** Q1 assistant mascot — the round black face with blinking eyes from the prototype. */
export function Q1Face({ size = 36, alert }: { size?: number; alert?: boolean }) {
  const eye = { width: size * 0.12, height: size * 0.2, borderRadius: 99, background: 'var(--acc)', animation: 'q-blink 4s infinite' }
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: '#fff', boxShadow: '0 0 0 2px rgba(255,255,255,.6)' }} aria-hidden>
      <span className="flex items-center justify-center gap-[3px] rounded-full" style={{ width: size * 0.72, height: size * 0.62, background: '#0b0b0a' }}>
        <span style={eye} />
        <span style={eye} />
      </span>
      {alert && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full pulse" style={{ background: 'var(--tlR)' }} />}
    </span>
  )
}
