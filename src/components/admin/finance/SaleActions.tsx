'use client'

/* On a wholesale sale: record a payment, a credit note, a reminder. */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { euros, fmt, PAY_METHODS, toCents, todayIso, useApi } from './shared'

export function SaleActions({
  id,
  dueCents,
  hasEmail,
  lines,
  payments,
}: {
  id: string
  dueCents: number
  hasEmail: boolean
  lines: { id: string; description: string; quantity: number; unitNetCents: number }[]
  payments: { id: string; amountCents: number; method: string; paidOn: string }[]
}) {
  const { busy, msg, call } = useApi()
  const [amount, setAmount] = useState(euros(dueCents))
  const [method, setMethod] = useState('bank')
  const [on, setOn] = useState(todayIso())
  const [creditOpen, setCreditOpen] = useState(false)
  const [back, setBack] = useState<Record<string, string>>({})
  const [off, setOff] = useState('')
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('Returned goods')

  return (
    <div className="space-y-6">
      {dueCents > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="label mb-3 text-muted">Record a payment</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-xs text-muted">
              Amount €
              <input className={`${input} mt-1 !w-32`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="block text-xs text-muted">
              By
              <select className={`${input} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted">
              On
              <DateTimeField mode="date" clearable={false} value={on} onChange={(v) => setOn(v)} className="mt-1" />
            </label>
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void call(`/api/admin/finance/wholesale/${id}/payment`, 'POST', { amountCents: toCents(amount) ?? 0, method, paidOn: on })}>
              Record payment
            </button>
            {hasEmail && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => void call(`/api/admin/finance/wholesale/${id}/remind`, 'POST', {}, { okText: 'Reminder sent.' })}>
                Email a reminder
              </button>
            )}
          </div>
        </section>
      )}

      {payments.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="label mb-3 text-muted">Payments received</h2>
          <ul className="divide-y divide-[var(--color-line)] text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>
                  {p.paidOn} · {PAY_METHODS.find((m) => m[0] === p.method)?.[1] ?? p.method}
                </span>
                <span className="flex items-center gap-4">
                  <span className="tabular-nums">{fmt(p.amountCents)}</span>
                  <button type="button" className="text-xs text-muted hover:text-sale" onClick={() => window.confirm('Remove this payment?') && void call(`/api/admin/finance/wholesale/${id}/unpay`, 'POST', { paymentId: p.id })}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-paper p-5">
        <div className="flex items-center justify-between">
          <h2 className="label text-muted">Credit note</h2>
          <button type="button" className={btn.quiet} onClick={() => setCreditOpen((v) => !v)}>
            {creditOpen ? 'Close' : 'Goods back or a discount'}
          </button>
        </div>
        {creditOpen && (
          <div className="mt-4 space-y-4">
            <table className="w-full text-sm">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-2 pr-3">{l.description}</td>
                    <td className="py-2 pr-3 text-right text-xs text-muted">
                      sold {l.quantity} at {fmt(l.unitNetCents)}
                    </td>
                    <td className="w-28 py-2">
                      <input className={`${input} !py-1.5 text-right`} inputMode="numeric" placeholder="units back" value={back[l.id] ?? ''} onChange={(e) => setBack((b) => ({ ...b, [l.id]: e.target.value.replace(/\D/g, '') }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs text-muted">
                and/or an amount off, before VAT €
                <input className={`${input} mt-1 !w-36`} inputMode="decimal" value={off} onChange={(e) => setOff(e.target.value)} />
              </label>
              <label className="block text-xs text-muted">
                Reason (printed on the credit note)
                <input className={`${input} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="flex items-center gap-2 pb-2.5 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Units back go into stock
              </label>
              <button
                type="button"
                className={btn.primary}
                disabled={busy}
                onClick={() =>
                  window.confirm('Issue this credit note? It cannot be undone.') &&
                  void call(`/api/admin/finance/wholesale/${id}/credit`, 'POST', {
                    lines: Object.entries(back).map(([lineId, q]) => ({ lineId, quantity: Number(q) || 0 })),
                    amountNetCents: toCents(off) ?? 0,
                    restock,
                    reason,
                    on: todayIso(),
                  })
                }
              >
                Issue credit note
              </button>
            </div>
          </div>
        )}
      </section>
      {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}
    </div>
  )
}
