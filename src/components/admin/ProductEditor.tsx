'use client'

/* ============================================================================
 * Editing one product: its status, and its price.
 *
 * Two independent pieces, each saving only what it owns, so changing the
 * status can never resend (and overwrite) a price someone else just changed.
 *
 * Prices are typed in euros and sent in cents. The conversion happens once,
 * here, at the boundary — everywhere inside the system money is an integer
 * number of cents.
 * ========================================================================== */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, type ProductStatusValue } from './ui'

async function patchProduct(productId: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(`/api/admin/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? null : (data.message ?? 'Could not save that.')
  } catch {
    return 'Could not reach the server.'
  }
}

/* ------------------------------------------------------------- status -- */

const STATUSES: { value: ProductStatusValue; label: string; body: string }[] = [
  {
    value: 'available',
    label: 'Available',
    body: 'In the shop. Customers can buy any size that has stock.',
  },
  {
    value: 'sold_out',
    label: 'Sold out',
    body: 'Still in the shop, categories and search, marked SOLD OUT. Nobody can add it to a bag, whatever the stock says.',
  },
  {
    value: 'hidden',
    label: 'Hidden',
    body: 'Off the storefront and search. Nothing is deleted, orders, photos and stock stay as they are.',
  },
]

export function StatusControl({ productId, status }: { productId: string; status: ProductStatusValue }) {
  const router = useRouter()
  const [current, setCurrent] = useState(status)
  const [saving, setSaving] = useState<ProductStatusValue | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function choose(next: ProductStatusValue) {
    if (next === current || saving) return
    setSaving(next)
    setNote(null)
    const error = await patchProduct(productId, { status: next })
    setSaving(null)
    if (error) {
      setNote({ tone: 'bad', text: error })
      return
    }
    setCurrent(next)
    setNote({ tone: 'ok', text: 'Saved ✓, the shop shows this on the next page load.' })
    router.refresh()
  }

  return (
    <fieldset>
      <legend className="sr-only">Status</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {STATUSES.map((s) => {
          const on = s.value === current
          return (
            <label
              key={s.value}
              className={`relative flex cursor-pointer flex-col gap-1.5 border p-4 transition-colors ${
                on ? 'border-ink bg-paper' : 'border-line bg-paper hover:border-ink-soft'
              } ${saving ? 'cursor-wait' : ''}`}
            >
              <span className="flex items-center gap-2.5 text-sm font-medium">
                <input
                  type="radio"
                  name={`status-${productId}`}
                  value={s.value}
                  checked={on}
                  disabled={saving !== null}
                  onChange={() => void choose(s.value)}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {s.label}
                {saving === s.value && <span className="text-xs font-normal text-muted">Saving…</span>}
              </span>
              <span className="text-xs leading-relaxed text-muted">{s.body}</span>
            </label>
          )
        })}
      </div>
      {note && (
        <p role={note.tone === 'bad' ? 'alert' : 'status'} className={`mt-3 text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>
          {note.text}
        </p>
      )}
    </fieldset>
  )
}

/* ------------------------------------------------------------ pricing -- */

/** Euros as typed → integer cents. Rejects anything that is not a clean
 *  amount, rather than silently rounding someone's price. */
function toCents(input: string): number | null {
  const trimmed = input.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

const toEuros = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2))

export function PriceEditor({
  productId,
  priceCents,
  salePriceCents,
}: {
  productId: string
  priceCents: number
  salePriceCents: number | null
}) {
  const router = useRouter()
  const [price, setPrice] = useState(toEuros(priceCents))
  const [sale, setSale] = useState(toEuros(salePriceCents))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const priceValue = toCents(price)
    if (priceValue === null) return setError('Price must be an amount like 59 or 59.90.')
    const saleValue = sale.trim() === '' ? null : toCents(sale)
    if (sale.trim() !== '' && saleValue === null)
      return setError('Sale price must be an amount like 44.90, or empty for no sale.')
    if (saleValue !== null && saleValue >= priceValue)
      return setError('A sale price has to be lower than the normal price.')

    setStatus('saving')
    const failure = await patchProduct(productId, { priceCents: priceValue, salePriceCents: saleValue })
    if (failure) {
      setError(failure)
      setStatus('idle')
      return
    }
    setStatus('saved')
    router.refresh()
  }

  const p = toCents(price)
  const s = toCents(sale)
  const discount = s !== null && p !== null && p > 0 && s < p ? Math.round((1 - s / p) * 100) : null

  return (
    <form onSubmit={save} className="max-w-xl space-y-5" noValidate>
      {error && (
        <p role="alert" className="border border-sale/40 bg-sale/5 px-4 py-3 text-sm text-sale">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="price" className="label block text-muted">
            Price (€)
          </label>
          <input
            id="price"
            value={price}
            inputMode="decimal"
            onChange={(e) => {
              setPrice(e.target.value)
              setStatus('idle')
            }}
            className="mt-2 w-full border border-line bg-paper px-3.5 py-3 text-right tabular-nums outline-none focus:border-accent"
          />
        </div>

        <div>
          <label htmlFor="sale" className="label block text-muted">
            Sale price (€)
          </label>
          <input
            id="sale"
            value={sale}
            inputMode="decimal"
            placeholder="none"
            aria-describedby="sale-help"
            onChange={(e) => {
              setSale(e.target.value)
              setStatus('idle')
            }}
            className="mt-2 w-full border border-line bg-paper px-3.5 py-3 text-right tabular-nums outline-none focus:border-accent"
          />
          <p id="sale-help" className="mt-1.5 text-xs text-muted">
            {discount !== null ? `${discount}% off. ` : 'Leave empty for no sale. '}
            An automatic promotion never stacks on top of this, the customer gets whichever is cheaper.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button type="submit" disabled={status === 'saving'} className={btn.primary}>
          {status === 'saving' ? 'Saving…' : 'Save prices'}
        </button>
        {status === 'saved' && (
          <span role="status" className="text-sm text-ok">
            Saved ✓
          </span>
        )}
      </div>
    </form>
  )
}
