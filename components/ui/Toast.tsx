'use client'
import { useApp } from '@/contexts/AppContext'

export default function Toast() {
  const { toast } = useApp()
  if (!toast) return null
  return <div className="toast">{toast}</div>
}
