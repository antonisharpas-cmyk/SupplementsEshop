import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { getOrderForUser, syncCheckoutSession } from '@/lib/orders'
import { stripeEnabled } from '@/lib/stripe'
import { OrderView } from '@/components/account/OrderView'
import { OrderBanner } from '@/components/account/OrderBanner'

export const metadata: Metadata = { title: 'Order', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AccountOrderPage({
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
  const user = (await getCurrentUser())!

  let paidNow = false
  if (sp.session_id && stripeEnabled()) {
    paidNow = (await syncCheckoutSession(sp.session_id).catch(() => 'unknown')) === 'paid'
  }
  const order = await getOrderForUser(number, user.id)

  return (
    <div>
      <Link href={`/${locale}/account/orders`} className="text-sm text-muted hover:text-ink">
        ← {t('ord.back')}
      </Link>
      <div className="mt-5">
        {order ? (
          <>
            <OrderBanner locale={locale} sp={sp} order={order} paidNow={paidNow} />
            <OrderView order={order} locale={locale} canReorder />
          </>
        ) : (
          <p className="text-muted">{t('ord.notFound')}</p>
        )}
      </div>
    </div>
  )
}
