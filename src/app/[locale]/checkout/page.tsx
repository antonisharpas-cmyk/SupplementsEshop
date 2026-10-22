/* ============================================================================
 * Checkout.
 *
 * The page is rendered with everything priced on the server: the bag, each
 * delivery option at its real price for this bag (free over the threshold),
 * and the customer's saved addresses. The form only chooses between them; the
 * server prices it all again when the order is placed.
 * ========================================================================== */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { eq, desc } from 'drizzle-orm'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { db } from '@/db'
import { addresses, users } from '@/db/schema'
import { getCartView, getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { quoteDelivery } from '@/lib/pricing'
import { stripeEnabled, stripeTestMode } from '@/lib/stripe'
import { boxnowConfig, boxnowStatus } from '@/lib/boxnow'
import { tField } from '@/i18n/field'
import { CheckoutForm } from '@/components/CheckoutForm'

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ guest?: string }>
}) {
  const { locale: raw } = await params
  const { guest } = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const base = `/${locale}`

  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])
  /* Admin accounts (owners, support) do not shop. */
  if (user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') redirect('/admin')
  if (!user && !token) redirect(`${base}/cart`)
  const cartId = await getOrCreateCart({
    userId: user?.id ?? null,
    anonymousToken: token,
  })
  const view = await getCartView(cartId, {
    email: user?.email ?? null,
    userId: user?.id ?? null,
    locale,
  })
  if (view.isEmpty) redirect(`${base}/cart`)

  const afterDiscounts = view.totals.subtotalCents - view.totals.promoCodeDiscountCents
  const [quotes, saved, profile] = await Promise.all([
    /* The website delivers only; collection is for orders staff take by phone. */
    quoteDelivery(afterDiscounts).then((q) => q.filter((o) => o.kind === 'SHIPPING')),
    user
      ? db
          .select()
          .from(addresses)
          .where(eq(addresses.userId, user.id))
          .orderBy(desc(addresses.isDefault))
      : Promise.resolve([]),
    user
      ? db
          .select({
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            email: users.email,
          })
          .from(users)
          .where(eq(users.id, user.id))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ])

  return (
    <div className="container-x py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[clamp(1.6rem,4vw,2.4rem)] font-semibold tracking-tight">
          {t('co.title')}
        </h1>
        <Link href={`${base}/cart`} className="text-sm text-muted underline hover:text-ink">
          {t('co.editBag')}
        </Link>
      </div>
      {/* Not signed in: first choose, sign in (and come straight back here,
          with the same bag) or carry on as a guest. */}
      {!user && guest !== '1' ? (
        <section aria-labelledby="co-gate" className="mx-auto mt-10 max-w-3xl">
          <h2 id="co-gate" className="text-center text-xl font-semibold text-heading">
            {t('co.gateTitle')}
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col rounded-2xl border border-accent/50 bg-accent/5 p-6">
              <p className="font-display text-lg font-semibold text-heading">
                {t('co.gateCustomer')}
              </p>
              <p className="mt-2 flex-1 text-sm text-muted">{t('co.gateCustomerNote')}</p>
              <Link
                href={`${base}/sign-in?next=${encodeURIComponent(`${base}/checkout`)}`}
                className="btn btn-primary mt-6 w-full"
              >
                {t('co.signInCheckout')}
              </Link>
            </div>
            <div className="flex flex-col rounded-2xl border border-line bg-paper-2/50 p-6">
              <p className="font-display text-lg font-semibold text-heading">{t('co.gateGuest')}</p>
              <p className="mt-2 flex-1 text-sm text-muted">{t('co.gateGuestNote')}</p>
              <Link href={`${base}/checkout?guest=1`} className="btn btn-secondary mt-6 w-full">
                {t('co.continueGuest')}
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          {!user && (
            <p className="mt-3 text-sm text-muted">
              <Link
                href={`${base}/sign-in?next=${encodeURIComponent(`${base}/checkout`)}`}
                className="text-accent underline"
              >
                {t('auth.signIn')}
              </Link>{' '}
              · {t('co.signInPrompt')}
            </p>
          )}

          <CheckoutForm
            locale={locale}
            signedIn={Boolean(user)}
            cardEnabled={stripeEnabled()}
            cardTestMode={stripeTestMode()}
            boxnow={
              boxnowStatus().checkout
                ? { widgetUrl: boxnowConfig().widgetUrl, partnerId: boxnowConfig().partnerId, cod: boxnowConfig().cod }
                : null
            }
            profile={profile}
            saved={saved.map((a) => ({
              id: a.id,
              label: a.label,
              recipientName: a.recipientName,
              phone: a.phone,
              line1: a.line1,
              line2: a.line2,
              city: a.city,
              postalCode: a.postalCode,
              country: a.country,
              isDefault: a.isDefault,
            }))}
            options={quotes.map((q) => ({
              id: q.optionId,
              kind: q.kind,
              carrier: q.carrier,
              name: tField(q.name, locale),
              priceCents: q.priceCents,
              minDays: q.minDays,
              maxDays: q.maxDays,
            }))}
            lines={view.lines.map((l) => ({
              variantId: l.variantId,
              name: tField(l.productName, locale),
              detail: [l.colorName ? tField(l.colorName, locale) : null, l.size]
                .filter(Boolean)
                .join(' · '),
              imageUrl: l.imageUrl,
              quantity: l.quantity,
              lineFinalCents: l.lineFinalCents,
            }))}
            totals={{
              listTotalCents: view.totals.listTotalCents,
              promotionDiscountCents: view.totals.promotionDiscountCents,
              promoCode: view.totals.promoCode?.code ?? null,
              promoCodeDiscountCents: view.totals.promoCodeDiscountCents,
              subtotalAfterDiscounts: afterDiscounts,
              vatRateBp: view.totals.vatRateBp,
              currency: view.totals.currency,
            }}
            pickupPlace={BRAND.contact.pickupName}
          />
        </>
      )}
    </div>
  )
}
