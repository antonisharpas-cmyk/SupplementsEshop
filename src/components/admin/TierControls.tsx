'use client'

/* Admin, a customer: set their membership tier by hand until a date, hand it
   back to the rules, or apply the rules now. */

import { DateTimeField } from './DateTimeField'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

const TIERS = [
  ['basic', 'Basic'],
  ['performer', 'Performer'],
  ['elite', 'Elite'],
  ['champion', 'Champion'],
  ['pro', 'Pro'],
] as const

export function TierControls({ id, tier, manual, today, inSixMonths }: { id: string; tier: string; manual: boolean; today: string; inSixMonths: string }) {
  const router = useRouter()
  const [choice, setChoice] = useState(tier)
  const [until, setUntil] = useState(inSixMonths)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/admin/customers/${id}/tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (res.ok && data.ok) {
        setMsg({ ok: true, text: 'Saved.' })
        router.refresh()
      } else setMsg({ ok: false, text: data.message ?? 'That did not work.' })
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' })
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <label className="block text-xs text-muted">
          Tier
          <select className={`${input} mt-1`} value={choice} onChange={(e) => setChoice(e.target.value)}>
            {TIERS.map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Keep until
          <DateTimeField mode="date" clearable={false} value={until} min={today} onChange={(v) => setUntil(v)} className="mt-1" />
        </label>
        <label className="block text-xs text-muted">
          Note (staff only, optional)
          <input className={`${input} mt-1`} maxLength={500} value={note} placeholder="e.g. Ambassador, gym partner" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btn.primary}
          disabled={busy || !until}
          onClick={() => void run({ action: 'set', tier: choice, until, note }, `Set this customer to ${choice} until ${until}? The rules will not lower it before then.`)}
        >
          Set tier
        </button>
        {manual && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run({ action: 'auto' }, 'Hand this tier back to the automatic rules now? If the customer does not meet the rules for it, they move down one tier today.')}>
            Back to automatic
          </button>
        )}
        <button type="button" className={btn.quiet} disabled={busy} onClick={() => void run({ action: 'recheck' })}>
          Apply the rules now
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
