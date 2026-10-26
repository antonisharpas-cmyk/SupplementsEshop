/* ============================================================================
 * The admin catalogue: finding products and sizes fast.
 *
 * Two lists, one approach:
 *
 *   listAdminProductRows — one row per product (Products screen)
 *   listStockRows        — one row per variant, i.e. product × colour × size
 *                          (Stock screen)
 *
 * Every filter, search and sort runs in PostgreSQL, and only one page of rows
 * comes back. With twelve products that is academic; with twelve hundred it is
 * the difference between a screen that answers and one that hangs.
 *
 * Every value from the address bar reaches SQL as a bound parameter, never as
 * text pasted into the query.
 *
 * The words used here are the ones on screen:
 *   status  — what the OWNER decided: available, marked sold out, or hidden
 *   stock   — what the SHELF says: in stock, running low, or none left
 * They are different questions and are never merged into one.
 * ========================================================================== */

import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { promotionScope, resolvePrices } from '@/lib/pricing'
import { compareSizes } from '@/lib/sizes'

/* -------------------------------------------------------------- shared -- */

export type ProductStatus = 'available' | 'sold_out' | 'hidden'
export type StockState = 'in_stock' | 'low' | 'sold_out'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The status the owner sees, from the two columns that store it. */
export function productStatus(isActive: boolean, availability: string): ProductStatus {
  if (!isActive) return 'hidden'
  return availability === 'SOLD_OUT' ? 'sold_out' : 'available'
}

/** Split a search into words: "black xs" must match both, in any column. */
function words(q: string | undefined): string[] {
  return (q ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.slice(0, 60))
}

/** ILIKE pattern with the user's % and _ treated as ordinary characters. */
const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** "Reduced" exactly as the storefront means it: a sale price below the
 *  price, or a live promotion reaching the product or its category. */
async function onSaleSql(): Promise<SQL> {
  const scope = await promotionScope()
  if (scope.everything) return sql`true`
  const parts: SQL[] = [sql`(p.sale_price_cents is not null and p.sale_price_cents < p.price_cents)`]
  if (scope.productIds.length) parts.push(sql`p.id in (${sql.join(scope.productIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
  if (scope.categoryIds.length) parts.push(sql`p.category_id in (${sql.join(scope.categoryIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
  return sql`(${sql.join(parts, sql` or `)})`
}

const idList = (ids: string[]) => sql.join(ids.filter((id) => UUID.test(id)).map((id) => sql`${id}::uuid`), sql`, `)

/* ============================================================ products == */

export type ProductFilters = {
  q?: string
  /** Department (root category) slugs. */
  dept?: string[]
  /** Subcategory ids. */
  cat?: string[]
  status?: ProductStatus[]
  stock?: StockState[]
  sale?: ('on_sale' | 'full_price')[]
  /** Euros, inclusive. */
  minPrice?: number
  maxPrice?: number
  sort?: 'newest' | 'name' | 'price-asc' | 'price-desc' | 'stock-asc'
  page?: number
}

export type AdminProductListRow = {
  id: string
  slug: string
  name: string
  image: string | null
  category: string
  department: string
  firstSku: string | null
  skuCount: number
  priceCents: number
  salePriceCents: number | null
  onSale: boolean
  /** What a customer pays today, promotions included, and which promotion. */
  finalCents: number
  promotionName: string | null
  status: ProductStatus
  stock: StockState
  variants: number
  available: number
  sizesOut: number
  sizesLow: number
}

export const PRODUCTS_PER_PAGE = 15

export async function listAdminProductRows(
  f: ProductFilters,
  lowThreshold: number,
): Promise<{ rows: AdminProductListRow[]; total: number; page: number; pages: number }> {
  const onSale = await onSaleSql()
  const where: SQL[] = []

  for (const w of words(f.q)) {
    const pat = like(w)
    where.push(sql`(
      p.name::text ilike ${pat}
      or p.slug ilike ${pat}
      or c.name::text ilike ${pat}
      or d.name::text ilike ${pat}
      ${/^[0-9a-f-]{6,36}$/.test(w) ? sql`or p.id::text ilike ${`${w}%`}` : sql``}
      or exists (select 1 from product_variants sv where sv.product_id = p.id and sv.sku ilike ${pat})
    )`)
  }
  if (f.dept?.length) where.push(sql`d.slug in (${sql.join(f.dept.map((s) => sql`${s}`), sql`, `)})`)
  if (f.cat?.length && idList(f.cat)) where.push(sql`p.category_id in (${idList(f.cat)})`)
  if (f.status?.length) {
    const parts: SQL[] = []
    if (f.status.includes('available')) parts.push(sql`(p.is_active and p.availability = 'AVAILABLE')`)
    if (f.status.includes('sold_out')) parts.push(sql`(p.is_active and p.availability = 'SOLD_OUT')`)
    if (f.status.includes('hidden')) parts.push(sql`(not p.is_active)`)
    where.push(sql`(${sql.join(parts, sql` or `)})`)
  }
  if (f.sale?.length === 1) where.push(f.sale[0] === 'on_sale' ? onSale : sql`not ${onSale}`)
  if (f.minPrice !== undefined) where.push(sql`coalesce(p.sale_price_cents, p.price_cents) >= ${Math.round(f.minPrice * 100)}`)
  if (f.maxPrice !== undefined) where.push(sql`coalesce(p.sale_price_cents, p.price_cents) <= ${Math.round(f.maxPrice * 100)}`)

  /* Stock is a property of the aggregate, so it filters the outer query. */
  const stockParts: SQL[] = []
  if (f.stock?.includes('in_stock')) stockParts.push(sql`s.available > 0`)
  if (f.stock?.includes('low')) stockParts.push(sql`(s.available > 0 and s.sizes_low + s.sizes_out > 0)`)
  if (f.stock?.includes('sold_out')) stockParts.push(sql`s.available <= 0`)

  const order =
    f.sort === 'name'
      ? sql`p.name->>'en' asc`
      : f.sort === 'price-asc'
        ? sql`coalesce(p.sale_price_cents, p.price_cents) asc, p.name->>'en'`
        : f.sort === 'price-desc'
          ? sql`coalesce(p.sale_price_cents, p.price_cents) desc, p.name->>'en'`
          : f.sort === 'stock-asc'
            ? sql`s.available asc, p.name->>'en'`
            : sql`p.created_at desc, p.name->>'en'`

  const page = Math.max(1, Math.floor(f.page ?? 1))
  const base = sql`
    from products p
    join categories c on c.id = p.category_id
    left join categories m on m.id = c.parent_id
    left join categories d on d.id = coalesce(m.parent_id, m.id)
    join lateral (
      select
        count(v.id)::int as variants,
        coalesce(sum(greatest(coalesce(i.on_hand, 0) - coalesce(i.reserved, 0), 0)), 0)::int as available,
        count(*) filter (where v.id is not null and coalesce(i.on_hand, 0) - coalesce(i.reserved, 0) <= 0)::int as sizes_out,
        count(*) filter (where coalesce(i.on_hand, 0) - coalesce(i.reserved, 0) between 1 and ${lowThreshold})::int as sizes_low,
        min(v.sku) as first_sku
      from product_variants v
      left join inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active
    ) s on true
    where ${where.length ? sql.join(where, sql` and `) : sql`true`}
      and ${stockParts.length ? sql`(${sql.join(stockParts, sql` or `)})` : sql`true`}
  `

  const [countRes, rowsRes] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n ${base}`),
    db.execute<{
      id: string
      slug: string
      name: Record<string, string>
      category: Record<string, string>
      department: Record<string, string> | null
      price_cents: number
      sale_price_cents: number | null
      on_sale: boolean
      category_id: string
      is_active: boolean
      availability: string
      variants: number
      available: number
      sizes_out: number
      sizes_low: number
      first_sku: string | null
      image: string | null
    }>(sql`
      select p.id, p.slug, p.name, p.category_id, c.name as category, d.name as department,
             p.price_cents, p.sale_price_cents, ${onSale} as on_sale,
             p.is_active, p.availability,
             s.variants, s.available, s.sizes_out, s.sizes_low, s.first_sku,
             (select url from product_images pi where pi.product_id = p.id
                order by pi.position, pi.created_at limit 1) as image
      ${base}
      order by ${order}
      limit ${PRODUCTS_PER_PAGE} offset ${(page - 1) * PRODUCTS_PER_PAGE}
    `),
  ])

  const total = Number(countRes.rows[0]?.n ?? 0)
  /* The product's base price through the same rules as the shop. */
  const prices = await resolvePrices(
    rowsRes.rows.map((r) => ({
      productId: r.id,
      categoryId: r.category_id,
      variantId: r.id,
      listCents: r.price_cents,
      saleCents: r.sale_price_cents,
    })),
  )
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
    rows: rowsRes.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name.en ?? Object.values(r.name)[0] ?? r.slug,
      image: r.image,
      category: r.category?.en ?? '',
      department: r.department?.en ?? '',
      firstSku: r.first_sku,
      skuCount: Number(r.variants),
      priceCents: r.price_cents,
      salePriceCents: r.sale_price_cents,
      onSale: Boolean(r.on_sale),
      finalCents: prices.get(r.id)?.finalCents ?? r.price_cents,
      promotionName:
        prices.get(r.id)?.source === 'promotion' ? String(prices.get(r.id)?.promotionSnapshot?.name ?? 'Promotion') : null,
      status: productStatus(r.is_active, r.availability),
      stock: Number(r.available) <= 0 ? 'sold_out' : Number(r.sizes_low) + Number(r.sizes_out) > 0 ? 'low' : 'in_stock',
      variants: Number(r.variants),
      available: Number(r.available),
      sizesOut: Number(r.sizes_out),
      sizesLow: Number(r.sizes_low),
    })),
  }
}

/* =============================================================== stock == */

export type StockView = 'all' | 'attention' | 'low' | 'sold_out' | 'in_stock'

export type StockFilters = {
  q?: string
  view?: StockView
  /** One product's sizes — the "Product" filter, and the product editor. */
  product?: string
  dept?: string[]
  cat?: string[]
  colour?: string[]
  size?: string[]
  sort?: 'attention' | 'product' | 'category' | 'colour' | 'size' | 'available-asc' | 'available-desc'
  page?: number
}

export type StockRow = {
  variantId: string
  productId: string
  productName: string
  productSlug: string
  image: string | null
  department: string
  category: string
  colourName: string | null
  colourHex: string | null
  size: string
  sku: string
  onHand: number
  reserved: number
  available: number
  state: 'ok' | 'low' | 'sold_out'
  productStatus: ProductStatus
}

export const STOCK_PER_PAGE = 15

/* Sizes in the order people read them (XS → XXL), not alphabetically
   (L, M, S, XL, XS). Anything unlisted, "One size", "38", sorts after. */
const SIZE_RANK = sql`coalesce(array_position(array['XXS','XS','S','M','L','XL','XXL','XXXL']::text[], upper(v.size)), 99)`

/*
 * "Needs attention": sizes of products that are on sale to customers —
 * visible and not deliberately marked sold out — that have run low or out.
 * A hidden product with nothing left, or one the owner has already marked
 * sold out, is a decision that has been made, not a problem to flag.
 */
const ATTENTION = (low: number) =>
  sql`(p.is_active and p.availability = 'AVAILABLE' and (i.on_hand - i.reserved) <= ${low})`

function viewSql(view: StockView | undefined, low: number): SQL {
  switch (view) {
    case 'attention':
      return ATTENTION(low)
    case 'low':
      return sql`(i.on_hand - i.reserved) between 1 and ${low}`
    case 'sold_out':
      return sql`(i.on_hand - i.reserved) <= 0`
    case 'in_stock':
      return sql`(i.on_hand - i.reserved) > 0`
    default:
      return sql`true`
  }
}

const SIZE_WORDS = new Set(['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'])

function stockWhere(f: StockFilters, low: number, includeView: boolean): SQL {
  const where: SQL[] = [sql`v.is_active`]
  for (const w of words(f.q)) {
    /* A word that IS a size means that size — "s" is small, not every name
       containing an s, and never "xs". */
    if (SIZE_WORDS.has(w)) {
      where.push(sql`lower(v.size) = ${w}`)
      continue
    }
    const pat = like(w)
    where.push(sql`(
      p.name::text ilike ${pat}
      or v.sku ilike ${pat}
      or v.color_name::text ilike ${pat}
      or lower(v.size) = ${w}
      or c.name::text ilike ${pat}
    )`)
  }
  if (f.dept?.length) where.push(sql`d.slug in (${sql.join(f.dept.map((s) => sql`${s}`), sql`, `)})`)
  if (f.cat?.length && idList(f.cat)) where.push(sql`p.category_id in (${idList(f.cat)})`)
  if (f.product && UUID.test(f.product)) where.push(sql`p.id = ${f.product}::uuid`)
  if (f.colour?.length) where.push(sql`coalesce(v.color_name->>'en', '') in (${sql.join(f.colour.map((s) => sql`${s}`), sql`, `)})`)
  if (f.size?.length) where.push(sql`v.size in (${sql.join(f.size.map((s) => sql`${s}`), sql`, `)})`)
  if (includeView) where.push(viewSql(f.view, low))
  return sql.join(where, sql` and `)
}

const STOCK_FROM = sql`
  from product_variants v
  join inventory i on i.variant_id = v.id
  join products p on p.id = v.product_id
  join categories c on c.id = p.category_id
  left join categories m on m.id = c.parent_id
  left join categories d on d.id = coalesce(m.parent_id, m.id)
`

/** How many sizes each quick filter would show, with the other filters applied. */
export async function stockViewCounts(f: StockFilters, low: number): Promise<Record<StockView, number>> {
  const res = await db.execute<Record<string, number>>(sql`
    select
      count(*)::int as all,
      count(*) filter (where ${ATTENTION(low)})::int as attention,
      count(*) filter (where (i.on_hand - i.reserved) between 1 and ${low})::int as low,
      count(*) filter (where (i.on_hand - i.reserved) <= 0)::int as sold_out,
      count(*) filter (where (i.on_hand - i.reserved) > 0)::int as in_stock
    ${STOCK_FROM}
    where ${stockWhere(f, low, false)}
  `)
  const r = res.rows[0] ?? {}
  return {
    all: Number(r.all ?? 0),
    attention: Number(r.attention ?? 0),
    low: Number(r.low ?? 0),
    sold_out: Number(r.sold_out ?? 0),
    in_stock: Number(r.in_stock ?? 0),
  }
}

export async function listStockRows(
  f: StockFilters,
  low: number,
): Promise<{ rows: StockRow[]; total: number; page: number; pages: number }> {
  const order =
    f.sort === 'product'
      ? sql`p.name->>'en', v.color_name->>'en', v.position`
      : f.sort === 'category'
        ? sql`d.position, c.position, p.name->>'en', v.position`
        : f.sort === 'colour'
          ? sql`coalesce(v.color_name->>'en', ''), p.name->>'en', v.position`
          : f.sort === 'size'
            ? sql`${SIZE_RANK}, v.size, p.name->>'en'`
            : f.sort === 'available-asc'
              ? sql`(i.on_hand - i.reserved) asc, p.name->>'en', v.position`
              : f.sort === 'available-desc'
                ? sql`(i.on_hand - i.reserved) desc, p.name->>'en', v.position`
                : /* attention: sold out first, then running low, then the rest */
                  sql`case when (i.on_hand - i.reserved) <= 0 then 0
                           when (i.on_hand - i.reserved) <= ${low} then 1 else 2 end,
                      (i.on_hand - i.reserved) asc, p.name->>'en', v.position`

  const page = Math.max(1, Math.floor(f.page ?? 1))
  const where = stockWhere(f, low, true)

  const [countRes, rowsRes] = await Promise.all([
    db.execute<{ n: number }>(sql`select count(*)::int as n ${STOCK_FROM} where ${where}`),
    db.execute<{
      variant_id: string
      product_id: string
      name: Record<string, string>
      slug: string
      department: Record<string, string> | null
      category: Record<string, string>
      color_name: Record<string, string> | null
      color_hex: string | null
      size: string
      sku: string
      on_hand: number
      reserved: number
      is_active: boolean
      availability: string
      image: string | null
    }>(sql`
      select v.id as variant_id, p.id as product_id, p.name, p.slug,
             d.name as department, c.name as category,
             v.color_name, v.color_hex, v.size, v.sku,
             i.on_hand, i.reserved, p.is_active, p.availability,
             coalesce(
               (select url from product_images pi where pi.variant_id = v.id order by pi.position limit 1),
               (select url from product_images pi where pi.product_id = p.id order by pi.position, pi.created_at limit 1)
             ) as image
      ${STOCK_FROM}
      where ${where}
      order by ${order}
      limit ${STOCK_PER_PAGE} offset ${(page - 1) * STOCK_PER_PAGE}
    `),
  ])

  const rows: StockRow[] = rowsRes.rows.map((r) => {
    const available = Number(r.on_hand) - Number(r.reserved)
    return {
      variantId: r.variant_id,
      productId: r.product_id,
      productName: r.name.en ?? Object.values(r.name)[0] ?? r.slug,
      productSlug: r.slug,
      image: r.image,
      department: r.department?.en ?? '',
      category: r.category?.en ?? '',
      colourName: r.color_name?.en ?? null,
      colourHex: r.color_hex,
      size: r.size,
      sku: r.sku,
      onHand: Number(r.on_hand),
      reserved: Number(r.reserved),
      available,
      state: available <= 0 ? 'sold_out' : available <= low ? 'low' : 'ok',
      productStatus: productStatus(r.is_active, r.availability),
    }
  })

  const total = Number(countRes.rows[0]?.n ?? 0)
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / STOCK_PER_PAGE)) }
}

/* ============================================================== facets == */

export type CatalogueFacets = {
  departments: { slug: string; name: string }[]
  categories: { id: string; name: string; department: string; departmentSlug: string }[]
  colours: { name: string; hex: string | null }[]
  sizes: string[]
}

/** The options the filter menus offer — only values that exist. */
export async function catalogueFacets(): Promise<CatalogueFacets> {
  const [cats, colours, sizes] = await Promise.all([
    db.execute<{ id: string; name: Record<string, string>; parent_id: string | null; slug: string; position: number }>(
      sql`select id, name, parent_id, slug, position from categories order by position, slug`,
    ),
    db.execute<{ name: string; hex: string | null }>(sql`
      select v.color_name->>'en' as name, min(v.color_hex) as hex
      from product_variants v where v.is_active and v.color_name is not null
      group by 1 order by 1`),
    db.execute<{ size: string }>(sql`select distinct size from product_variants where is_active`),
  ])
  const roots = cats.rows.filter((c) => !c.parent_id)
  const byId = new Map(cats.rows.map((r) => [r.id, r]))
  /* Groups and sections, each under its range; a section reads "Men › Socks". */
  const placed = cats.rows
    .filter((c) => c.parent_id)
    .map((c) => {
      const parent = byId.get(c.parent_id!)
      const root = parent?.parent_id ? byId.get(parent.parent_id) : parent
      const name = parent?.parent_id ? `${parent.name.en ?? parent.slug} › ${c.name.en ?? c.slug}` : (c.name.en ?? c.slug)
      return root ? { id: c.id, name, department: root.name.en ?? root.slug, departmentSlug: root.slug } : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
  return {
    departments: roots.map((r) => ({ slug: r.slug, name: r.name.en ?? r.slug })),
    categories: placed,
    colours: colours.rows.filter((c) => c.name),
    sizes: sizes.rows.map((s) => s.size).sort(compareSizes),
  }
}

/* ======================================================= url <-> filter == */

type Params = Record<string, string | string[] | undefined>

const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(',') : (v ?? ''))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)

const num = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((v): v is T => (allowed as readonly string[]).includes(v))
}

const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.slice(0, 120)

export function parseProductFilters(p: Params): ProductFilters {
  const sort = str(p.sort)
  return {
    q: str(p.q),
    dept: list(p.dept),
    cat: list(p.cat).filter((id) => UUID.test(id)),
    status: pick(list(p.status), ['available', 'sold_out', 'hidden'] as const),
    stock: pick(list(p.stock), ['in_stock', 'low', 'sold_out'] as const),
    sale: pick(list(p.sale), ['on_sale', 'full_price'] as const),
    minPrice: num(p.min),
    maxPrice: num(p.max),
    sort: (['newest', 'name', 'price-asc', 'price-desc', 'stock-asc'] as const).find((s) => s === sort),
    page: num(p.page),
  }
}

export function parseStockFilters(p: Params): StockFilters {
  const sort = str(p.sort)
  const view = str(p.view)
  return {
    q: str(p.q),
    view: (['all', 'attention', 'low', 'sold_out', 'in_stock'] as const).find((v) => v === view),
    product: str(p.product),
    dept: list(p.dept),
    cat: list(p.cat).filter((id) => UUID.test(id)),
    colour: list(p.colour),
    size: list(p.size),
    sort: (['attention', 'product', 'category', 'colour', 'size', 'available-asc', 'available-desc'] as const).find(
      (s) => s === sort,
    ),
    page: num(p.page),
  }
}
