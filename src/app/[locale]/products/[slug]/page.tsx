/* ============================================================================
 * Product detail page — spec section 7, plus the SEO requirements of section 36.
 *
 * Server-rendered with Product structured data, so Google can read the price
 * and availability without executing JavaScript. That is the whole reason this
 * project is Next.js rather than a client-rendered SPA.
 * ========================================================================== */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getProductBySlug, getRelatedProducts, t as tr } from '@/lib/catalog'
import { formatMoney } from '@/lib/pricing'
import { getSetting } from '@/lib/settings'
import { AddToBag } from '@/components/AddToBag'
import { WishlistButton } from '@/components/WishlistButton'
import { getCurrentUser } from '@/lib/auth/session'
import { isInWishlist } from '@/lib/wishlist'
import { ProductCard } from '@/components/ProductCard'
import { RecentlyViewed } from '@/components/RecentlyViewed'
import { TrackView } from '@/components/TrackView'
import { Badge, Price, ProductImage, SectionHead } from '@/components/ui'

type Props = { params: Promise<{ locale: string; slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, slug } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const product = await getProductBySlug(slug)
  if (!product) return { title: 'Not found' }

  const name = tr(product.name, locale)
  const description =
    tr(product.seoDescription, locale) ||
    tr(product.summary, locale) ||
    tr(product.description, locale).slice(0, 160)

  return {
    title: tr(product.seoTitle, locale) || name,
    description,
    alternates: { canonical: `/${locale}/products/${slug}` },
    openGraph: {
      title: name,
      description,
      type: 'website',
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const { locale: raw, slug } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)

  const product = await getProductBySlug(slug)
  if (!product) notFound()

  const user = await getCurrentUser()
  const saved = user ? await isInWishlist(user.id, product.id) : false
  const [related, threshold, ttlSeconds] = await Promise.all([
    getRelatedProducts(product.id, product.category.id, 4),
    getSetting('free_delivery_threshold_cents'),
    getSetting('reservation_ttl_seconds'),
  ])

  const base = `/${locale}`
  const categoryHref = product.category.parentSlug
    ? `${base}/${product.category.parentSlug}/${product.category.slug}`
    : `${base}/${product.category.slug}`

  /* Section 36: structured data so the product can appear as a rich result. */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: tr(product.name, locale),
    description: tr(product.description, locale) || tr(product.summary, locale),
    sku: product.variants[0]?.sku,
    brand: { '@type': 'Brand', name: BRAND.name },
    image: product.images.map((i) => i.url),
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: product.currency,
      lowPrice: (Math.min(...product.variants.map((v) => v.finalCents)) / 100).toFixed(2),
      highPrice: (Math.max(...product.variants.map((v) => v.finalCents)) / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: !product.soldOut
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  }

  return (
    <div className="container-x py-8">
      <script
        type="application/ld+json"
        /* Serialised server-side from our own database, never from user input. */
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav aria-label="Breadcrumb" className="mb-5 flex flex-wrap gap-2 text-xs text-muted">
        <Link href={base} className="hover:underline">
          {BRAND.name}
        </Link>
        <span aria-hidden>/</span>
        {product.category.parentSlug && (
          <>
            <Link href={`${base}/${product.category.parentSlug}`} className="hover:underline">
              {product.category.parentName
                ? tr(product.category.parentName, locale)
                : product.category.parentSlug}
            </Link>
            <span aria-hidden>/</span>
          </>
        )}
        <Link href={categoryHref} className="hover:underline">
          {tr(product.category.name, locale)}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">{tr(product.name, locale)}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* ------------------------------------------------------ gallery -- */}
        <div className="grid gap-2 sm:grid-cols-2">
          {product.images.map((image, i) => (
            <ProductImage
              key={image.url + i}
              src={image.url}
              alt={tr(image.alt, locale) || tr(product.name, locale)}
              priority={i === 0}
              className={product.images.length === 1 ? 'sm:col-span-2' : ''}
            />
          ))}
        </div>

        {/* -------------------------------------------------------- panel -- */}
        <div className="lg:sticky lg:top-28 lg:self-start">
          {product.discountPercent > 0 && (
            <div className="mb-3">
              <Badge tone="sale">{t('card.saleBadge', { percent: product.discountPercent })}</Badge>
            </div>
          )}

          <h1 className="text-[clamp(1.5rem,3.4vw,2.2rem)] leading-tight font-semibold tracking-tight">
            {tr(product.name, locale)}
          </h1>

          {product.summary && (
            <p className="mt-2 text-sm text-muted">{tr(product.summary, locale)}</p>
          )}

          <div className="mt-4">
            <Price
              listCents={product.listCents}
              finalCents={product.finalCents}
              locale={locale}
              currency={product.currency}
              size="lg"
            />
          </div>

          <div className="mt-8">
            <AddToBag
              locale={locale}
              variants={product.variants}
              reservationMinutes={Math.round(ttlSeconds / 60)}
              soldOut={product.soldOut}
            />
            <div className="mt-4">
              <WishlistButton locale={locale} productId={product.id} initial={saved} signedIn={Boolean(user)} />
            </div>
          </div>

          {/* details */}
          {product.description && (
            <section className="mt-10 border-t border-line pt-6">
              <h2 className="label mb-3">{t('pdp.description')}</h2>
              <p className="text-sm leading-relaxed text-ink-soft">
                {tr(product.description, locale)}
              </p>
            </section>
          )}

          {product.sizeGuide && (
            <details className="mt-6 border-t border-line pt-6">
              <summary className="label cursor-pointer">{t('pdp.sizeGuide')}</summary>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                {tr(product.sizeGuide, locale)}
              </p>
            </details>
          )}

          <section className="mt-6 border-t border-line pt-6">
            <h2 className="label mb-3">{t('pdp.delivery')}</h2>
            <p className="text-sm text-ink-soft">
              {t('pdp.deliveryBody', { threshold: formatMoney(threshold, locale) })}
            </p>
          </section>
        </div>
      </div>

      {/* Counts this visit, so the "Most viewed" sort reflects real traffic. */}
      <TrackView productId={product.id} />

      {/* ------------------------------------------------------- related -- */}
      {related.length > 0 && (
        <section className="mt-20">
          <SectionHead title={t('pdp.related')} />
          <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} locale={locale} />
            ))}
          </div>
        </section>
      )}

      {/* Per-visitor, so it loads client-side and this page stays cacheable. */}
      <RecentlyViewed locale={locale} excludeProductId={product.id} />
    </div>
  )
}
