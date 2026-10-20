'use client'

/* Admin → Customer Service → "AI assistant": on or off, and anything the
   owner wants it to know (offers, rules, common answers). */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

export function SupportAiSettings({ initial, keySet }: { initial: { enabled: boolean; notes: string }; keySet: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const live = keySet && v.enabled

  async function save() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/admin/support/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ support_ai_enabled: v.enabled, support_ai_notes: v.notes }),
    }).catch(() => null)
    const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; message?: string } | undefined
    setBusy(false)
    if (!res?.ok || !data?.ok) return setMsg({ ok: false, text: data?.message ?? 'Could not save.' })
    setMsg({ ok: true, text: 'Saved. The assistant uses it from the next message.' })
    router.refresh()
  }

  return (
    <section className="mb-4 rounded-2xl border border-line bg-paper">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left"
      >
        <span>
          <span className="flex items-center gap-2 text-sm font-semibold text-heading">
            <span className="bg-gold rounded px-1.5 py-px text-[10px] font-bold text-paper">AI</span>
            AI assistant
          </span>
          <span className="mt-0.5 block text-xs text-muted">
            {live
              ? 'On: it answers new messages straight away, shows products, checks orders, and hands over to you when needed.'
              : !keySet
                ? 'Not connected yet: add ANTHROPIC_API_KEY to the server settings to switch it on.'
                : 'Off: people answer every message.'}
          </span>
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${live ? 'bg-ok/15 text-ok' : 'bg-line text-muted'}`}>
          {live ? 'On' : 'Off'}
        </span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" />
            Let the AI assistant answer first
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted">
              What the assistant should know (optional): current offers, rules, answers to common questions. Plain text, up to 3000 characters.
            </span>
            <textarea
              className={`${input} min-h-32`}
              maxLength={3000}
              value={v.notes}
              onChange={(e) => setV({ ...v, notes: e.target.value })}
              placeholder={'e.g. This month: free shaker with any protein over €50.\nWe do not sell to under 18s.'}
            />
          </label>
          <p className="text-xs text-muted">
            It always says it is an AI, gives general product information only (never medical advice), sees only the customer&apos;s own orders, and
            cannot change anything. It hands the chat to you for complaints, refunds, returns, payment problems, or when the customer taps
            &quot;Talk to a person&quot;. Replying yourself also takes over.
          </p>
          {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}
          <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      )}
    </section>
  )
}
