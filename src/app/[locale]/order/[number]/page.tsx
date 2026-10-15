/* ============================================================================
 * A guest's order, opened from the confirmation or an email link. The link
 * carries the order's secret (?t=…); without it, or with a wrong one, the
 * order does not exist as far as this page is concerned.
 *
 * Stripe also returns here after a card payment (?session_id=…). The payment
 * is checked with Stripe directly, so the order shows as paid even before (or
 * without) the webhook.
 * ========================================================================== */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { getOrderByToken, syncCheckoutSession } from '@/lib/orders'
import { stripeEnabled } from '@/lib/stripe'
import { OrderView } from '@/components/account/OrderView'
import { OrderBanner } from '@/components/account/OrderBanner'
import { button } from '@/components/ui'

export const metadata: Metadata = { title: 'Your order', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function GuestOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; number: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { locale: raw, number } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const token = sp.t ?? ''

  let paidNow = false
  if (sp.session_id && stripeEnabled()) {
    paidNow = (await syncCheckoutSession(sp.session_id).catch(() => 'unknown')) === 'paid'
  }

  const order = await getOrderByToken(number, token)
  if (!order) {
    return (
      <div className="container-x py-24 text-center">
        <h1 className="text-2xl font-semibold">{t('ord.notFound')}</h1>
        <Link href={`/${locale}`} className={`${button.secondary} mt-6`}>
          {t('cart.continueShopping')}
        </Link>
      </div>
    )
  }

  /* An order placed while signed in belongs in the account. */
  const user = await getCurrentUser()
  if (user && order.userId === user.id) {
    const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== 't' && v) as [string, string][]).toString()
    redirect(`/${locale}/account/orders/${order.orderNumber}${qs ? `?${qs}` : ''}`)
  }

  return (
    <div className="container-x py-10">
      <OrderBanner locale={locale} sp={sp} order={order} paidNow={paidNow} />
      <OrderView order={order} locale={locale} token={token} canReorder={false} />
      {!order.userId && (
        <p className="mt-10 border border-line bg-paper-2 px-5 py-4 text-sm text-ink-soft">
          {t('ord.createAccount')}{' '}
          <Link href={`/${locale}/register`} className="text-accent underline">
            {t('auth.createAccount')}
          </Link>
        </p>
      )}
    </div>
  )
}
