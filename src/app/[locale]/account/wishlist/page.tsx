import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { wishlistProductIds } from '@/lib/wishlist'
import { listProductsByIds } from '@/lib/catalog'
import { ProductCard } from '@/components/ProductCard'
import { button } from '@/components/ui'

export const metadata: Metadata = { title: 'Wishlist', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function WishlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const ids = await wishlistProductIds(user.id)
  const items = ids.length ? await listProductsByIds(ids) : []

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('acc.wishlist')}</h1>
      {items.length === 0 ? (
        <div className="mt-6 border border-dashed border-line px-6 py-12 text-center">
          <p className="text-sm text-muted">{t('acc.noWishlist')}</p>
          <Link href={`/${locale}`} className={`${button.primary} mt-5`}>
            {t('acc.noOrdersCta')}
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} locale={locale} />
          ))}
        </div>
      )}
    </div>
  )
}
