/* The members area overview: a hello, the numbers, the latest orders. */

import Link from 'next/link'
import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { listOrdersForUser } from '@/lib/orders'
import { wishlistProductIds } from '@/lib/wishlist'
import { formatMoney } from '@/lib/pricing'
import { OrderList } from '@/components/account/OrderList'
import { formatDate } from '@/components/account/OrderView'
import { button } from '@/components/ui'

export const metadata: Metadata = { title: 'Account', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const PAID = new Set(['PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'])

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const [orderList, saved, [u]] = await Promise.all([
    listOrdersForUser(user.id),
    wishlistProductIds(user.id),
    db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, user.id)),
  ])
  const spent = orderList.filter((o) => PAID.has(o.status)).reduce((s, o) => s + o.totalCents, 0)
  const base = `/${locale}/account`

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('acc.hello', { name: user.firstName })}</h1>
      {u && <p className="mt-1 text-sm text-muted">{t('acc.memberSince', { date: formatDate(u.createdAt, locale) })}</p>}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Link href={`${base}/orders`} className="border border-line bg-paper-2 p-5 transition-colors hover:border-accent">
          <p className="label text-muted">{t('acc.orders')}</p>
          <p className="mt-2 text-2xl font-semibold text-heading">{orderList.length}</p>
        </Link>
        <div className="border border-line bg-paper-2 p-5">
          <p className="label text-muted">{t('acc.totalSpent')}</p>
          <p className="mt-2 text-2xl font-semibold text-heading">{formatMoney(spent, locale)}</p>
        </div>
        <Link href={`${base}/wishlist`} className="border border-line bg-paper-2 p-5 transition-colors hover:border-accent">
          <p className="label text-muted">{t('acc.wishlist')}</p>
          <p className="mt-2 text-2xl font-semibold text-heading">{saved.length}</p>
        </Link>
      </div>

      <div className="mt-10 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">{t('acc.recentOrders')}</h2>
        {orderList.length > 3 && (
          <Link href={`${base}/orders`} className="label text-muted hover:text-ink">
            {t('acc.viewAll')}
          </Link>
        )}
      </div>
      {orderList.length ? (
        <div className="mt-4">
          <OrderList orders={orderList.slice(0, 3)} locale={locale} />
        </div>
      ) : (
        <div className="mt-4 border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-muted">{t('acc.noOrders')}</p>
          <Link href={`/${locale}`} className={`${button.primary} mt-5`}>
            {t('acc.noOrdersCta')}
          </Link>
        </div>
      )}
    </div>
  )
}
