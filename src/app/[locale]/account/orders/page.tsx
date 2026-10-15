import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { listOrdersForUser } from '@/lib/orders'
import { OrderList } from '@/components/account/OrderList'
import { button } from '@/components/ui'

export const metadata: Metadata = { title: 'Orders', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const list = await listOrdersForUser(user.id)
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('acc.orders')}</h1>
      <p className="mt-1 text-sm text-muted">{t('acc.orderCount', { n: list.length })}</p>
      <div className="mt-6">
        {list.length ? (
          <OrderList orders={list} locale={locale} />
        ) : (
          <div className="border border-dashed border-line px-6 py-12 text-center">
            <p className="text-sm text-muted">{t('acc.noOrders')}</p>
            <Link href={`/${locale}`} className={`${button.primary} mt-5`}>
              {t('acc.noOrdersCta')}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
