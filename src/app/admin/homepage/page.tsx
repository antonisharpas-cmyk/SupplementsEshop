/* ============================================================================
 * Admin: the homepage.
 *
 * Everything under the hero, arranged by drag and drop: the order of the
 * sections, whether each shows, and — per section — either the shop's own
 * automatic choice or a hand-picked list in the owner's order.
 * ========================================================================== */

import { guardAdmin, listPickerProducts } from '@/lib/admin'
import { assertSchemaReady } from '@/db/ready'
import { getCategoryTree } from '@/lib/catalog'
import { getAllSectionItemIds, getHomepageLayout, SECTION_LIMITS, AUTO_COUNTS } from '@/lib/homepage'
import { allTiles, getHomepageContent } from '@/lib/homepage-content'
import { PageHead } from '@/components/admin/ui'
import { HomepageEditor, type PickerCategory } from '@/components/admin/HomepageEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Homepage' }

export default async function AdminHomepagePage() {
  await guardAdmin('/admin/homepage')
  /* A page renders in parallel with its layout, so it waits here too. */
  await assertSchemaReady()

  const [layout, picked, products, tree, auto] = await Promise.all([
    getHomepageLayout(),
    getAllSectionItemIds(),
    listPickerProducts(),
    getCategoryTree(),
    getHomepageContent('en', { forceAuto: true }),
  ])

  const categories: PickerCategory[] = allTiles(tree).map(({ root, child }) => ({
    id: child.id,
    name: child.name.en ?? child.slug,
    department: root.name.en ?? root.slug,
    image: child.imageUrl,
  }))

  return (
    <>
      <PageHead
        title="Homepage"
        sub="Drag to arrange what customers see under the hero. Every change is live as soon as it saves."
        action={
          <a
            href="/en"
            target="_blank"
            rel="noreferrer"
            className="label border border-line bg-paper px-4 py-2.5 text-muted transition hover:border-ink hover:text-ink"
          >
            Open the homepage ↗
          </a>
        }
      />
      <HomepageEditor
        initialLayout={layout}
        initialItems={picked}
        products={products}
        categories={categories}
        autoIds={{
          categories: auto.tiles.map((t) => t.child.id),
          trending: auto.trending.map((p) => p.id),
          new_in: auto.newIn.map((p) => p.id),
          on_sale: auto.onSale.map((p) => p.id),
        }}
        limits={SECTION_LIMITS}
        autoCounts={AUTO_COUNTS}
      />
    </>
  )
}
