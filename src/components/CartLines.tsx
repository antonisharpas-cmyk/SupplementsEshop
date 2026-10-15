'use client'

/* Quantity steppers and remove buttons. The only interactive part of the cart
   page, everything else is server-rendered, so the totals cannot drift from
   what the server would charge.

   Each change POSTs, then calls router.refresh() so the server recomputes the
   totals. Deliberately NOT optimistic: an optimistic total that the server
   then disagrees with is how a customer ends up surprised at checkout. */

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { tField as tr } from '@/i18n/field'
import type { CartView } from '@/lib/cart'
import { announceBagCount } from '@/lib/bag-events'

export function CartLines({ locale, view }: { locale: Locale; view: CartView }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyVariant, setBusyVariant] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const money = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: view.totals.currency,
    }).format(c / 100)

  async function setQuantity(variantId: string, quantity: number) {
    setBusyVariant(variantId)
    setError(null)
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, quantity }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; cartCount?: number }
      if (!res.ok || !data.ok) {
        setError(data.message ?? t('err.generic'))
      } else {
        announceBagCount(data.cartCount)
      }
      startTransition(() => router.refresh())
    } catch {
      setError(t('err.network'))
    } finally {
      setBusyVariant(null)
    }
  }

  return (
    <div>
      {error && (
        <p role="alert" className="mb-4 border border-sale/40 bg-sale/5 px-4 py-3 text-sm text-sale">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[var(--color-line)] border-y border-line">
        {view.lines.map((line) => {
          const busy = busyVariant === line.variantId
          return (
            <li key={line.variantId} className="flex gap-4 py-5">
              <Link
                href={`/${locale}/products/${line.productSlug}`}
                className="h-32 w-24 shrink-0 overflow-hidden bg-paper-2"
              >
                {line.imageUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={line.imageUrl}
                    alt={tr(line.productName, locale)}
                    className="h-full w-full object-cover"
                  />
                )}
              </Link>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm">
                      <Link
                        href={`/${locale}/products/${line.productSlug}`}
                        className="hover:underline"
                      >
                        {tr(line.productName, locale)}
                      </Link>
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      {line.size}
                      {line.colorName && ` · ${tr(line.colorName, locale)}`}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {t('pdp.sku')} {line.sku}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium">{money(line.lineFinalCents)}</p>
                    {line.unitDiscountCents > 0 && (
                      <p className="text-xs text-muted line-through">
                        {money(line.listCents * line.quantity)}
                      </p>
                    )}
                  </div>
                </div>

                {/* availability warning — the stock may have moved since the
                    line was added */}
                {!line.isAvailable && (
                  <p className="mt-2 text-xs text-sale">
                    {t('cart.lineUnavailable', { n: line.availableIncludingThisCart })}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between gap-3 pt-3">
                  <div className="flex items-center border border-line">
                    <button
                      type="button"
                      disabled={busy || pending}
                      onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                      className="h-9 w-9 text-sm hover:bg-paper-2 disabled:opacity-40"
                      aria-label="−"
                    >
                      −
                    </button>
                    <span className="w-9 text-center text-sm">{line.quantity}</span>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        pending ||
                        line.quantity >= Math.min(20, line.availableIncludingThisCart)
                      }
                      onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                      className="h-9 w-9 text-sm hover:bg-paper-2 disabled:opacity-40"
                      aria-label="+"
                    >
                      +
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={busy || pending}
                    onClick={() => setQuantity(line.variantId, 0)}
                    className="text-xs text-muted underline hover:text-ink disabled:opacity-40"
                  >
                    {busy ? t('cart.updating') : t('cart.remove')}
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
