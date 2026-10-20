/* ============================================================================
 * Cart page — spec section 11.
 *
 * Server-rendered, so the totals on screen are the totals the server computed.
 * The quantity steppers and the remove buttons are a small client island that
 * POSTs and refreshes.
 * ========================================================================== */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCartView, getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { formatMoney, quoteDelivery } from '@/lib/pricing'
import { getSetting } from '@/lib/settings'
import { CartLines } from '@/components/CartLines'
import { PromoCode } from '@/components/PromoCode'
import { button } from '@/components/ui'

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false, follow: false },
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const base = `/${locale}`

  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])
  /* Admin accounts (owners, support) do not shop. */
  if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') redirect('/admin')

  /* Nothing to show and nothing to create — a visitor who has never added
     anything should not get a cart row just for looking. */
  if (!user && !token) {
    return <EmptyCart locale={locale} />
  }

  const cartId = await getOrCreateCart({
    userId: user?.id ?? null,
    anonymousToken: token,
  })

  const view = await getCartView(cartId, {
    email: user?.email ?? null,
    userId: user?.id ?? null,
    locale,
  })

  if (view.isEmpty) return <EmptyCart locale={locale} />

  const [deliveryQuotes, ttlSeconds, threshold] = await Promise.all([
    quoteDelivery(view.totals.subtotalCents - view.totals.promoCodeDiscountCents),
    getSetting('reservation_ttl_seconds'),
    getSetting('free_delivery_threshold_cents'),
  ])

  const shipping = deliveryQuotes.find((q) => q.kind === 'SHIPPING')
  const money = (c: number) => formatMoney(c, locale, view.totals.currency)

  return (
    <div className="container-x py-10">
      <h1 className="text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-tight">
        {t('cart.title')}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {t('cart.itemCount', { n: view.totals.itemCount })}
      </p>

      {/* free delivery progress — the threshold is admin-configurable */}
      {shipping && (
        <div className="mt-6 border border-line px-4 py-3">
          {shipping.isFree ? (
            <p className="text-sm text-ok">{t('cart.freeDeliveryUnlocked')}</p>
          ) : (
            <>
              <p className="text-sm">
                {t('cart.spendMoreForFree', {
                  amount: money(shipping.spendMoreForFreeCents ?? 0),
                })}
              </p>
              <div className="mt-2 h-1 bg-paper-2">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      ((view.totals.subtotalCents - view.totals.promoCodeDiscountCents) /
                        threshold) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
        {/* ---------------------------------------------------------- lines */}
        <CartLines locale={locale} view={view} />

        {/* -------------------------------------------------------- summary */}
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <div className="border border-line p-6">
            <h2 className="label mb-5">{t('cart.total')}</h2>

            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">{t('cart.subtotal')}</dt>
                <dd>{money(view.totals.listTotalCents)}</dd>
              </div>

              {view.totals.promotionDiscountCents > 0 && (
                <div className="flex justify-between text-sale">
                  <dt>{t('cart.discount')}</dt>
                  <dd>−{money(view.totals.promotionDiscountCents)}</dd>
                </div>
              )}

              {view.totals.promoCodeDiscountCents > 0 && (
                <div className="flex justify-between text-sale">
                  <dt>
                    {t('cart.promoDiscount')}
                    {view.totals.promoCode && (
                      <span className="ml-1.5 text-muted">{view.totals.promoCode.code}</span>
                    )}
                  </dt>
                  <dd>−{money(view.totals.promoCodeDiscountCents)}</dd>
                </div>
              )}

              <div className="flex justify-between">
                <dt className="text-muted">{t('cart.delivery')}</dt>
                <dd className={shipping?.isFree ? 'text-ok' : undefined}>
                  {shipping?.isFree ? t('cart.free') : money(shipping?.priceCents ?? 0)}
                </dd>
              </div>

              <div className="flex items-baseline justify-between border-t border-line pt-3">
                <dt className="label">{t('cart.total')}</dt>
                <dd className="text-xl font-semibold">
                  {money(
                    view.totals.subtotalCents -
                      view.totals.promoCodeDiscountCents +
                      (shipping?.priceCents ?? 0),
                  )}
                </dd>
              </div>

              <div className="flex justify-between text-xs text-muted">
                <dt>{t('cart.vatIncluded', { amount: '' }).trim()}</dt>
                <dd>{money(view.totals.vatCents)}</dd>
              </div>
            </dl>

            {/* Promo code. The applied code lives on the cart row, so it is
                still applied after a refresh or on another device. */}
            <PromoCode
              locale={locale}
              appliedCode={view.totals.promoCode?.code ?? null}
              error={view.promoCodeError?.message ?? null}
            />

            <Link href={`${base}/checkout`} className={`${button.primary} mt-6 w-full`}>
              {t('cart.checkout')}
            </Link>

            <Link
              href={base}
              className="mt-3 block text-center text-xs text-muted underline hover:text-ink"
            >
              {t('cart.continueShopping')}
            </Link>
          </div>

          <p className="mt-4 text-xs text-muted">
            {t('cart.heldFor', { minutes: Math.round(ttlSeconds / 60) })}
          </p>
        </aside>
      </div>
    </div>
  )
}

function EmptyCart({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  return (
    <div className="container-x grid place-items-center py-28 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('cart.title')}</h1>
        <p className="mt-3 text-sm text-muted">{t('cart.empty')}</p>
        <Link href={`/${locale}`} className={`${button.secondary} mt-7`}>
          {t('cart.emptyCta')}
        </Link>
      </div>
    </div>
  )
}
