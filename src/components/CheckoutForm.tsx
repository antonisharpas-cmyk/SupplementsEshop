'use client'

/* ============================================================================
 * The checkout form.
 *
 * Three steps on one page: your details, how it reaches you, how you pay.
 * The summary on the right follows the delivery choice. Placing the order
 * either opens Stripe's payment page (card) or goes straight to the order
 * confirmation (cash on delivery).
 * ========================================================================== */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { PhoneInput } from '@/components/PhoneInput'
import { button } from '@/components/ui'
import { announceBagCount } from '@/lib/bag-events'

type Address = {
  id: string
  label: string | null
  recipientName: string
  phone: string
  line1: string
  line2: string | null
  city: string
  postalCode: string
  country: string
  isDefault: boolean
}

type Option = { id: string; kind: 'PICKUP' | 'SHIPPING'; name: string; priceCents: number; minDays: number | null; maxDays: number | null }

type Line = { variantId: string; name: string; detail: string; imageUrl: string | null; quantity: number; lineFinalCents: number }

const fieldClass = (bad?: boolean) =>
  `mt-2 w-full border bg-paper px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-accent ${bad ? 'border-sale' : 'border-line'}`

function Input({
  label,
  name,
  error,
  ...props
}: { label: string; name: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label text-muted">{label}</span>
      <input name={name} aria-invalid={error ? true : undefined} className={fieldClass(Boolean(error))} {...props} />
      {error && <span className="mt-1.5 block text-xs text-sale">{error}</span>}
    </label>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="border border-line bg-paper-2 p-5 sm:p-6">
      <h2 className="flex items-center gap-3 text-lg font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-bold text-black">{n}</span>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

export function CheckoutForm(props: {
  locale: Locale
  signedIn: boolean
  cardEnabled: boolean
  profile: { firstName: string; lastName: string; phone: string; email: string } | null
  saved: Address[]
  options: Option[]
  lines: Line[]
  totals: {
    listTotalCents: number
    promotionDiscountCents: number
    promoCode: string | null
    promoCodeDiscountCents: number
    subtotalAfterDiscounts: number
    vatRateBp: number
    currency: string
  }
  pickupPlace: string
}) {
  const { locale, totals, options } = props
  const t = getTranslator(locale)
  const money = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: totals.currency,
    }).format(c / 100)

  const [contact, setContact] = useState({
    email: props.profile?.email ?? '',
    phone: props.profile?.phone ?? '',
    firstName: props.profile?.firstName ?? '',
    lastName: props.profile?.lastName ?? '',
  })
  const defaultOption = options.find((o) => o.kind === 'SHIPPING') ?? options[0]
  const [optionId, setOptionId] = useState(defaultOption?.id ?? '')
  const option = options.find((o) => o.id === optionId)
  const defaultAddress = props.saved.find((a) => a.isDefault) ?? props.saved[0]
  const [addressId, setAddressId] = useState<string>(defaultAddress?.id ?? 'new')
  const [addr, setAddr] = useState({
    recipientName: props.profile ? `${props.profile.firstName} ${props.profile.lastName}` : '',
    phone: props.profile?.phone ?? '',
    line1: '',
    line2: '',
    city: '',
    postalCode: '',
  })
  const [saveAddress, setSaveAddress] = useState(true)
  const [method, setMethod] = useState<'card' | 'cod'>(props.cardEnabled ? 'card' : 'cod')
  const [note, setNote] = useState('')
  const [terms, setTerms] = useState(false)
  const [smsConsent, setSmsConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const deliveryCents = option?.priceCents ?? 0
  const total = totals.subtotalAfterDiscounts + deliveryCents
  const vat = Math.round(total - (total * 10_000) / (10_000 + totals.vatRateBp))
  const shipping = option?.kind === 'SHIPPING'

  const chosenAddress = useMemo(() => props.saved.find((a) => a.id === addressId) ?? null, [props.saved, addressId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setErrors({})
    if (!terms) {
      setErrors({ acceptTerms: t('co.fixErrors') })
      setError(t('co.fixErrors'))
      return
    }
    const shippingAddress = !shipping
      ? undefined
      : chosenAddress
        ? {
            recipientName: chosenAddress.recipientName,
            phone: chosenAddress.phone,
            line1: chosenAddress.line1,
            line2: chosenAddress.line2 ?? '',
            city: chosenAddress.city,
            postalCode: chosenAddress.postalCode,
            country: chosenAddress.country,
          }
        : { ...addr, country: 'CY' }

    setBusy(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...contact,
          deliveryOptionId: optionId,
          shippingAddress,
          customerNote: note,
          paymentMethod: method,
          saveAddress: props.signedIn && shipping && !chosenAddress && saveAddress,
          acceptTerms: true,
          smsConsent,
          locale,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        fields?: Record<string, string>
        redirectUrl?: string
      }
      if (!res.ok || !data.ok || !data.redirectUrl) {
        const fields: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.fields ?? {})) fields[k.replace(/^shippingAddress\./, 'addr.')] = v
        setErrors(fields)
        setError(Object.keys(fields).length ? t('co.fixErrors') : (data.message ?? t('err.generic')))
        setBusy(false)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      announceBagCount(0)
      window.location.assign(data.redirectUrl)
    } catch {
      setError(t('err.network'))
      setBusy(false)
    }
  }

  const radio = (on: boolean) =>
    `flex cursor-pointer items-start gap-3 border p-4 transition-colors ${on ? 'border-accent bg-paper' : 'border-line bg-paper hover:border-line-strong'}`

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        {error && (
          <p role="alert" className="border border-sale/40 bg-sale/5 px-4 py-3 text-sm text-sale">
            {error}
          </p>
        )}

        <Step n={1} title={t('co.contact')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('auth.firstName')} name="firstName" autoComplete="given-name" value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} error={errors.firstName} required />
            <Input label={t('auth.lastName')} name="lastName" autoComplete="family-name" value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} error={errors.lastName} required />
            <Input label={t('auth.email')} name="email" type="email" autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} error={errors.email} required />
            <PhoneInput locale={locale} label={t('auth.phone')} name="phone" value={contact.phone} onChange={(phone) => setContact((c) => ({ ...c, phone }))} error={errors.phone} required />
          </div>
        </Step>

        <Step n={2} title={t('co.delivery')}>
          <div className="space-y-2" role="radiogroup" aria-label={t('co.delivery')}>
            {options.map((o) => (
              <label key={o.id} className={radio(o.id === optionId)}>
                <input type="radio" name="delivery" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={o.id === optionId} onChange={() => setOptionId(o.id)} />
                <span className="flex-1">
                  <span className="flex justify-between gap-3 text-sm font-medium text-heading">
                    {o.name}
                    <span className={o.priceCents === 0 ? 'text-ok' : ''}>{o.priceCents === 0 ? t('cart.free') : money(o.priceCents)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {o.kind === 'PICKUP'
                      ? `${props.pickupPlace}. ${t('co.ready')}`
                      : t('co.deliveryDays', { min: o.minDays ?? 2, max: o.maxDays ?? 4 })}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {shipping && (
            <div className="mt-6">
              <p className="label text-muted">{t('co.address')}</p>
              {props.saved.length > 0 && (
                <div className="mt-3 space-y-2">
                  {props.saved.map((a) => (
                    <label key={a.id} className={radio(addressId === a.id)}>
                      <input type="radio" name="address" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                      <span className="text-sm">
                        <span className="font-medium text-heading">{a.label || a.recipientName}</span>
                        <span className="block text-muted">
                          {[a.line1, a.line2, `${a.postalCode} ${a.city}`].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </label>
                  ))}
                  <label className={radio(addressId === 'new')}>
                    <input type="radio" name="address" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={addressId === 'new'} onChange={() => setAddressId('new')} />
                    <span className="text-sm font-medium text-heading">{t('co.newAddress')}</span>
                  </label>
                </div>
              )}

              {(addressId === 'new' || props.saved.length === 0) && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Input label={t('co.recipient')} name="recipientName" autoComplete="name" value={addr.recipientName} onChange={(e) => setAddr({ ...addr, recipientName: e.target.value })} error={errors['addr.recipientName']} />
                  <Input label={t('auth.phone')} name="addrPhone" type="tel" autoComplete="tel" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} error={errors['addr.phone']} />
                  <div className="sm:col-span-2">
                    <Input label={t('co.line1')} name="line1" autoComplete="address-line1" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} error={errors['addr.line1']} />
                  </div>
                  <div className="sm:col-span-2">
                    <Input label={t('co.line2')} name="line2" autoComplete="address-line2" value={addr.line2} onChange={(e) => setAddr({ ...addr, line2: e.target.value })} />
                  </div>
                  <Input label={t('co.city')} name="city" autoComplete="address-level2" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} error={errors['addr.city']} />
                  <Input label={t('co.postalCode')} name="postalCode" autoComplete="postal-code" inputMode="numeric" value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} error={errors['addr.postalCode']} />
                  {props.signedIn && (
                    <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                      <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
                      {t('co.saveAddress')}
                    </label>
                  )}
                </div>
              )}
              {errors.shippingAddress && <p className="mt-2 text-xs text-sale">{errors.shippingAddress}</p>}
            </div>
          )}
        </Step>

        <Step n={3} title={t('co.payment')}>
          <div className="space-y-2" role="radiogroup" aria-label={t('co.payment')}>
            <label className={`${radio(method === 'card')} ${props.cardEnabled ? '' : 'cursor-not-allowed opacity-50'}`}>
              <input type="radio" name="method" disabled={!props.cardEnabled} className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={method === 'card'} onChange={() => setMethod('card')} />
              <span className="text-sm">
                <span className="font-medium text-heading">{t('co.payCard')}</span>
                <span className="mt-0.5 block text-xs text-muted">{props.cardEnabled ? t('co.payCardNote') : t('co.payCardOff')}</span>
              </span>
            </label>
            <label className={radio(method === 'cod')}>
              <input type="radio" name="method" className="mt-1 h-4 w-4 accent-[var(--color-accent)]" checked={method === 'cod'} onChange={() => setMethod('cod')} />
              <span className="text-sm">
                <span className="font-medium text-heading">{shipping ? t('co.payCod') : t('co.payCodPickup')}</span>
                <span className="mt-0.5 block text-xs text-muted">{shipping ? t('co.payCodNote') : t('co.payCodPickupNote')}</span>
              </span>
            </label>
          </div>

          <label className="mt-5 block">
            <span className="label text-muted">{t('co.note')}</span>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} className={fieldClass()} />
          </label>
        </Step>
      </div>

      {/* ------------------------------------------------------------ summary */}
      <aside className="lg:sticky lg:top-28 lg:self-start">
        <div className="border border-line bg-paper-2 p-6">
          <h2 className="label mb-4">{t('co.summary')}</h2>
          <ul className="space-y-3">
            {props.lines.map((l) => (
              <li key={l.variantId} className="flex gap-3">
                <span className="relative h-16 w-12 shrink-0 overflow-hidden bg-paper">
                  {l.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={l.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                  <span className="absolute -top-0 -right-0 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold text-black">
                    {l.quantity}
                  </span>
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate text-heading">{l.name}</span>
                  <span className="block text-xs text-muted">{l.detail}</span>
                </span>
                <span className="text-sm tabular-nums">{money(l.lineFinalCents)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-5 space-y-2.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t('cart.subtotal')}</dt>
              <dd>{money(totals.listTotalCents)}</dd>
            </div>
            {totals.promotionDiscountCents > 0 && (
              <div className="flex justify-between text-sale">
                <dt>{t('cart.discount')}</dt>
                <dd>−{money(totals.promotionDiscountCents)}</dd>
              </div>
            )}
            {totals.promoCodeDiscountCents > 0 && (
              <div className="flex justify-between text-sale">
                <dt>
                  {t('cart.promoDiscount')} <span className="text-muted">{totals.promoCode}</span>
                </dt>
                <dd>−{money(totals.promoCodeDiscountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">{t('cart.delivery')}</dt>
              <dd className={deliveryCents === 0 ? 'text-ok' : ''}>{deliveryCents === 0 ? t('cart.free') : money(deliveryCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <dt className="label">{t('cart.total')}</dt>
              <dd className="text-2xl font-semibold text-heading">{money(total)}</dd>
            </div>
            <div className="flex justify-between text-xs text-muted">
              <dt>{t('cart.vatIncluded', { amount: '' }).trim()}</dt>
              <dd>{money(vat)}</dd>
            </div>
          </dl>

          <label className="mt-5 flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
            <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]" />
            <span>
              {t('auth.smsOptIn')}
              <span className="block text-muted">{t('auth.smsNote')}</span>
            </span>
          </label>

          <label className="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className={`mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] ${errors.acceptTerms ? 'outline outline-sale' : ''}`} />
            <span>
              {t('co.terms')}{' '}
              <Link href={`/${locale}/privacy`} target="_blank" className="underline">
                {t('co.privacy')}
              </Link>
              .
            </span>
          </label>

          <button type="submit" className={`${button.primary} mt-5 w-full`} disabled={busy || !optionId}>
            {busy ? t('co.placing') : method === 'card' ? `${t('co.payNow')} · ${money(total)}` : `${t('co.placeOrder')} · ${money(total)}`}
          </button>
        </div>
      </aside>
    </form>
  )
}
