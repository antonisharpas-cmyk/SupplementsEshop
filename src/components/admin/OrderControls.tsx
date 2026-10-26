'use client'

/* The buttons on an admin order: the next step, tracking, cash received,
   cancel, refund, and the private note. Each one asks before anything a
   customer will be emailed about. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

const LABEL: Record<string, string> = {
  PROCESSING: 'Confirm and start preparing',
  READY_FOR_PICKUP: 'Ready for collection',
  SHIPPED: 'Mark as out for delivery',
  DELIVERED: 'Mark as delivered',
}

async function act(id: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`/api/admin/orders/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? null : (data.message ?? 'That did not work.')
  } catch {
    return 'Could not reach the server.'
  }
}

export function OrderControls({
  orderId,
  status,
  next,
  paymentMethod,
  cashPending,
  paid,
  note,
  deliveryKind,
}: {
  orderId: string
  status: string
  next: string[]
  paymentMethod: string
  cashPending: boolean
  paid: boolean
  note: string
  deliveryKind: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tracking, setTracking] = useState({ number: '', url: '' })
  const [adminNote, setAdminNote] = useState(note)
  const [noteSaved, setNoteSaved] = useState(false)

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    const err = await act(orderId, body)
    setBusy(false)
    if (err) return setError(err)
    router.refresh()
  }

  const open = ['PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP'].includes(status)
  const returnable = ['SHIPPED', 'DELIVERED'].includes(status) && paid

  return (
    <div className="space-y-6">
      {next.length > 0 && (
        <div className="space-y-3">
          {next.includes('SHIPPED') && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-muted">
                Tracking number (optional)
                <input className={`${input} mt-1`} value={tracking.number} onChange={(e) => setTracking({ ...tracking, number: e.target.value })} />
              </label>
              <label className="text-xs text-muted">
                Tracking link (optional)
                <input className={`${input} mt-1`} placeholder="https://" value={tracking.url} onChange={(e) => setTracking({ ...tracking, url: e.target.value })} />
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {next.map((s) => (
              <button
                key={s}
                type="button"
                className={btn.primary}
                disabled={busy}
                onClick={() =>
                  void run(
                    s === 'SHIPPED'
                      ? { action: 'status', status: s, trackingNumber: tracking.number || undefined, trackingUrl: tracking.url }
                      : { action: 'status', status: s },
                    `${LABEL[s]}? The customer is emailed.`,
                  )
                }
              >
                {s === 'DELIVERED' && deliveryKind === 'PICKUP' ? 'Mark as collected' : LABEL[s]}
              </button>
            ))}
          </div>
          {paymentMethod === 'cod' && next.includes('DELIVERED') && cashPending && (
            <p className="text-xs text-muted">Marking it {deliveryKind === 'PICKUP' ? 'collected' : 'delivered'} also records the cash as received.</p>
          )}
        </div>
      )}

      {status === 'PAYMENT_PENDING' && (
        <p className="text-sm text-muted">Waiting for the customer to pay by card. If nobody pays within an hour, the order is cancelled and its stock returned automatically.</p>
      )}

      <div className="flex flex-wrap gap-3">
        {cashPending && (
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run({ action: 'cash_received' }, 'Record the cash for this order as received?')}>
            Cash received
          </button>
        )}
        {open && (
          <button
            type="button"
            className={btn.secondary}
            disabled={busy}
            onClick={() =>
              void run(
                { action: 'cancel', refund: true },
                paid
                  ? 'Cancel this order, refund the card payment in full and put the items back in stock? The customer is emailed.'
                  : 'Cancel this order and put the items back in stock? The customer is emailed.',
              )
            }
          >
            {paid ? 'Cancel and refund' : 'Cancel order'}
          </button>
        )}
        {returnable && (
          <>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run({ action: 'refund', restock: true }, 'Refund the full amount and put the items back in stock (they came back unopened)?')}>
              Refund, back in stock
            </button>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run({ action: 'refund', restock: false }, 'Refund the full amount without returning the items to stock?')}>
              Refund only
            </button>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-sale">
          {error}
        </p>
      )}

      <div>
        <label className="text-xs text-muted">
          Private note (staff only)
          <textarea rows={3} className={`${input} mt-1`} value={adminNote} onChange={(e) => { setAdminNote(e.target.value); setNoteSaved(false) }} />
        </label>
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            className={btn.quiet}
            disabled={busy || adminNote === note}
            onClick={async () => {
              const err = await act(orderId, { action: 'note', note: adminNote })
              if (err) setError(err)
              else {
                setNoteSaved(true)
                router.refresh()
              }
            }}
          >
            Save note
          </button>
          {noteSaved && <span className="text-xs text-ok">Saved</span>}
        </div>
      </div>
    </div>
  )
}
