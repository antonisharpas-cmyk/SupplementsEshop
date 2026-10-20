/* ============================================================================
 * The members area: one frame for every account page, with the sections down
 * the side (across the top on a phone). Signed-out visitors are sent to sign
 * in and brought back to the page they wanted.
 * ========================================================================== */

import { redirect } from 'next/navigation'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { listOrdersForUser } from '@/lib/orders'
import { AccountNav, type AccountNavItem } from '@/components/account/AccountNav'
import { formatDate } from '@/components/account/OrderView'
import { CURRENT_STATUSES } from '@/components/account/OrderList'
import { SignOutButton } from '@/components/auth/SignOutButton'

export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const base = `/${locale}/account`

  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/sign-in?next=${encodeURIComponent(base)}`)
  /* Admin accounts (owners, support) do not shop: their account is in the admin. */
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') redirect('/admin')

  const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, user.id))
  const current = (await listOrdersForUser(user.id)).filter((o) => CURRENT_STATUSES.includes(o.status)).length

  const items: AccountNavItem[] = [
    { href: `${base}/orders`, label: t('acc.orders'), icon: 'orders', badge: current || undefined },
    { href: `${base}/payments`, label: t('acc.payments'), icon: 'payments' },
    { href: `${base}/wishlist`, label: t('acc.wishlist'), icon: 'wishlist' },
    { href: `${base}/addresses`, label: t('acc.addresses'), icon: 'addresses' },
    { href: `${base}/profile`, label: t('acc.profile'), icon: 'profile' },
  ]
  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || user.email[0].toUpperCase()

  return (
    <div className="container-x py-10">
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12">
        <aside className="min-w-0 lg:sticky lg:top-28 lg:self-start">
          <div className="lg:rounded-2xl lg:border lg:border-line lg:bg-paper-2 lg:p-4">
            <div className="mb-5 flex items-center gap-3 lg:px-1">
              <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gold text-sm font-bold text-black">
                {initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-base font-semibold text-heading">{t('acc.hello', { name: user.firstName })}</span>
                <span className="block truncate text-xs text-muted" title={user.email}>
                  {u ? t('acc.memberSince', { date: formatDate(u.createdAt, locale) }) : user.email}
                </span>
              </span>
            </div>
            <AccountNav items={items} />
            <div className="mt-4 hidden border-t border-line pt-4 lg:block lg:px-1">
              <SignOutButton locale={locale} />
            </div>
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
