/* ============================================================================
 * What each homepage section actually contains, right now.
 *
 * One function answers it for both sides: the storefront renders it, and the
 * admin panel shows it as the "this is what AUTO would show" preview — and
 * uses it as the starting list when the owner switches a section to MANUAL,
 * so they begin from what customers currently see instead of an empty box.
 * ========================================================================== */

import type { Locale } from '@/config/brand'
import { getCategoryTree, listProducts, listProductsByIds, type ProductCard } from '@/lib/catalog'
import {
  AUTO_COUNTS,
  AUTO_TILES_PER_DEPARTMENT,
  getAllSectionItemIds,
  getHomepageLayout,
  type SectionConfig,
  type SectionKey,
} from '@/lib/homepage'

type Tree = Awaited<ReturnType<typeof getCategoryTree>>
export type CategoryTile = { root: Tree[number]; child: Tree[number]['children'][number] }

export type HomepageContent = {
  layout: SectionConfig[]
  tiles: CategoryTile[]
  trending: ProductCard[]
  newIn: ProductCard[]
  onSale: ProductCard[]
}

/** Every subcategory, as a tile, in menu order. */
export function allTiles(tree: Tree): CategoryTile[] {
  return tree.flatMap((root) => root.children.map((child) => ({ root, child })))
}

/** AUTO for the category section: the first four of each department. */
function autoTiles(tree: Tree): CategoryTile[] {
  return tree.flatMap((root) =>
    root.children.slice(0, AUTO_TILES_PER_DEPARTMENT).map((child) => ({ root, child })),
  )
}

async function autoProducts(key: Exclude<SectionKey, 'categories'>, locale: Locale) {
  const page = 1
  if (key === 'trending') {
    return (await listProducts({ sort: 'popular', page, perPage: AUTO_COUNTS.trending, locale })).items
  }
  if (key === 'new_in') {
    return (await listProducts({ sort: 'newest', page, perPage: AUTO_COUNTS.new_in, locale })).items
  }
  return (
    await listProducts({ sort: 'newest', page, perPage: AUTO_COUNTS.on_sale, onSale: true, locale })
  ).items
}

/**
 * @param opts.onlyVisible  the storefront skips hidden sections' queries;
 *                          the admin wants every section filled in.
 * @param opts.forceAuto    return what AUTO would show regardless of mode.
 */
export async function getHomepageContent(
  locale: Locale,
  opts: { onlyVisible?: boolean; forceAuto?: boolean } = {},
): Promise<HomepageContent> {
  const [layout, picked, tree] = await Promise.all([
    getHomepageLayout(),
    getAllSectionItemIds(),
    getCategoryTree(),
  ])
  const config = Object.fromEntries(layout.map((s) => [s.key, s])) as Record<SectionKey, SectionConfig>
  const wanted = (key: SectionKey) => !opts.onlyVisible || config[key].isVisible
  const manual = (key: SectionKey) => !opts.forceAuto && config[key].mode === 'manual'

  const tilesById = new Map(allTiles(tree).map((t) => [t.child.id, t]))
  const tiles = !wanted('categories')
    ? []
    : manual('categories')
      ? picked.categories.map((id) => tilesById.get(id)).filter((t): t is CategoryTile => Boolean(t))
      : autoTiles(tree)

  const products = async (key: Exclude<SectionKey, 'categories'>) => {
    if (!wanted(key)) return []
    if (!manual(key)) return autoProducts(key, locale)
    return listProductsByIds(picked[key], { onSaleOnly: key === 'on_sale' })
  }

  const [trending, newIn, onSale] = await Promise.all([
    products('trending'),
    products('new_in'),
    products('on_sale'),
  ])

  return { layout, tiles, trending, newIn, onSale }
}
