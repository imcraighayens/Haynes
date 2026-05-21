export default function StatusBar({ dark }: { dark?: boolean }) {
  return (
    <div className="status" style={{ color: dark ? 'var(--text-dark)' : undefined }}>
      <span>9:41</span>
      <div className="status-icons">
        <span style={{ letterSpacing: '-2px' }}>●●●●</span>
        <span>WiFi</span>
        <span>🔋</span>
      </div>
    </div>
  )
}
