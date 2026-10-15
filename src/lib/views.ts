/* ============================================================================
 * PRODUCT VIEWS — spec sections 8 ("recently viewed") and 5 ("most viewed"
 * sort).
 *
 * The listing page already offered a "Most viewed" sort that read from
 * product_views, and nothing ever wrote to it, so the sort was decoration.
 * This is the write side.
 *
 * Recorded per viewer rather than per page load: one row per (viewer, product),
 * refreshed on a repeat visit. So "most viewed" counts PEOPLE, which cannot be
 * inflated by refreshing a page, and "recently viewed" needs no de-duplication
 * when it is read.
 *
 * Identity is whatever the visitor already has — their account, or the cart
 * token they were given when they first put something in their bag. Browsing
 * alone sets no new cookie: an anonymous view with no token still counts
 * towards popularity, it just cannot be replayed back to that person.
 * ========================================================================== */

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import { productImages, productViews, products } from '@/db/schema'
import { loadActivePromotions, resolvePrices } from './pricing'
import { tField } from '@/i18n/field'
import type { Locale } from '@/config/brand'

export type Viewer = { userId?: string | null; anonymousToken?: string | null }

/** Note that this viewer has looked at this product. Never throws: a failed
 *  analytics write must not break a product page. */
export async function recordProductView(productId: string, viewer: Viewer): Promise<void> {
  const userId = viewer.userId ?? null
  const anonymousToken = userId ? null : (viewer.anonymousToken ?? null)

  try {
    await db.transaction(async (tx) => {
      /* Replace this viewer's earlier view of the same product, so the table
         holds one row per viewer per product with the latest timestamp. */
      if (userId) {
        await tx
          .delete(productViews)
          .where(and(eq(productViews.productId, productId), eq(productViews.userId, userId)))
      } else if (anonymousToken) {
        await tx
          .delete(productViews)
          .where(
            and(
              eq(productViews.productId, productId),
              eq(productViews.anonymousToken, anonymousToken),
            ),
          )
      }

      await tx.insert(productViews).values({ productId, userId, anonymousToken })
    })
  } catch (err) {
    console.error('[views] could not record a product view', err)
  }
}

/** Hand a guest's view history to their account when they sign in, so
 *  "recently viewed" does not reset at the moment they log in. */
export async function mergeGuestViews(anonymousToken: string, userId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const guestRows = await tx
        .select({ productId: productViews.productId, viewedAt: productViews.viewedAt })
        .from(productViews)
        .where(eq(productViews.anonymousToken, anonymousToken))

      for (const row of guestRows) {
        /* The account's own row wins if it is newer; either way there is one. */
        await tx
          .delete(productViews)
          .where(and(eq(productViews.productId, row.productId), eq(productViews.userId, userId)))
        await tx.insert(productViews).values({
          productId: row.productId,
          userId,
          anonymousToken: null,
          viewedAt: row.viewedAt,
        })
      }

      await tx.delete(productViews).where(eq(productViews.anonymousToken, anonymousToken))
    })
  } catch (err) {
    console.error('[views] could not merge guest views', err)
  }
}

export type RecentlyViewedCard = {
  id: string
  slug: string
  name: string
  imageUrl: string | null
  listCents: number
  finalCents: number
  discountPercent: number
}

/**
 * The viewer's last few products, newest first, excluding the one they are
 * looking at now. Priced through the same resolver as everything else, so a
 * promotion shows here too.
 */
export async function getRecentlyViewed(
  viewer: Viewer,
  opts: { locale: Locale; excludeProductId?: string; limit?: number },
): Promise<RecentlyViewedCard[]> {
  const userId = viewer.userId ?? null
  const anonymousToken = userId ? null : (viewer.anonymousToken ?? null)
  if (!userId && !anonymousToken) return []

  const identity = userId
    ? eq(productViews.userId, userId)
    : and(eq(productViews.anonymousToken, anonymousToken!), isNotNull(productViews.anonymousToken))

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      categoryId: products.categoryId,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      viewedAt: productViews.viewedAt,
    })
    .from(productViews)
    .innerJoin(products, eq(products.id, productViews.productId))
    .where(and(identity, eq(products.isActive, true)))
    .orderBy(desc(productViews.viewedAt))
    .limit((opts.limit ?? 4) + 1)

  const kept = rows.filter((r) => r.id !== opts.excludeProductId).slice(0, opts.limit ?? 4)
  return buildCards(kept, opts.locale)
}

/**
 * The same strip, built from ids the BROWSER remembers.
 *
 * A visitor who is only browsing has no account and no cart cookie, so the
 * server cannot know what they have looked at — and issuing a tracking cookie
 * for the sake of a four-item strip is not a trade worth making. The device
 * keeps the list, sends the ids, and gets back cards priced by the server.
 * Order is the caller's order, and ids that no longer exist simply drop out.
 */
export async function getProductCardsByIds(
  ids: string[],
  locale: Locale,
  limit = 4,
): Promise<RecentlyViewedCard[]> {
  const wanted = [...new Set(ids)].slice(0, 24)
  if (wanted.length === 0) return []

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      categoryId: products.categoryId,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
    })
    .from(products)
    .where(and(inArray(products.id, wanted), eq(products.isActive, true)))

  /* Restore the caller's order — SQL returns whatever order it likes. */
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = wanted.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => !!r)

  return buildCards(ordered.slice(0, limit), locale)
}

/* Shared tail: one image and one resolved price per product. */
async function buildCards(
  kept: {
    id: string
    slug: string
    name: Record<string, string>
    categoryId: string
    priceCents: number
    salePriceCents: number | null
  }[],
  locale: Locale,
): Promise<RecentlyViewedCard[]> {
  if (kept.length === 0) return []

  const [promos, images] = await Promise.all([
    loadActivePromotions(),
    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, kept.map((k) => k.id)))
      .orderBy(productImages.position),
  ])

  const firstImage = new Map<string, string>()
  for (const img of images) if (!firstImage.has(img.productId)) firstImage.set(img.productId, img.url)

  /* Price at product level: this strip shows a "from" price, not a variant. */
  const prices = await resolvePrices(
    kept.map((k) => ({
      productId: k.id,
      categoryId: k.categoryId,
      variantId: k.id,
      listCents: k.priceCents,
      saleCents: k.salePriceCents,
    })),
    promos,
  )

  return kept.map((k) => {
    const price = prices.get(k.id)
    return {
      id: k.id,
      slug: k.slug,
      name: tField(k.name, locale),
      imageUrl: firstImage.get(k.id) ?? null,
      listCents: price?.listCents ?? k.priceCents,
      finalCents: price?.finalCents ?? k.priceCents,
      discountPercent: price?.discountPercent ?? 0,
    }
  })
}
