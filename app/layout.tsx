import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Loop — Revolving Credit',
  description: "South Africa's simplest revolving credit app by EcoLoans",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
