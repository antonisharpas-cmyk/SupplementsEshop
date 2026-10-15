'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn } from './ui'

export function CustomerControls({ id, isActive, email }: { id: string; isActive: boolean; email: string }) {
  const router = useRouter()
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(body: Record<string, unknown>, confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return
    setBusy(true)
    const res = await fetch(`/api/admin/customers/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    setBusy(false)
    if (!res.ok || !data.ok) return setNote({ tone: 'bad', text: data.message ?? 'That did not work.' })
    setNote({ tone: 'ok', text: done })
    router.refresh()
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={btn.secondary}
          disabled={busy}
          onClick={() => void run({ action: 'reset_password' }, `Email ${email} a code to set a new password?`, `Code sent to ${email}.`)}
        >
          Send password reset
        </button>
        <button
          type="button"
          className={isActive ? btn.secondary : btn.primary}
          disabled={busy}
          onClick={() =>
            void run(
              { action: 'active', isActive: !isActive },
              isActive
                ? 'Switch this account off? They are signed out and cannot sign in. Their orders stay.'
                : 'Switch this account back on?',
              isActive ? 'Account switched off.' : 'Account switched on.',
            )
          }
        >
          {isActive ? 'Switch account off' : 'Switch account on'}
        </button>
      </div>
      {note && <p className={`mt-3 text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>{note.text}</p>}
    </div>
  )
}
