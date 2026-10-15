/* ============================================================================
 * The members area: one frame for every account page, with the sections down
 * the side (across the top on a phone). Signed-out visitors are sent to sign
 * in and brought back to the page they wanted.
 * ========================================================================== */

import { redirect } from 'next/navigation'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { AccountNav } from '@/components/account/AccountNav'
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

  const items = [
    { href: base, label: t('acc.overview'), exact: true },
    { href: `${base}/orders`, label: t('acc.orders') },
    { href: `${base}/payments`, label: t('acc.payments') },
    { href: `${base}/wishlist`, label: t('acc.wishlist') },
    { href: `${base}/addresses`, label: t('acc.addresses') },
    { href: `${base}/profile`, label: t('acc.profile') },
  ]

  return (
    <div className="container-x py-10">
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <p className="hidden text-sm text-muted lg:block">{user.email}</p>
          <div className="mt-0 lg:mt-5">
            <AccountNav items={items} />
          </div>
          <div className="mt-6 hidden lg:block">
            <SignOutButton locale={locale} />
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
