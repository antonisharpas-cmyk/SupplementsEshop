'use client'

/* ============================================================================
 * Shop settings.
 *
 * Every value here is read live by the storefront — change the free-delivery
 * threshold and the next page load uses it. There is a short server-side cache
 * (a few seconds), which the save clears, so you see your own change
 * immediately rather than wondering whether it took.
 *
 * Money is typed in euros, stored in cents. VAT is typed as a percentage,
 * stored in basis points, so 19% is exactly 1900 and never 18.999999.
 * ========================================================================== */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type SettingsForm = {
  free_delivery_threshold_cents: number
  reservation_ttl_seconds: number
  vat_rate_bp: number
  low_stock_threshold: number
  max_qty_per_line: number
  estimated_delivery_min_days: number
  estimated_delivery_max_days: number
  homepage_promotions_enabled: boolean
  order_number_prefix: string
  support_email: string
  support_idle_minutes: number
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-line py-5 sm:grid-cols-[1fr_11rem] sm:items-start sm:gap-6">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p>
      </div>
      <div className="sm:text-right">{children}</div>
    </div>
  )
}

export function SettingsForm({ initial }: { initial: SettingsForm }) {
  const router = useRouter()
  const [form, setForm] = useState({
    freeDelivery: (initial.free_delivery_threshold_cents / 100).toFixed(2),
    holdMinutes: String(Math.round(initial.reservation_ttl_seconds / 60)),
    vat: (initial.vat_rate_bp / 100).toFixed(2).replace(/\.00$/, ''),
    lowStock: String(initial.low_stock_threshold),
    maxQty: String(initial.max_qty_per_line),
    deliveryMin: String(initial.estimated_delivery_min_days),
    deliveryMax: String(initial.estimated_delivery_max_days),
    promos: initial.homepage_promotions_enabled,
    prefix: initial.order_number_prefix,
    supportEmail: initial.support_email,
    idleMinutes: String(initial.support_idle_minutes),
  })
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof typeof form, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }))
    setStatus('idle')
  }

  const numberField = (key: keyof typeof form, props: Record<string, unknown> = {}) => (
    <input
      value={String(form[key])}
      inputMode="decimal"
      onChange={(e) => set(key, e.target.value)}
      className="w-full border border-line px-3.5 py-2.5 text-right tabular-nums outline-none focus:border-accent"
      {...props}
    />
  )

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const euros = Number(form.freeDelivery.replace(',', '.'))
    const minutes = Number(form.holdMinutes)
    const vat = Number(form.vat.replace(',', '.'))
    const lowStock = Number(form.lowStock)
    const maxQty = Number(form.maxQty)
    const dMin = Number(form.deliveryMin)
    const dMax = Number(form.deliveryMax)

    if (!Number.isFinite(euros) || euros < 0) return setError('Free delivery threshold must be an amount.')
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60)
      return setError('The cart hold must be between 1 and 60 minutes.')
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) return setError('VAT must be a percentage.')
    if (!Number.isInteger(lowStock) || lowStock < 0) return setError('Low stock must be a whole number.')
    if (!Number.isInteger(maxQty) || maxQty < 1) return setError('Maximum quantity must be at least 1.')
    if (!Number.isInteger(dMin) || !Number.isInteger(dMax) || dMin < 0 || dMax < dMin)
      return setError('Delivery days must be whole numbers, and the longest cannot be shorter than the quickest.')
    if (!/^[A-Z][A-Z0-9]{0,5}$/.test(form.prefix))
      return setError('The order prefix is 1–6 capital letters or digits, e.g. SF.')
    const idle = Number(form.idleMinutes)
    if (!Number.isInteger(idle) || idle < 2 || idle > 240)
      return setError('Closing an idle conversation takes a whole number of minutes, 2 to 240.')
    const supportEmail = form.supportEmail.trim().toLowerCase()
    if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))
      return setError('The customer-service email does not look like an email address.')

    setStatus('saving')
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          free_delivery_threshold_cents: Math.round(euros * 100),
          reservation_ttl_seconds: minutes * 60,
          vat_rate_bp: Math.round(vat * 100),
          low_stock_threshold: lowStock,
          max_qty_per_line: maxQty,
          estimated_delivery_min_days: dMin,
          estimated_delivery_max_days: dMax,
          homepage_promotions_enabled: form.promos,
          order_number_prefix: form.prefix,
          support_email: supportEmail,
          support_idle_minutes: idle,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Could not save those settings.')
        setStatus('idle')
        return
      }
      setStatus('saved')
      router.refresh()
    } catch {
      setError('Could not reach the server.')
      setStatus('idle')
    }
  }

  return (
    <form onSubmit={save} className="max-w-3xl border border-line bg-paper px-6">
      {error && (
        <p role="alert" className="mt-5 border border-sale/40 bg-sale/5 px-4 py-3 text-sm text-sale">
          {error}
        </p>
      )}

      <Row
        label="Free delivery over"
        hint="Orders at or above this total are delivered free. Shown as a progress bar in the bag."
      >
        {numberField('freeDelivery')}
      </Row>

      <Row
        label="Hold stock in a cart for"
        hint="How long an item in a bag is kept aside for that customer. After this it stays in their bag but goes back on sale for everyone, and it is held again when they check out if it is still there. Minutes."
      >
        {numberField('holdMinutes')}
      </Row>

      <Row
        label="VAT rate"
        hint="Prices are shown VAT-inclusive, as EU consumer law requires, so this is used to show how much of a total is VAT, never to add anything on top. Percent."
      >
        {numberField('vat')}
      </Row>

      <Row
        label="Low stock warning at"
        hint="A size with this many or fewer left is flagged here and shown as “only a few left” in the shop."
      >
        {numberField('lowStock')}
      </Row>

      <Row
        label="Maximum per size in one order"
        hint="Stops one person clearing out a size. It does not affect how many different items they buy."
      >
        {numberField('maxQty')}
      </Row>

      <Row label="Delivery estimate (days)" hint="Shown on the product page and in the confirmation email.">
        <div className="flex items-center gap-2">
          {numberField('deliveryMin')}
          <span className="text-muted">–</span>
          {numberField('deliveryMax')}
        </div>
      </Row>

      <Row
        label="Order number prefix"
        hint="The start of every order number, e.g. SF-7K2M9QX4. Capitals and digits."
      >
        <input
          value={form.prefix}
          onChange={(e) => set('prefix', e.target.value.toUpperCase())}
          maxLength={6}
          className="w-full border border-line px-3.5 py-2.5 text-right uppercase outline-none focus:border-accent"
        />
      </Row>

      <Row
        label="Promotion banner on the homepage"
        hint="Switches the banner off without deleting any promotion. The discounts themselves keep working."
      >
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.promos}
            onChange={(e) => set('promos', e.target.checked)}
            className="h-4 w-4 accent-[var(--color-accent)]"
          />
          <span>{form.promos ? 'Showing' : 'Hidden'}</span>
        </label>
      </Row>

      <Row
        label="Customer-service email"
        hint="Told whenever a customer starts a new conversation. Leave empty to use the shop's contact address."
      >
        <input
          type="email"
          value={form.supportEmail}
          onChange={(e) => set('supportEmail', e.target.value)}
          placeholder="support@yourshop.com"
          className="w-full border border-line px-3.5 py-2.5 text-right outline-none focus:border-accent"
        />
      </Row>

      <Row
        label="Close a quiet conversation after"
        hint="With no new message from either side for this long, a conversation closes itself and the customer is emailed the transcript. Minutes."
      >
        {numberField('idleMinutes')}
      </Row>

      <div className="flex items-center gap-4 py-6">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="btn btn-primary"
        >
          {status === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {status === 'saved' && <span className="text-sm text-ok">Saved. The shop is using these now.</span>}
      </div>
    </form>
  )
}
