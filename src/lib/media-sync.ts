/* ============================================================================
 * Point the database at whatever pictures are in /public — without touching
 * anything else. Shared by `npm run media:sync`, `npm run dev`, and the
 * development-only self-heal in src/db/ready.ts.
 *
 * Only URLs this manages are rewritten:
 *   · product images named after their product (/products/<slug>…)
 *   · category tiles (/products/category-…)
 *   · the hero, where it still shows the generated placeholder or /hero/ files
 * A URL the shop owner has set to anything else is left exactly as it is.
 * ========================================================================== */

import { and, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '@/db'
import { categories, heroBanners, productImages, products } from '@/db/schema'
import {
  CATALOGUE_ART,
  artUrl,
  categoryArtUrl,
  heroArtUrl,
  heroVideoUrl,
} from '../../scripts/art-manifest'

/** Returns how many links it changed. Idempotent: a second run changes none. */
export async function syncMedia(db: Db): Promise<number> {
  let changed = 0

  /* --- products: position 0 is the front, 1 the back --- */
  for (const { slug } of CATALOGUE_ART) {
    const [product] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug))
    if (!product) continue

    const images = await db
      .select({ id: productImages.id, url: productImages.url })
      .from(productImages)
      .where(eq(productImages.productId, product.id))

    for (const image of images) {
      if (!image.url.startsWith(`/products/${slug}`)) continue
      /* Front or back by the file's own name, never by position: the owner
         may have dragged the back photo first, and that order is theirs. */
      const isBack = image.url.startsWith(`/products/${slug}-back`)
      const want = artUrl(slug, isBack)
      if (image.url !== want) {
        await db.update(productImages).set({ url: want }).where(eq(productImages.id, image.id))
        changed++
      }
    }
  }

  /* --- category tiles --- */
  const all = await db
    .select({ id: categories.id, slug: categories.slug, parentId: categories.parentId, imageUrl: categories.imageUrl })
    .from(categories)
  const slugOf = new Map(all.map((c) => [c.id, c.slug]))
  for (const c of all) {
    if (!c.parentId || !c.imageUrl?.startsWith('/products/category-')) continue
    const want = categoryArtUrl(`${slugOf.get(c.parentId)}-${c.slug}`)
    if (c.imageUrl !== want) {
      await db.update(categories).set({ imageUrl: want }).where(eq(categories.id, c.id))
      changed++
    }
  }

  /* --- the hero --- */
  const managed = (url: string | null) => !url || url.startsWith('data:') || url.startsWith('/hero/')
  const banners = await db
    .select()
    .from(heroBanners)
    .where(and(eq(heroBanners.isActive, true), isNotNull(heroBanners.id)))
  for (const b of banners) {
    const next: Partial<typeof heroBanners.$inferInsert> = {}
    const image = heroArtUrl('hero')
    const mobileImage = heroArtUrl('hero-mobile')
    if (image && managed(b.imageUrl) && b.imageUrl !== image) next.imageUrl = image
    if (mobileImage && managed(b.mobileImageUrl) && b.mobileImageUrl !== mobileImage)
      next.mobileImageUrl = mobileImage
    if (managed(b.videoUrl) && b.videoUrl !== heroVideoUrl('hero')) next.videoUrl = heroVideoUrl('hero')
    if (managed(b.mobileVideoUrl) && b.mobileVideoUrl !== heroVideoUrl('hero-mobile'))
      next.mobileVideoUrl = heroVideoUrl('hero-mobile')

    if (Object.keys(next).length) {
      await db.update(heroBanners).set(next).where(eq(heroBanners.id, b.id))
      changed += Object.keys(next).length
    }
  }

  return changed
}
