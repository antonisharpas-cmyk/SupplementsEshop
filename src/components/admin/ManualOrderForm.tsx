'use client'

/* Take an order for a customer: who, what, how it gets to them, and the
   delivery charge agreed on the phone. */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneInput } from '@/components/PhoneInput'
import { btn, input } from '@/components/admin/ui'

type Item = { variantId: string; label: string; sku: string; priceCents: number; available: number; hidden: boolean }
type Line = { variantId: string; quantity: number; price: string }

const euros = (c: number) => (c / 100).toFixed(2)
const cents = (s: string) => {
  const v = s.trim().replace(',', '.')
  return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null
}
const money = (c: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(c / 100)

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <span className="label text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h2 className="mb-5 flex items-center gap-3 text-lg font-semibold text-heading">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-gold text-sm font-bold text-black">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function ManualOrderForm({ catalogue, shippingCents }: { catalogue: Item[]; shippingCents: number }) {
  const router = useRouter()
  const byId = useMemo(() => new Map(catalogue.map((c) => [c.variantId, c])), [catalogue])

  const [c, setC] = useState({ firstName: '', lastName: '', email: '', phone: '', locale: 'en' as 'en' | 'el' | 'ru' })
  const [lines, setLines] = useState<Line[]>([])
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'SHIPPING' | 'PICKUP'>('SHIPPING')
  const [addr, setAddr] = useState({ line1: '', line2: '', city: '', postalCode: '', country: 'CY' })
  const [delivery, setDelivery] = useState(euros(shippingCents))
  const [paid, setPaid] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return catalogue.filter((i) => `${i.label} ${i.sku}`.toLowerCase().includes(q)).slice(0, 8)
  }, [query, catalogue])

  const add = (i: Item) => {
    setLines((ls) =>
      ls.some((l) => l.variantId === i.variantId)
        ? ls.map((l) => (l.variantId === i.variantId ? { ...l, quantity: l.quantity + 1 } : l))
        : [...ls, { variantId: i.variantId, quantity: 1, price: euros(i.priceCents) }],
    )
    setQuery('')
  }
  const setLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.variantId === id ? { ...l, ...patch } : l)))

  const goods = lines.reduce((n, l) => n + (cents(l.price) ?? 0) * l.quantity, 0)
  const deliveryCents = kind === 'PICKUP' ? 0 : (cents(delivery) ?? 0)
  const total = goods + deliveryCents

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!lines.length) return setError('Add at least one product.')
    const bad = lines.find((l) => cents(l.price) === null)
    if (bad) return setError('Check the prices: use euros, e.g. 39.90.')
    if (kind === 'SHIPPING' && cents(delivery) === null) return setError('Enter the delivery charge in euros, e.g. 15 or 0.')
    setBusy(true)
    const res = await fetch('/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...c,
        delivery: kind === 'SHIPPING' ? { kind, address: { ...addr, line2: addr.line2 || undefined } } : { kind },
        deliveryCents,
        lines: lines.map((l) => {
          const item = byId.get(l.variantId)!
          const unit = cents(l.price)!
          return { variantId: l.variantId, quantity: l.quantity, unitCents: unit === item.priceCents ? undefined : unit }
        }),
        paid,
        sendEmail: sendEmail && Boolean(c.email.trim()),
        note: note || undefined,
      }),
    }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
    if (!res?.ok || !data?.ok) {
      setBusy(false)
      return setError(data?.message ?? 'Could not create the order. Try again.')
    }
    router.push(`/admin/orders/${data.id}?created=1`)
  }

  return (
    <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <Section n={1} title="Customer">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input className={input} value={c.firstName} onChange={(e) => setC({ ...c, firstName: e.target.value })} required autoFocus />
            </Field>
            <Field label="Last name">
              <input className={input} value={c.lastName} onChange={(e) => setC({ ...c, lastName: e.target.value })} required />
            </Field>
            <PhoneInput locale="en" label="Mobile number" name="phone" value={c.phone} onChange={(phone) => setC((x) => ({ ...x, phone }))} required className="rounded-xl" />
            <Field label="Email (optional)" hint="For the confirmation and invoice. If it belongs to an account, the order shows there too.">
              <input className={input} type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
            </Field>
            <Field label="Language for emails and the invoice">
              <select className={input} value={c.locale} onChange={(e) => setC({ ...c, locale: e.target.value as 'en' | 'el' | 'ru' })}>
                <option value="en">English</option>
                <option value="el">Greek</option>
                <option value="ru">Russian</option>
              </select>
            </Field>
          </div>
        </Section>

        <Section n={2} title="Products">
          <div className="relative">
            <input className={input} placeholder="Search a product, flavour, size or SKU" value={query} onChange={(e) => setQuery(e.target.value)} />
            {matches.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-2xl border border-line bg-paper-2 py-1 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)]">
                {matches.map((i) => (
                  <li key={i.variantId}>
                    <button
                      type="button"
                      onClick={() => add(i)}
                      disabled={i.available <= 0}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-paper disabled:opacity-40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{i.label}</span>
                        <span className="block text-xs text-muted">
                          {i.sku} · {i.available > 0 ? `${i.available} on the shelf` : 'none on the shelf'}
                          {i.hidden ? ' · hidden on the shop' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-heading">{money(i.priceCents)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {lines.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-muted">
              Search above and click a product to add it.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {lines.map((l) => {
                const item = byId.get(l.variantId)!
                const over = l.quantity > item.available
                return (
                  <li key={l.variantId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-paper-2 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{item.label}</span>
                      <span className={`block text-xs ${over ? 'text-sale' : 'text-muted'}`}>
                        {item.available} on the shelf{over ? ', not enough' : ''}
                      </span>
                    </span>
                    <span className="flex items-center overflow-hidden rounded-full border border-line">
                      <button type="button" className="h-9 w-9 hover:bg-paper" onClick={() => setLine(l.variantId, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Fewer">
                        −
                      </button>
                      <span className="w-8 text-center text-sm tabular-nums">{l.quantity}</span>
                      <button type="button" className="h-9 w-9 hover:bg-paper" onClick={() => setLine(l.variantId, { quantity: l.quantity + 1 })} aria-label="More">
                        +
                      </button>
                    </span>
                    <label className="flex items-center gap-1.5 text-sm text-muted">
                      €
                      <input
                        className={`${input.replace('w-full', 'w-24')} py-2 tabular-nums`}
                        inputMode="decimal"
                        value={l.price}
                        onChange={(e) => setLine(l.variantId, { price: e.target.value })}
                        aria-label="Unit price"
                        title="Price each. Change it for an agreed discount."
                      />
                    </label>
                    <span className="w-20 text-right text-sm font-semibold tabular-nums text-heading">{money((cents(l.price) ?? 0) * l.quantity)}</span>
                    <button type="button" className={btn.quiet} onClick={() => setLines((ls) => ls.filter((x) => x.variantId !== l.variantId))}>
                      Remove
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">The price shown is today&apos;s price, offers included. Change it for an agreed discount.</p>
        </Section>

        <Section n={3} title="Delivery">
          <div className="flex flex-wrap gap-2">
            {(['SHIPPING', 'PICKUP'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${kind === k ? 'border-transparent bg-gold font-semibold text-black' : 'border-line hover:border-line-strong'}`}
              >
                {k === 'SHIPPING' ? 'We deliver it' : 'They collect from the store'}
              </button>
            ))}
          </div>
          {kind === 'SHIPPING' && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Street and number">
                <input className={input} value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} required />
              </Field>
              <Field label="Flat, floor (optional)">
                <input className={input} value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />
              </Field>
              <Field label="Town or city">
                <input className={input} value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} required />
              </Field>
              <Field label="Postal code">
                <input className={input} value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} required />
              </Field>
              <Field label="Delivery charge (€)" hint="What you agreed with the customer. 0 for free delivery.">
                <div className="flex gap-2">
                  <input className={`${input} tabular-nums`} inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
                  {['0', '5', '15'].map((v) => (
                    <button key={v} type="button" onClick={() => setDelivery(`${v}.00`)} className="btn btn-ghost btn-sm shrink-0">
                      €{v}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </Section>

        <Section n={4} title="Payment and notes">
          <div className="flex flex-wrap gap-2">
            {[
              { v: false, label: 'Pays on delivery or collection' },
              { v: true, label: 'Already paid' },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setPaid(o.v)}
                className={`rounded-full border px-4 py-2 text-sm transition-colors ${paid === o.v ? 'border-transparent bg-gold font-semibold text-black' : 'border-line hover:border-line-strong'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {paid ? 'The payment is recorded now and the invoice is issued straight away.' : 'Marked paid when you set the order to Delivered, and the invoice is issued then.'}
          </p>
          <div className="mt-5">
            <Field label="Note for the team (optional)">
              <textarea className={input} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Call before delivering, after 6pm." />
            </Field>
          </div>
          <label className={`mt-4 flex items-center gap-2.5 text-sm ${c.email.trim() ? '' : 'opacity-50'}`}>
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={sendEmail && Boolean(c.email.trim())} disabled={!c.email.trim()} onChange={(e) => setSendEmail(e.target.checked)} />
            Email the customer an order confirmation
          </label>
        </Section>
      </div>

      <aside className="xl:sticky xl:top-8 xl:self-start">
        <div className="rounded-2xl border border-line bg-paper-2 p-6">
          <h2 className="text-lg font-semibold text-heading">Summary</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between text-muted">
              <dt>{lines.reduce((n, l) => n + l.quantity, 0)} items</dt>
              <dd className="tabular-nums text-ink">{money(goods)}</dd>
            </div>
            <div className="flex justify-between text-muted">
              <dt>{kind === 'PICKUP' ? 'Collection' : 'Delivery'}</dt>
              <dd className="tabular-nums text-ink">{deliveryCents ? money(deliveryCents) : 'Free'}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-bold text-heading">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(total)}</dd>
            </div>
            <p className="text-xs text-muted">Prices include VAT.</p>
          </dl>
          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-sale/40 bg-sale/10 px-3 py-2 text-sm text-ink">
              {error}
            </p>
          )}
          <button type="submit" className={`${btn.primary} mt-5 w-full`} disabled={busy}>
            {busy ? 'Creating' : 'Create order'}
          </button>
          <p className="mt-3 text-xs text-muted">Stock is taken off the shelf now. Cancelling the order puts it back.</p>
        </div>
      </aside>
    </form>
  )
}
