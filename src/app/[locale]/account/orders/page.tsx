import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { listOrdersForUser } from '@/lib/orders'
import { CURRENT_STATUSES, OrderList } from '@/components/account/OrderList'
import { button } from '@/components/ui'

export const metadata: Metadata = { title: 'Orders', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const list = await listOrdersForUser(user.id)
  const current = list.filter((o) => CURRENT_STATUSES.includes(o.status))
  const past = list.filter((o) => !CURRENT_STATUSES.includes(o.status))
  return (
    <div className="space-y-12">
      {list.length === 0 ? (
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">{t('acc.orders')}</h1>
          <div className="mt-6 rounded-2xl border border-dashed border-line px-6 py-14 text-center">
            <p className="text-sm text-muted">{t('acc.noOrders')}</p>
            <Link href={`/${locale}`} className={`${button.primary} mt-5`}>
              {t('acc.noOrdersCta')}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{t('acc.currentOrders')}</h1>
              <span className="text-sm text-muted">{t('acc.currentNote')}</span>
            </div>
            <div className="mt-5">
              {current.length ? (
                <OrderList orders={current} locale={locale} />
              ) : (
                <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted">{t('acc.noCurrent')}</p>
              )}
            </div>
          </section>
          <section>
            <h2 className="text-xl font-semibold tracking-tight">{t('acc.pastOrders')}</h2>
            <div className="mt-5">
              {past.length ? (
                <OrderList orders={past} locale={locale} />
              ) : (
                <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted">{t('acc.noPast')}</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
