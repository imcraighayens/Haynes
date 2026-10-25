import qrcode from 'qrcode-generator'

/** Data-URL GIF of a QR code for `text`. */
export function qrDataUrl(text: string, cell = 4): string {
  const q = qrcode(0, 'M')
  q.addData(text)
  q.make()
  return q.createDataURL(cell, 2)
}

/**
 * Print a standalone HTML document (letters, agreements) through a hidden
 * iframe, so the console's own styles never leak into the printout.
 * Users choose "Save as PDF" in the print dialog for a PDF.
 */
export function printHtml(bodyHtml: string, title: string) {
  const f = document.createElement('iframe')
  f.setAttribute('aria-hidden', 'true')
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(f)
  const doc = f.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>@page{size:A4;margin:18mm}body{margin:0;font-family:Georgia,'Times New Roman',serif;color:#111;font-size:13px;line-height:1.6}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:6px 0;vertical-align:top}</style></head><body>${bodyHtml}</body></html>`)
  doc.close()
  const go = () => {
    f.contentWindow?.focus()
    f.contentWindow?.print()
    setTimeout(() => f.remove(), 1500)
  }
  if (doc.readyState === 'complete') setTimeout(go, 50)
  else f.onload = go
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Trigger a file download of `text`. */
export function download(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = c == null ? '' : String(c)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n')
}
