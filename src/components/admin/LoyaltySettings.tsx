'use client'

/* Admin, Settings: the membership tier rules. One row per tier: the discount
   it gives, what earns it (orders AND spend in the counting window), and how
   long it lasts from the latest order before stepping down one tier. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'
import { TierBadge } from '@/components/TierBadge'

type Rule = { key: string; discountPercent: number; minOrders: number; minSpendCents: number; durationMonths: number }

export function LoyaltySettings({
  initial,
  counts,
}: {
  initial: { enabled: boolean; windowMonths: number; nearGoalPercent: number; warningDays: number; lastCallDays: number; keepMinOrders: number; tiers: Rule[] }
  counts: Record<string, number>
}) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [windowMonths, setWindow] = useState(String(initial.windowMonths))
  const [near, setNear] = useState(String(initial.nearGoalPercent))
  const [warn, setWarn] = useState(String(initial.warningDays))
  const [lastCall, setLastCall] = useState(String(initial.lastCallDays))
  const [keepMin, setKeepMin] = useState(String(initial.keepMinOrders))
  const [rows, setRows] = useState(
    initial.tiers.map((t) => ({
      key: t.key,
      discount: String(t.discountPercent),
      orders: String(t.minOrders),
      spend: (t.minSpendCents / 100).toFixed(0),
      months: String(t.durationMonths),
    })),
  )
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const set = (i: number, field: keyof (typeof rows)[number], value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [field]: value.replace(/[^\d.,]/g, '') } : row)))

  async function save() {
    setBusy(true)
    setNote(null)
    const num = (v: string) => Number(v.replace(',', '.')) || 0
    try {
      const res = await fetch('/api/admin/loyalty', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          windowMonths: Math.round(num(windowMonths)),
          nearGoalPercent: Math.round(num(near)),
          warningDays: Math.round(num(warn)),
          lastCallDays: Math.max(1, Math.round(num(lastCall))),
          keepMinOrders: Math.max(1, Math.round(num(keepMin))),
          tiers: rows.map((r) => ({
            key: r.key,
            discountPercent: num(r.discount),
            minOrders: Math.round(num(r.orders)),
            minSpendCents: Math.round(num(r.spend) * 100),
            durationMonths: Math.max(1, Math.round(num(r.months))),
          })),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (res.ok && data.ok) {
        setNote({ ok: true, text: 'Saved. Customers are rechecked against the new rules over the next hour. Nobody moves down early: stepping down only happens when a tier period ends.' })
        router.refresh()
      } else setNote({ ok: false, text: data.message ?? 'Could not save.' })
    } catch {
      setNote({ ok: false, text: 'Could not reach the server.' })
    }
    setBusy(false)
  }

  const cell = `${input} !px-2.5 !py-2 text-right tabular-nums`

  return (
    <section className="mt-10 rounded-2xl border border-line bg-paper p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="label text-muted">Membership tiers</h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">
            To earn a tier, a customer needs the orders AND the spend (after discounts, without delivery) in the counting window. To keep it, they only need to keep ordering: the tier lasts its duration from their latest order. A whole period with no order and they move down one tier. The discount comes off every price, before promotions.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Tiers switched on
        </label>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[44rem]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="pb-2 pr-3 font-medium">Tier</th>
              <th className="pb-2 pr-3 font-medium">Discount %</th>
              <th className="pb-2 pr-3 font-medium">Min. orders</th>
              <th className="pb-2 pr-3 font-medium">Min. spend €</th>
              <th className="pb-2 pr-3 font-medium">Lasts (months)</th>
              <th className="pb-2 font-medium text-right">Customers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const basic = r.key === 'basic'
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-2.5 pr-3">
                    <TierBadge tier={r.key} size="xs" />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={cell} inputMode="decimal" disabled={basic} value={basic ? '0' : r.discount} onChange={(e) => set(i, 'discount', e.target.value)} aria-label={`${r.key} discount`} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={cell} inputMode="numeric" disabled={basic} value={basic ? '0' : r.orders} onChange={(e) => set(i, 'orders', e.target.value)} aria-label={`${r.key} orders`} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={cell} inputMode="decimal" disabled={basic} value={basic ? '0' : r.spend} onChange={(e) => set(i, 'spend', e.target.value)} aria-label={`${r.key} spend`} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <input className={cell} inputMode="numeric" disabled={basic} value={basic ? '—' : r.months} onChange={(e) => set(i, 'months', e.target.value)} aria-label={`${r.key} months`} />
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-ink-soft">{counts[r.key] ?? 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs text-muted">
          Orders that keep a tier
          <input className={`${input} mt-1`} inputMode="numeric" value={keepMin} onChange={(e) => setKeepMin(e.target.value.replace(/\D/g, ''))} />
          <span className="mt-1 block">Within each tier period. With 1, a tier ends only after a whole period with no order.</span>
        </label>
        <label className="block text-xs text-muted">
          Counting window (months)
          <input className={`${input} mt-1`} inputMode="numeric" value={windowMonths} onChange={(e) => setWindow(e.target.value.replace(/\D/g, ''))} />
          <span className="mt-1 block">Orders and spend in this many past months count.</span>
        </label>
        <label className="block text-xs text-muted">
          “You’re close” email at (%)
          <input className={`${input} mt-1`} inputMode="numeric" value={near} onChange={(e) => setNear(e.target.value.replace(/\D/g, ''))} />
          <span className="mt-1 block">Of the next tier’s rules, both orders and spend.</span>
        </label>
        <label className="block text-xs text-muted">
          “Tier ends soon” email (days before)
          <input className={`${input} mt-1`} inputMode="numeric" value={warn} onChange={(e) => setWarn(e.target.value.replace(/\D/g, ''))} />
          <span className="mt-1 block">Sent when they have not ordered, so the tier is about to end.</span>
        </label>
        <label className="block text-xs text-muted">
          Last reminder (days before)
          <input className={`${input} mt-1`} inputMode="numeric" value={lastCall} onChange={(e) => setLastCall(e.target.value.replace(/\D/g, ''))} />
          <span className="mt-1 block">One more email just before it ends. When it ends, they get the “tier has ended” email.</span>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" className={btn.primary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save tier rules'}
        </button>
        {note && <p className={`text-xs ${note.ok ? 'text-ok' : 'text-sale'}`}>{note.text}</p>}
      </div>
    </section>
  )
}
