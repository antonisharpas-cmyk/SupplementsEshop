'use client'

/* The order's BOX NOW parcel, for staff: the locker the customer chose, the
   button to create the shipment (choosing the compartment size), and once it
   exists the label, the latest state from BOX NOW and cancel. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

export type PanelShipment = {
  id: string
  parcelId: string | null
  reference: string
  state: string
  lastEvent: string | null
  lastEventAt: string | null
  lastEventPlace: string | null
  checkedAt: string | null
  cancelledAt: string | null
  compartmentSize: number
  paymentMode: string
  amountToCollect: string | null
}

const SIZES = [
  { v: 1, label: 'Small (up to 8 cm high)' },
  { v: 2, label: 'Medium (up to 17 cm high)' },
  { v: 3, label: 'Large (up to 36 cm high)' },
]

const words = (s: string) => s.replace(/[-_]/g, ' ')
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Nicosia' }).format(new Date(iso)) : ''

export function BoxNowPanel({
  orderId,
  locker,
  shipments,
  missing,
  canCreate,
  why,
  stage,
}: {
  orderId: string
  locker: { id: string; name: string; address: string; postalCode: string; verified: boolean }
  shipments: PanelShipment[]
  /** Settings not yet given (the integration cannot work without them). */
  missing: string[]
  canCreate: boolean
  /** Why a shipment cannot be created yet, in words. */
  why: string | null
  stage: boolean
}) {
  const router = useRouter()
  const [size, setSize] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/boxnow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) setError(data.message ?? 'That did not work.')
      else router.refresh()
    } catch {
      setError('Could not reach the server.')
    }
    setBusy(false)
  }

  const active = shipments.find((s) => !s.cancelledAt)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-heading">{locker.name || `Locker ${locker.id}`}</p>
        <p className="text-ink-soft">{[locker.address, locker.postalCode].filter(Boolean).join(', ')}</p>
        <p className="mt-1 text-xs text-muted">
          Locker id {locker.id}
          {locker.verified ? '' : ' · not yet confirmed with BOX NOW (checked when the shipment is created)'}
        </p>
      </div>

      {missing.length > 0 && (
        <p className="rounded-xl border border-line-strong bg-paper-2 px-3 py-2 text-xs text-ink-soft">
          BOX NOW is not set up yet, so no shipment can be created. Missing settings: <span className="font-mono">{missing.join(', ')}</span>. See Admin, Settings, BOX NOW.
        </p>
      )}

      {active ? (
        <div className="space-y-2">
          <p>
            Parcel <span className="font-mono text-heading">{active.parcelId}</span>
            {stage && <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">stage</span>}
          </p>
          <p className="text-xs text-muted">
            State: <span className="text-ink">{words(active.state)}</span>
            {active.lastEvent ? ` · last event ${words(active.lastEvent)}${active.lastEventPlace ? ` at ${active.lastEventPlace}` : ''} ${when(active.lastEventAt)}` : ''}
          </p>
          <p className="text-xs text-muted">
            Size {active.compartmentSize} · {active.paymentMode === 'cod' ? `BOX NOW collects ${active.amountToCollect}` : 'prepaid'} · reference {active.reference}
            {active.checkedAt ? ` · checked ${when(active.checkedAt)}` : ''}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a className={btn.primary} href={`/api/admin/orders/${orderId}/boxnow/label?shipment=${active.id}`} target="_blank" rel="noopener noreferrer">
              Print label
            </a>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => void run({ action: 'refresh', shipmentId: active.id })}>
              Refresh status
            </button>
            {active.state === 'new' && (
              <button
                type="button"
                className={btn.quiet}
                disabled={busy}
                onClick={() => void run({ action: 'cancel', shipmentId: active.id }, 'Cancel this BOX NOW parcel? The label stops working.')}
              >
                Cancel parcel
              </button>
            )}
          </div>
        </div>
      ) : canCreate ? (
        <div className="space-y-2">
          <label className="block text-xs text-muted">
            Compartment size
            <select className={`${input} mt-1`} value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {SIZES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={btn.primary}
            disabled={busy}
            onClick={() => void run({ action: 'create', compartmentSize: size }, 'Create the BOX NOW shipment for this order?')}
          >
            {busy ? 'Creating…' : 'Create BOX NOW shipment'}
          </button>
        </div>
      ) : (
        why && <p className="text-xs text-muted">{why}</p>
      )}

      {shipments.filter((s) => s.cancelledAt).length > 0 && (
        <p className="text-xs text-muted">
          Cancelled: {shipments.filter((s) => s.cancelledAt).map((s) => s.parcelId).join(', ')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-sale">
          {error}
        </p>
      )}
    </div>
  )
}
