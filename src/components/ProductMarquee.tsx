'use client'

/* ============================================================================
 * A moving strip of products for the homepage.
 *
 * How it moves: the list is rendered TWICE and the track is translated by
 * exactly half its width, so the moment the first copy has scrolled past, the
 * second copy is in precisely the position the first started from and the loop
 * restarts invisibly. No JavaScript runs per frame — it is one CSS animation,
 * which the browser can hand to the compositor.
 *
 * How it stops:
 *   · hover, so a customer can read a card they are interested in
 *   · keyboard focus, so a tab-stop cannot be dragged out from under someone
 *   · prefers-reduced-motion, where it does not animate at all and becomes an
 *     ordinary horizontally scrollable row — motion sickness is not a taste
 *     preference to override.
 *
 * The duplicated copy is hidden from screen readers, which would otherwise
 * read the whole catalogue twice.
 * ========================================================================== */

import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { tField as tr } from '@/i18n/field'
import type { ProductCard } from '@/lib/catalog'
import { getTranslator } from '@/i18n/messages'
import { CardHeart } from '@/components/WishlistProvider'

export function ProductMarquee({
  products,
  locale,
  seconds = 46,
  reverse = false,
}: {
  products: ProductCard[]
  locale: Locale
  /** One full pass. Longer is calmer; this is a shop, not a slot machine. */
  seconds?: number
  reverse?: boolean
}) {
  if (products.length === 0) return null
  const soldOutLabel = getTranslator(locale)('card.soldOut')

  const money = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(c / 100)

  const card = (product: ProductCard, copy: number) => (
    <li
      key={`${copy}-${product.id}`}
      className="w-[210px] shrink-0 sm:w-[250px]"
      /* The second copy exists only to make the loop seamless. */
      aria-hidden={copy === 1 ? true : undefined}
    >
      <Link
        href={`/${locale}/products/${product.slug}`}
        tabIndex={copy === 1 ? -1 : undefined}
        className="group block"
      >
        <div className="relative aspect-4/5 overflow-hidden bg-paper-2">
          {product.images[0] && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={product.images[0].url}
              alt={tr(product.images[0].alt, locale) || tr(product.name, locale)}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
            />
          )}
          {product.discountPercent > 0 && !product.soldOut && (
            <span className="absolute left-0 top-0 bg-sale px-2.5 py-1 label text-white">
              −{product.discountPercent}%
            </span>
          )}
          {product.soldOut && (
            <span className="absolute inset-x-0 bottom-0 bg-paper/85 py-1.5 text-center label backdrop-blur-sm">
              {soldOutLabel}
            </span>
          )}
        </div>
      </Link>
      <div className="mt-2.5 flex items-start justify-between gap-2">
        <Link href={`/${locale}/products/${product.slug}`} tabIndex={copy === 1 ? -1 : undefined} className="min-w-0 flex-1">
          <p className="truncate text-sm">{tr(product.name, locale)}</p>
          <p className="mt-0.5 text-sm">
            {product.discountPercent > 0 ? (
              <>
                <span className="font-medium text-sale">{money(product.finalCents)}</span>
                <span className="ml-2 text-xs text-muted line-through">{money(product.listCents)}</span>
              </>
            ) : (
              money(product.finalCents)
            )}
          </p>
        </Link>
        <CardHeart productId={product.id} tabIndex={copy === 1 ? -1 : undefined} />
      </div>
    </li>
  )

  return (
    <div className="marquee group/marquee relative overflow-hidden">
      {/* The strip fades out at both edges rather than being chopped off. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-paper to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-paper to-transparent" />

      <ul
        className="marquee-track flex gap-3"
        style={
          {
            '--marquee-duration': `${seconds}s`,
            '--marquee-direction': reverse ? 'reverse' : 'normal',
          } as React.CSSProperties
        }
      >
        {products.map((p) => card(p, 0))}
        {products.map((p) => card(p, 1))}
      </ul>
    </div>
  )
}
