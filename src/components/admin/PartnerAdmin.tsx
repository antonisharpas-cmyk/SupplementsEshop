'use client'

/* The small forms on the Partners pages: return days, mark as partner with
   the commission, which promo codes are theirs, and recording a payment. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from '@/components/admin/ui'

/* The shared input without its full width, for short number boxes. */
const small = input.replace('w-full', '')

async function call(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? null : (data.message ?? 'That did not work.')
  } catch {
    return 'Could not reach the server.'
  }
}

function useSave() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  async function run(url: string, body: unknown, done = 'Saved.') {
    setBusy(true)
    setMsg(null)
    const err = await call(url, body)
    setBusy(false)
    setMsg(err ? { ok: false, text: err } : { ok: true, text: done })
    if (!err) router.refresh()
    return !err
  }
  const note = msg && <p className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>
  return { busy, run, note }
}

export function ReturnDaysForm({ days }: { days: number }) {
  const [value, setValue] = useState(String(days))
  const { busy, run, note } = useSave()
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        void run('/api/admin/partners/settings', { returnDays: Number(value) })
      }}
    >
      <span>Commission counts as earned</span>
      <input type="number" min={0} max={365} value={value} onChange={(e) => setValue(e.target.value)} className={`${small} w-20`} />
      <span>days after delivery (the return period).</span>
      <button type="submit" className={btn.secondary} disabled={busy}>
        Save
      </button>
      {note}
    </form>
  )
}

export function PartnerSwitch({ id, isPartner, ratePercent }: { id: string; isPartner: boolean; ratePercent: number }) {
  const [on, setOn] = useState(isPartner)
  const [rate, setRate] = useState(isPartner ? String(ratePercent) : '10')
  const { busy, run, note } = useSave()
  return (
    <form
      className="flex flex-wrap items-center gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        void run(`/api/admin/partners/${id}`, { action: 'set', isPartner: on, ratePercent: Number(rate.replace(',', '.')) })
      }}
    >
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
        This account is a partner
      </label>
      {on && (
        <label className="flex items-center gap-2">
          Commission
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className={`${small} w-20`} />%
        </label>
      )}
      <button type="submit" className={btn.primary} disabled={busy}>
        Save
      </button>
      {note}
    </form>
  )
}

type Code = { id: string; code: string; isActive: boolean; partnerUserId: string | null; partnerName?: string | null }

export function PartnerCodes({ id, codes }: { id: string; codes: Code[] }) {
  const [chosen, setChosen] = useState(() => new Set(codes.filter((c) => c.partnerUserId === id).map((c) => c.id)))
  const { busy, run, note } = useSave()
  return (
    <div>
      {codes.length === 0 ? (
        <p className="text-sm text-muted">No promo codes yet. Create one in Promotions &amp; codes, then come back here.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {codes.map((c) => {
            const other = c.partnerUserId && c.partnerUserId !== id
            return (
              <li key={c.id}>
                <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${chosen.has(c.id) ? 'border-accent' : 'border-line'}`}>
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={(e) => {
                      const next = new Set(chosen)
                      if (e.target.checked) next.add(c.id)
                      else next.delete(c.id)
                      setChosen(next)
                    }}
                  />
                  <span className="font-mono">{c.code}</span>
                  {!c.isActive && <span className="text-xs text-muted">off</span>}
                  {other && <span className="text-xs text-sale">now {c.partnerName ?? 'another partner'}&apos;s</span>}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void run(`/api/admin/partners/${id}`, { action: 'codes', codeIds: [...chosen] })}>
          Save codes
        </button>
        {note}
      </div>
    </div>
  )
}

export function PayoutForm({ id, owedCents }: { id: string; owedCents: number }) {
  const today = new Date().toISOString().slice(0, 10)
  const [amount, setAmount] = useState(owedCents > 0 ? (owedCents / 100).toFixed(2) : '')
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const save = useSave()
  return (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        void save.run(
          `/api/admin/partners/${id}`,
          { action: 'payout', amountCents: Math.round(Number(amount.replace(',', '.')) * 100), paidOn, note: note || null },
          'Payment recorded.',
        )
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Amount paid (€)</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${small} w-32`} required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Paid on</span>
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={input} required />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-xs text-muted">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October commission, bank transfer" className={input} />
      </label>
      <button type="submit" className={btn.primary} disabled={save.busy}>
        Mark as paid
      </button>
      {save.note}
    </form>
  )
}

export function DeletePayout({ id, payoutId }: { id: string; payoutId: string }) {
  const { busy, run } = useSave()
  return (
    <button
      type="button"
      className={btn.quiet}
      disabled={busy}
      onClick={() => window.confirm('Remove this payment? Use it only to fix a mistake.') && void run(`/api/admin/partners/${id}`, { action: 'delete_payout', payoutId })}
    >
      Remove
    </button>
  )
}
