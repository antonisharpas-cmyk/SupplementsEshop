'use client'

/* "Recently viewed" strip.
 *
 * Client-side because it is per-visitor: fetching it here keeps the product
 * page itself cacheable for everyone. Renders nothing at all until there is
 * something to show, so a first-time visitor sees no empty heading.
 *
 * Prices come from the server already resolved — this component never computes
 * a discount. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { readRecentProducts } from '@/lib/recent-store'

type Card = {
  id: string
  slug: string
  name: string
  imageUrl: string | null
  listCents: number
  finalCents: number
  discountPercent: number
}

export function RecentlyViewed({
  locale,
  excludeProductId,
}: {
  locale: Locale
  excludeProductId?: string
}) {
  const t = getTranslator(locale)
  const [items, setItems] = useState<Card[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const params = new URLSearchParams({ locale })
      if (excludeProductId) params.set('exclude', excludeProductId)

      try {
        /* First the server's own history — a signed-in customer should see the
           same strip on their phone as on their laptop. */
        const res = await fetch(`/api/products/recently-viewed?${params}`)
        const data = (await res.json()) as { items?: Card[] }
        if (cancelled) return
        if (data.items?.length) {
          setItems(data.items)
          return
        }

        /* Otherwise this device's own list, priced by the server. */
        const ids = readRecentProducts()
        if (ids.length === 0) return

        const byIds = await fetch('/api/products/recently-viewed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, exclude: excludeProductId, locale }),
        })
        const local = (await byIds.json()) as { items?: Card[] }
        if (!cancelled) setItems(local.items ?? [])
      } catch {
        /* No strip. Never an error on a product page. */
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [locale, excludeProductId])

  if (items.length === 0) return null

  const money = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(c / 100)

  return (
    <section className="mt-20">
      <h2 className="mb-5 text-lg font-semibold tracking-tight">{t('pdp.recentlyViewed')}</h2>
      <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4">
        {items.map((item) => (
          <Link key={item.id} href={`/${locale}/products/${item.slug}`} className="group block">
            <div className="relative aspect-4/5 overflow-hidden bg-paper-2">
              {item.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.imageUrl}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              )}
            </div>
            <p className="mt-2.5 text-sm">{item.name}</p>
            <p className="mt-1 text-sm">
              {item.discountPercent > 0 ? (
                <>
                  <span className="font-medium text-sale">{money(item.finalCents)}</span>
                  <span className="ml-2 text-xs text-muted line-through">
                    {money(item.listCents)}
                  </span>
                </>
              ) : (
                money(item.finalCents)
              )}
            </p>
          </Link>
        ))}
      </div>
    </section>
  )
}
