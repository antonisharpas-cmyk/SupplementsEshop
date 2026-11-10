'use client'

/* "Undo" on a stock movement recorded by hand by mistake. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function UndoMovement({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function undo() {
    if (!window.confirm(`Undo this ${label.toLowerCase()}? The stock goes back as it was, and the reports leave it out.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/finance/movements', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) setError(data.message ?? 'That did not work.')
      else router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" onClick={() => void undo()} disabled={busy} className="text-xs font-medium text-muted underline underline-offset-4 hover:text-sale">
        {busy ? 'Undoing…' : 'Undo'}
      </button>
      {error && <span className="mt-1 max-w-48 text-right text-[11px] text-sale">{error}</span>}
    </span>
  )
}
