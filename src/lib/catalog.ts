/* ============================================================================
 * CATALOGUE QUERIES — spec sections 4, 5, 6, 7.
 *
 * Categories are read from the database, never hardcoded (section 4), so the
 * navigation is whatever the admin has configured.
 *
 * The listing query does filtering, sorting and pagination in SQL rather than
 * in JavaScript. Fetching every product and filtering in memory works fine with
 * the 30 products in the seed and falls over at 3,000.
 * ========================================================================== */

import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import {
  categories,
  inventory,
  productImages,
  productVariants,
  products,
  type Category,
} from '@/db/schema'
import {
  effectivePriceSql,
  loadActivePromotions,
  resolvePrices,
  type EffectivePrice,
} from './pricing'
import { compareSizes, sortBySize, sortSizes } from './sizes'
import type { ProductQuery } from './validation'
import type { Locale } from '@/config/brand'

/* ------------------------------------------------------------ translation -- */

/* Re-exported for server components' convenience. The implementation lives in
   src/i18n/field.ts with no imports, so CLIENT components must import it from
   there, importing it from here would pull the `pg` driver into the browser
   bundle. */
import { tField } from '@/i18n/field'
export { tField as t }

/* -------------------------------------------------------------- navigation -- */

/* Up to three levels: a range (Clothing), a group (Men) and a section
   (Socks). Products are filed under any level below the range. */
export type CategoryNode = Category & { children: CategoryNode[] }
export const MAX_CATEGORY_DEPTH = 3

/** The whole navigation tree in one query. Cached per request by Next. */
export async function getCategoryTree(includeInactive = false): Promise<CategoryNode[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(includeInactive ? undefined : eq(categories.isActive, true))
    .orderBy(asc(categories.position), asc(categories.slug))

  const build = (parentId: string | null, depth: number): CategoryNode[] =>
    depth > MAX_CATEGORY_DEPTH
      ? []
      : rows.filter((r) => r.parentId === parentId).map((r) => ({ ...r, children: build(r.id, depth + 1) }))
  return build(null, 1)
}

/** Every id in a node's branch, the node itself included. */
export function branchIds(node: CategoryNode): string[] {
  return [node.id, ...node.children.flatMap(branchIds)]
}

/** Find a node by its path of slugs: ['clothing', 'men', 'socks']. */
export function findByPath(tree: CategoryNode[], path: string[]): CategoryNode | null {
  let level = tree
  let found: CategoryNode | null = null
  for (const slug of path) {
    found = level.find((n) => n.slug === slug) ?? null
    if (!found) return null
    level = found.children
  }
  return found
}

/** The slug path of a category, from its range down: 'clothing/men/socks'. */
export async function categoryPath(id: string): Promise<string | null> {
  const rows = await db.select({ id: categories.id, parentId: categories.parentId, slug: categories.slug }).from(categories)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const parts: string[] = []
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard++ < 5) {
    parts.unshift(cur.slug)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return parts.length ? parts.join('/') : null
}

export async function getCategoryBySlug(
  slug: string,
  parentSlug?: string,
): Promise<Category | null> {
  if (parentSlug) {
    const [row] = await db
      .select({ child: categories })
      .from(categories)
      .innerJoin(
        sql`${categories} as parent`,
        sql`parent.id = ${categories.parentId} and parent.slug = ${parentSlug}`,
      )
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1)
    return row?.child ?? null
  }

  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.slug, slug), isNull(categories.parentId), eq(categories.isActive, true)))
    .limit(1)
  return row ?? null
}

/** A category plus its descendants, so /men lists everything under Men. */
async function categoryAndDescendants(categoryId: string): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    with recursive branch as (
      select id, 1 as depth from categories where id = ${categoryId}::uuid
      union all
      select c.id, b.depth + 1 from categories c join branch b on c.parent_id = b.id where b.depth < 5
    )
    select id from branch`)
  return rows.rows.map((r) => r.id)
}

/* ---------------------------------------------------------------- listing -- */

export type ProductCard = {
  id: string
  slug: string
  name: Record<string, string>
  summary: Record<string, string> | null
  categoryId: string
  images: { url: string; alt: Record<string, string> | null }[]
  listCents: number
  finalCents: number
  discountPercent: number
  isOnSale: boolean
  /** Sizes with stock, and all sizes, so a card can grey out sold-out sizes. */
  sizes: { size: string; variantId: string; available: number }[]
  /** Some size has stock on the shelf. */
  inStock: boolean
  /**
   * Cannot be bought right now — because nothing is on the shelf, or because
   * the owner has marked it sold out. The one flag the storefront shows.
   */
  soldOut: boolean
  createdAt: Date
}

export type ProductListing = {
  items: ProductCard[]
  total: number
  page: number
  perPage: number
  totalPages: number
  /** The options the filter panel offers — only ones that exist, each
   *  counted with every other filter applied. */
  facets: {
    sizes: { size: string; count: number }[]
    colours: { value: string; label: string; hex: string | null; count: number }[]
    /** Subcategories: within the department on a department page, grouped
     *  by department on pages that span them; none on a subcategory page. */
    categories: { value: string; label: string; count: number; group?: string }[]
    /** Only on pages that span departments. */
    departments: { value: string; label: string; count: number }[]
    /** What customers pay, lowest and highest, across the whole page —
     *  the category and search, before any filter. */
    priceRange: { minCents: number; maxCents: number }
  }
}

/*
 * The listing query, built as named groups of conditions:
 *
 *   base        always applies: live products, the page's category, search
 *   department  / categories / price / sale      product-level filters
 *   sizes / colours / stock                       VARIANT-level filters
 *
 * Within a group the choices are OR'd; groups are AND'd. The three variant
 * groups are checked against the SAME variant: "M + Black + in stock" means
 * a black M that is in stock — not a black S next to a grey M.
 *
 * Facets (the options the filter panel offers) list what exists on the page
 * (its category and search), each counted with every filter applied EXCEPT
 * its own group — so choosing "M" does not make L disappear, and an option
 * that would now show nothing is dimmed rather than removed. The price slider's range is the whole page's (category and
 * search only), so it stays put while other filters change instead of
 * shrinking — or vanishing — under the shopper's thumb.
 */

type Group = 'department' | 'categories' | 'price' | 'sale' | 'sizes' | 'colours' | 'stock'

/* The database's version of colourKey() in listing-filters.ts. */
const COLOUR_KEY_SQL = sql.raw(
  `trim(both '-' from regexp_replace(lower(trim(v.color_name->>'en')), '[^a-z0-9]+', '-', 'g'))`,
)

type Built = {
  base: SQL[]
  product: Partial<Record<'department' | 'categories' | 'price' | 'sale', SQL>>
  variant: Partial<Record<'sizes' | 'colours' | 'stock', SQL>>
  price: SQL
  scope: FacetScope
}

/** What kind of page this is decides which structural facets make sense. */
type FacetScope =
  | { kind: 'department'; department: Category }
  | { kind: 'subcategory' }
  | { kind: 'all'; department?: string }

async function buildListing(query: ProductQuery): Promise<Built | null> {
  const base: SQL[] = [sql`${products.isActive}`]
  const product: Built['product'] = {}
  const variant: Built['variant'] = {}
  let scope: FacetScope = { kind: 'all' }

  /* --- where on the site we are --- */
  if (query.subcategory && query.category) {
    /* A group (Clothing / Men) or a section (Clothing / Men / Socks): the
       products in it and in everything beneath it. */
    const node = findByPath(await getCategoryTree(), [query.category, query.subcategory, ...(query.leaf ? [query.leaf] : [])])
    if (!node) return null
    const ids = branchIds(node)
    base.push(sql`${products.categoryId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
    scope = { kind: 'subcategory' }
  } else if (query.category) {
    const cat = await getCategoryBySlug(query.category)
    if (!cat) return null
    const ids = await categoryAndDescendants(cat.id)
    base.push(sql`${products.categoryId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`)
    scope = { kind: 'department', department: cat }
  }

  /* --- search (names in three languages, typos, parts of words, SKUs) --- */
  if (query.q) {
    const needle = query.q.trim()
    base.push(sql`(
      to_tsvector('simple', coalesce(${products.searchText}, '')) @@ plainto_tsquery('simple', ${needle})
      or coalesce(${products.searchText}, '') % ${needle}
      or coalesce(${products.searchText}, '') ilike ${'%' + needle + '%'}
      or exists (select 1 from product_variants sv
                 where sv.product_id = ${products.id} and sv.sku ilike ${'%' + needle + '%'})
    )`)
  }

  /* --- department / categories: only where they mean something --- */
  const tree = query.department || query.categories?.length ? await getCategoryTree() : []
  if (query.department && scope.kind === 'all') {
    scope = { kind: 'all', department: query.department }
    const root = tree.find((r) => r.slug === query.department)
    const ids = root ? branchIds(root) : []
    product.department = ids.length
      ? sql`${products.categoryId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql`false`
  }
  if (query.categories?.length && scope.kind !== 'subcategory') {
    const ids: string[] = []
    for (const value of query.categories) {
      const [a, b] = value.split('/')
      const root = scope.kind === 'department' ? tree.find((r) => r.id === scope.department.id) : tree.find((r) => r.slug === a)
      const childSlug = scope.kind === 'department' ? a : b
      const child = root?.children.find((c) => c.slug === childSlug)
      if (child) ids.push(...branchIds(child))
    }
    product.categories = ids.length
      ? sql`${products.categoryId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql`false`
  }

  /* --- price: what the customer pays, promotions included --- */
  const price = await effectivePriceSql()
  const priceParts: SQL[] = []
  if (query.minPrice !== undefined) priceParts.push(sql`${price} >= ${query.minPrice}`)
  if (query.maxPrice !== undefined) priceParts.push(sql`${price} <= ${query.maxPrice}`)
  if (priceParts.length) product.price = sql.join(priceParts, sql` and `)

  /* --- on sale: a sale price or a live promotion — exactly the products
     whose card shows a reduced price --- */
  if (query.onSale) product.sale = sql`${price} < ${products.priceCents}`

  /* --- the variant-level groups --- */
  if (query.sizes?.length) {
    variant.sizes = sql`v.size in (${sql.join(query.sizes.map((s) => sql`${s}`), sql`, `)})`
  }
  if (query.colours?.length) {
    variant.colours = sql`${COLOUR_KEY_SQL} in (${sql.join(query.colours.map((c) => sql`${c}`), sql`, `)})`
  }
  if (query.inStockOnly) {
    /* Buyable: available (shelf minus bags) above zero, on a product the
       owner has not marked sold out. */
    variant.stock = sql`(coalesce(i.on_hand, 0) - coalesce(i.reserved, 0) > 0 and ${products.availability} = 'AVAILABLE')`
  }

  return { base, product, variant, price, scope }
}

/** The filter conditions (not the base) except the groups in `skip`. With
 *  `inline`, the variant conditions are returned bare, for a query that joins
 *  the variant as `v` itself, instead of wrapped in EXISTS. */
function filterFor(b: Built, skip: Group[] = [], inline = false): SQL {
  const parts: SQL[] = []
  for (const [group, cond] of Object.entries(b.product) as [Group, SQL][]) {
    if (!skip.includes(group)) parts.push(cond)
  }
  const variantParts = (Object.entries(b.variant) as [Group, SQL][])
    .filter(([group]) => !skip.includes(group))
    .map(([, cond]) => cond)
  if (inline) {
    parts.push(...variantParts)
  } else if (variantParts.length) {
    parts.push(sql`exists (
      select 1 from product_variants v left join inventory i on i.variant_id = v.id
      where v.product_id = ${products.id} and v.is_active and ${sql.join(variantParts, sql` and `)}
    )`)
  }
  return parts.length ? sql.join(parts, sql` and `) : sql`true`
}

const baseWhere = (b: Built) => sql.join(b.base, sql` and `)
/** Everything that applies: the base and every filter. */
const whereFor = (b: Built) => sql`${baseWhere(b)} and ${filterFor(b)}`

export async function listProducts(query: ProductQuery): Promise<ProductListing> {
  const built = await buildListing(query)
  if (!built) return emptyListing(query)
  const where = whereFor(built)

  const orderBy =
    query.sort === 'price-asc'
      ? sql`${built.price} asc, ${products.createdAt} desc`
      : query.sort === 'price-desc'
        ? sql`${built.price} desc, ${products.createdAt} desc`
        : query.sort === 'name-asc'
          ? sql`${products.name}->>${query.locale ?? 'en'} asc`
          : query.sort === 'popular'
            ? sql`(select count(*) from product_views pv where pv.product_id = ${products.id}) desc, ${products.createdAt} desc`
            : sql`${products.createdAt} desc`

  const [[{ total }], rows, facets] = await Promise.all([
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(products).where(where),
    db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        summary: products.summary,
        categoryId: products.categoryId,
        priceCents: products.priceCents,
        salePriceCents: products.salePriceCents,
        createdAt: products.createdAt,
      })
      .from(products)
      .where(where)
      .orderBy(orderBy)
      .limit(query.perPage)
      .offset((query.page - 1) * query.perPage),
    loadFacets(built, query.locale ?? 'en'),
  ])

  return {
    items: await hydrateCards(rows),
    total,
    page: query.page,
    perPage: query.perPage,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    facets,
  }
}

/** Only the number — for "Show 12 results" while filters are being chosen. */
export async function countProducts(query: ProductQuery): Promise<number> {
  const built = await buildListing(query)
  if (!built) return 0
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(products)
    .where(whereFor(built))
  return total
}

/**
 * Cards for exactly these products, in exactly this order — the hand-picked
 * homepage sections. Hidden products are skipped rather than shown, so taking
 * a product out of the shop takes it off the homepage too, without the owner
 * having to remember a second place.
 *
 * `onSaleOnly` is decided by the same pricing that draws the card, after
 * hydration: a product picked for "On sale" whose sale has since ended drops
 * out on its own, instead of appearing at full price under a "Sale" heading.
 */
export async function listProductsByIds(
  ids: string[],
  opts: { onSaleOnly?: boolean } = {},
): Promise<ProductCard[]> {
  if (ids.length === 0) return []

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      summary: products.summary,
      categoryId: products.categoryId,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.isActive, true)))

  const cards = await hydrateCards(rows)
  const byId = new Map(cards.map((c) => [c.id, c]))
  const ordered = ids.map((id) => byId.get(id)).filter((c): c is ProductCard => Boolean(c))
  return opts.onSaleOnly ? ordered.filter((c) => c.isOnSale) : ordered
}

function emptyListing(query: ProductQuery): ProductListing {
  return {
    items: [],
    total: 0,
    page: query.page,
    perPage: query.perPage,
    totalPages: 1,
    facets: { sizes: [], colours: [], categories: [], departments: [], priceRange: { minCents: 0, maxCents: 0 } },
  }
}

export type FacetOption = { value: string; label: string; count: number; group?: string }

/** The options the filter panel offers, each counted with every OTHER
 *  filter applied. Five small queries, run together. */
async function loadFacets(b: Built, locale: string): Promise<ProductListing['facets']> {
  const loc = sql.raw(`'${locale === 'el' || locale === 'ru' ? locale : 'en'}'`)

  /* Which options EXIST comes from the page itself (category and search);
     how many products each would show comes from every other filter. So the
     panel keeps its shape as filters change — an option that would show
     nothing right now is dimmed, not whisked away. */
  const [sizeRows, colourRows, range, catRows] = await Promise.all([
    db.execute<{ size: string; n: number }>(sql`
      select v.size, count(distinct ${products.id}) filter (where ${filterFor(b, ['sizes'], true)})::int as n
      from products join product_variants v on v.product_id = ${products.id}
      left join inventory i on i.variant_id = v.id
      where ${baseWhere(b)} and v.is_active
      group by v.size`),
    db.execute<{ key: string; name: string; hex: string | null; n: number }>(sql`
      select ${COLOUR_KEY_SQL} as key,
             min(coalesce(v.color_name->>${loc}, v.color_name->>'en')) as name,
             min(v.color_hex) as hex,
             count(distinct ${products.id}) filter (where ${filterFor(b, ['colours'], true)})::int as n
      from products join product_variants v on v.product_id = ${products.id}
      left join inventory i on i.variant_id = v.id
      where ${baseWhere(b)} and v.is_active and v.color_name->>'en' is not null
      group by 1 order by count(distinct ${products.id}) desc, 2`),
    db.execute<{ lo: number | null; hi: number | null }>(sql`
      select min(${b.price})::int as lo, max(${b.price})::int as hi
      from products where ${baseWhere(b)}`),
    b.scope.kind === 'subcategory'
      ? Promise.resolve({ rows: [] as { id: string; parent_id: string | null; n: number }[] })
      : db.execute<{ id: string; parent_id: string | null; n: number }>(sql`
          select c.id, c.parent_id, count(*) filter (where ${filterFor(b, ['categories'])})::int as n
          from products join categories c on c.id = ${products.categoryId}
          where ${baseWhere(b)}
          group by c.id, c.parent_id`),
  ])

  /* Categories and departments, named from the navigation tree so they
     appear in the same order as the menu. */
  const categories: FacetOption[] = []
  const departments: FacetOption[] = []
  if (b.scope.kind !== 'subcategory') {
    const tree = await getCategoryTree()
    const count = new Map(catRows.rows.map((r) => [r.id, Number(r.n)]))
    const scope = b.scope
    for (const root of tree) {
      if (scope.kind === 'department' && root.id !== scope.department.id) continue
      /* With a department chosen, the other department's categories go. */
      if (scope.kind === 'all' && scope.department && root.slug !== scope.department) continue
      for (const child of root.children) {
        const branch = branchIds(child)
        if (!branch.some((id) => count.has(id))) continue /* nothing of it on this page at all */
        const n = branch.reduce((k, id) => k + (count.get(id) ?? 0), 0)
        categories.push({
          value: scope.kind === 'department' ? child.slug : `${root.slug}/${child.slug}`,
          label: tField(child.name, locale as Locale),
          count: n,
          group: scope.kind === 'all' ? tField(root.name, locale as Locale) : undefined,
        })
      }
    }
    if (scope.kind === 'all') {
      /* Department counts ignore the department choice itself (so both stay
         visible) but respect everything else. */
      const deptRows = await db.execute<{ root: string; n: number }>(sql`
        select coalesce(m.parent_id, c.parent_id, c.id) as root, count(*) filter (where ${filterFor(b, ['department'])})::int as n
        from products join categories c on c.id = ${products.categoryId}
        left join categories m on m.id = c.parent_id
        where ${baseWhere(b)}
        group by 1`)
      const byRoot = new Map(deptRows.rows.map((r) => [r.root, Number(r.n)]))
      for (const root of tree) {
        if (!byRoot.has(root.id)) continue
        departments.push({ value: root.slug, label: tField(root.name, locale as Locale), count: byRoot.get(root.id) ?? 0 })
      }
    }
  }

  return {
    /* SQL would sort these alphabetically — "L, M, One size, S, XL, XS". */
    sizes: sortBySize(
      sizeRows.rows.map((r) => ({ size: r.size, count: Number(r.n) })),
      (r) => r.size,
    ),
    colours: colourRows.rows
      .filter((r) => r.key)
      .map((r) => ({ value: r.key, label: r.name, hex: r.hex, count: Number(r.n) })),
    categories,
    departments,
    priceRange: { minCents: Number(range.rows[0]?.lo ?? 0), maxCents: Number(range.rows[0]?.hi ?? 0) },
  }
}

/** Attach images, variants, stock and effective prices to a page of products.
 *  Three queries regardless of how many products — not one per product. */
async function hydrateCards(
  rows: {
    id: string
    slug: string
    name: Record<string, string>
    summary: Record<string, string> | null
    categoryId: string
    priceCents: number
    salePriceCents: number | null
    createdAt: Date
  }[],
): Promise<ProductCard[]> {
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)

  const [availability, images, variants, promos] = await Promise.all([
    db
      .select({ id: products.id, availability: products.availability })
      .from(products)
      .where(inArray(products.id, ids)),

    db
      .select({
        productId: productImages.productId,
        url: productImages.url,
        alt: productImages.alt,
        position: productImages.position,
      })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.position)),

    db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        size: productVariants.size,
        position: productVariants.position,
        available: sql<number>`coalesce(${inventory.onHand} - ${inventory.reserved}, 0)`.mapWith(
          Number,
        ),
      })
      .from(productVariants)
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.position)),

    loadActivePromotions(),
  ])

  /* Price each product once, using its first variant as the representative —
     a card shows one price, and variant overrides are shown on the product
     page where the size is actually chosen. */
  const priceInputs = rows.map((r) => ({
    productId: r.id,
    categoryId: r.categoryId,
    variantId: r.id, // keyed by product for the card
    listCents: r.priceCents,
    saleCents: r.salePriceCents,
  }))
  const prices = await resolvePrices(priceInputs, promos)
  const availabilityById = new Map(availability.map((a) => [a.id, a.availability]))

  return rows.map((row) => {
    const price: EffectivePrice =
      prices.get(row.id) ??
      ({
        variantId: row.id,
        listCents: row.priceCents,
        finalCents: row.priceCents,
        discountCents: 0,
        discountPercent: 0,
        source: 'none',
        promotionId: null,
        promotionSnapshot: null,
      } satisfies EffectivePrice)

    const productVariantsForRow = variants.filter((v) => v.productId === row.id)
    const inStock = productVariantsForRow.some((v) => v.available > 0)
    const markedSoldOut = availabilityById.get(row.id) === 'SOLD_OUT'

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      summary: row.summary,
      categoryId: row.categoryId,
      images: images
        .filter((i) => i.productId === row.id)
        .map((i) => ({ url: i.url, alt: i.alt })),
      listCents: price.listCents,
      finalCents: price.finalCents,
      discountPercent: price.discountPercent,
      isOnSale: price.discountCents > 0,
      sizes: sortBySize(
        productVariantsForRow.map((v) => ({
          size: v.size,
          variantId: v.id,
          available: v.available,
        })),
        (v) => v.size,
      ),
      inStock,
      soldOut: markedSoldOut || !inStock,
      createdAt: row.createdAt,
    }
  })
}

/* ----------------------------------------------------------- product page -- */

export type ProductDetail = {
  id: string
  slug: string
  name: Record<string, string>
  description: Record<string, string> | null
  summary: Record<string, string> | null
  seoTitle: Record<string, string> | null
  seoDescription: Record<string, string> | null
  sizeGuide: Record<string, string> | null
  category: {
    id: string
    slug: string
    name: Record<string, string>
    parentSlug: string | null
    /* The parent's translated name, so a breadcrumb can read "Men / Hoodies"
       rather than printing the raw slug. */
    parentName: Record<string, string> | null
  }
  images: { url: string; alt: Record<string, string> | null; width: number | null; height: number | null }[]
  variants: {
    id: string
    sku: string
    size: string
    colorName: Record<string, string> | null
    colorHex: string | null
    listCents: number
    finalCents: number
    discountPercent: number
    available: number
    inStock: boolean
    isLowStock: boolean
  }[]
  listCents: number
  finalCents: number
  discountPercent: number
  inStock: boolean
  /** Marked sold out by the owner, or nothing on the shelf — cannot be bought. */
  soldOut: boolean
  currency: string
}

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const [row] = await db
    .select({
      product: products,
      category: categories,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1)

  if (!row) return null

  /* The parent's whole path, so a section two levels down still links to
     /clothing/men and /clothing/men/socks. */
  const parentRow = row.category.parentId
    ? (
        await db
          .select({ id: categories.id, name: categories.name })
          .from(categories)
          .where(eq(categories.id, row.category.parentId))
          .limit(1)
      )[0] ?? null
    : null
  const parent = parentRow ? { slug: (await categoryPath(parentRow.id)) ?? '', name: parentRow.name } : null

  const [images, variantRows] = await Promise.all([
    db
      .select({
        url: productImages.url,
        alt: productImages.alt,
        width: productImages.width,
        height: productImages.height,
      })
      .from(productImages)
      .where(eq(productImages.productId, row.product.id))
      .orderBy(asc(productImages.position)),

    db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        size: productVariants.size,
        colorName: productVariants.colorName,
        colorHex: productVariants.colorHex,
        priceOverride: productVariants.priceCentsOverride,
        saleOverride: productVariants.salePriceCentsOverride,
        position: productVariants.position,
        onHand: inventory.onHand,
        reserved: inventory.reserved,
        lowStockThreshold: inventory.lowStockThreshold,
      })
      .from(productVariants)
      .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
      .where(and(eq(productVariants.productId, row.product.id), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.position)),
  ])

  /* Within one position the tie-break is the conventional size order, not the
     alphabetical one SQL would give. */
  variantRows.sort((a, b) => a.position - b.position || compareSizes(a.size, b.size))

  /* Price every variant, since a variant may override the product price. */
  const prices = await resolvePrices(
    variantRows.map((v) => ({
      productId: row.product.id,
      categoryId: row.product.categoryId,
      variantId: v.id,
      listCents: v.priceOverride ?? row.product.priceCents,
      saleCents: v.saleOverride ?? row.product.salePriceCents,
    })),
  )

  const variants = variantRows.map((v) => {
    const price = prices.get(v.id)
    const available = Math.max(0, (v.onHand ?? 0) - (v.reserved ?? 0))
    const threshold = v.lowStockThreshold ?? 3
    return {
      id: v.id,
      sku: v.sku,
      size: v.size,
      colorName: v.colorName,
      colorHex: v.colorHex,
      listCents: price?.listCents ?? row.product.priceCents,
      finalCents: price?.finalCents ?? row.product.priceCents,
      discountPercent: price?.discountPercent ?? 0,
      available,
      inStock: available > 0,
      isLowStock: available > 0 && available <= threshold,
    }
  })

  /* The headline price is the cheapest in-stock variant, or the cheapest
     overall if everything is sold out. */
  const candidates = variants.filter((v) => v.inStock).length
    ? variants.filter((v) => v.inStock)
    : variants
  const headline = candidates.reduce(
    (best, v) => (v.finalCents < best.finalCents ? v : best),
    candidates[0] ?? { listCents: row.product.priceCents, finalCents: row.product.priceCents, discountPercent: 0 },
  )

  return {
    id: row.product.id,
    slug: row.product.slug,
    name: row.product.name,
    description: row.product.description,
    summary: row.product.summary,
    seoTitle: row.product.seoTitle,
    seoDescription: row.product.seoDescription,
    sizeGuide: row.product.sizeGuide,
    category: {
      id: row.category.id,
      slug: row.category.slug,
      name: row.category.name,
      parentSlug: parent?.slug ?? null,
      parentName: parent?.name ?? null,
    },
    images,
    variants,
    listCents: headline.listCents,
    finalCents: headline.finalCents,
    discountPercent: headline.discountPercent,
    inStock: variants.some((v) => v.inStock),
    soldOut: row.product.availability === 'SOLD_OUT' || !variants.some((v) => v.inStock),
    currency: row.product.currency,
  }
}

/* -------------------------------------------------------------- discovery -- */

/** Section 7: related products. Same category first, newest first. */
export async function getRelatedProducts(
  productId: string,
  categoryId: string,
  limit = 4,
): Promise<ProductCard[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      summary: products.summary,
      categoryId: products.categoryId,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      createdAt: products.createdAt,
    })
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        eq(products.categoryId, categoryId),
        sql`${products.id} <> ${productId}`,
      ),
    )
    .orderBy(desc(products.createdAt))
    .limit(limit)

  return hydrateCards(rows)
}

/** Autocomplete for the header search. Deliberately small and fast. */
export async function searchSuggestions(
  term: string,
  locale: Locale = 'en',
  limit = 6,
): Promise<{ slug: string; name: string; finalCents: number; imageUrl: string | null }[]> {
  const needle = term.trim()
  if (needle.length < 2) return []

  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      categoryId: products.categoryId,
      similarity: sql<number>`similarity(coalesce(${products.searchText}, ''), ${needle})`.mapWith(
        Number,
      ),
    })
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        or(
          sql`coalesce(${products.searchText}, '') ilike ${'%' + needle + '%'}`,
          sql`coalesce(${products.searchText}, '') % ${needle}`,
        )!,
      ),
    )
    .orderBy(desc(sql`similarity(coalesce(${products.searchText}, ''), ${needle})`))
    .limit(limit)

  if (rows.length === 0) return []

  const images = await db
    .select({ productId: productImages.productId, url: productImages.url })
    .from(productImages)
    .where(inArray(productImages.productId, rows.map((r) => r.id)))
    .orderBy(asc(productImages.position))
  const firstImage = new Map<string, string>()
  for (const i of images) if (!firstImage.has(i.productId)) firstImage.set(i.productId, i.url)

  const prices = await resolvePrices(
    rows.map((r) => ({
      productId: r.id,
      categoryId: r.categoryId,
      variantId: r.id,
      listCents: r.priceCents,
      saleCents: r.salePriceCents,
    })),
  )

  return rows.map((r) => ({
    slug: r.slug,
    name: tField(r.name, locale),
    finalCents: prices.get(r.id)?.finalCents ?? r.priceCents,
    imageUrl: firstImage.get(r.id) ?? null,
  }))
}

/** All distinct sizes in the catalogue, for the filter sidebar. */
export async function getAllSizes(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ size: productVariants.size })
    .from(productVariants)
    .where(eq(productVariants.isActive, true))
  return sortSizes(rows.map((r) => r.size))
}
