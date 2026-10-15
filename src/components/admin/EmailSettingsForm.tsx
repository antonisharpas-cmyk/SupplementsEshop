'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

export function EmailSettingsForm({ initial }: { initial: { testAddress: string; cooldownHours: number } }) {
  const router = useRouter()
  const [testAddress, setTestAddress] = useState(initial.testAddress)
  const [hours, setHours] = useState(String(initial.cooldownHours))
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const h = Number(hours)
    if (!Number.isInteger(h) || h < 0 || h > 336) return setNote({ ok: false, text: 'Hours between 0 and 336 (two weeks).' })
    if (testAddress.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testAddress.trim())) {
      return setNote({ ok: false, text: 'That test address does not look right.' })
    }
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/admin/emails/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_test_address: testAddress.trim(), marketing_cooldown_hours: h }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) return setNote({ ok: false, text: data.message ?? 'Could not save.' })
      setNote({ ok: true, text: 'Saved.' })
      router.refresh()
    } catch {
      setNote({ ok: false, text: 'Could not save, check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 border border-line bg-paper p-5 sm:p-6" noValidate>
      <label className="block">
        <span className="label mb-2 block text-muted">Test email address</span>
        <input type="email" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} maxLength={255} className={input} />
        <span className="mt-1 block text-xs text-muted">
          “Send test email” goes here and only here, it cannot be sent anywhere else. Leave empty to switch test sends off.
        </span>
      </label>
      <label className="block">
        <span className="label mb-2 block text-muted">Marketing frequency limit</span>
        <span className="flex items-center gap-2">
          <input type="number" min={0} max={336} value={hours} onChange={(e) => setHours(e.target.value)} className={`${input.replace("w-full ", "")} w-28`} />
          <span className="text-sm text-muted">hours</span>
        </span>
        <span className="mt-1 block text-xs text-muted">
          At most one marketing email (abandoned bag, new arrivals, promotion) per person in this time. Account, order and
          customer-service emails are never held back. 0 turns the limit off.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={btn.primary}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {note && (
          <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-ok' : 'text-sale'}`}>
            {note.text}
          </p>
        )}
      </div>
    </form>
  )
}
