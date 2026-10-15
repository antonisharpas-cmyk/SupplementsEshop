/* ============================================================================
 * Listing filters against a real database: every group on its own, the
 * boundaries, and combinations — "M + Black + €50–€100 + In stock" must mean
 * one black M, in stock, priced €50–€100 as the customer sees it.
 *
 *   within a group: OR      between groups: AND      size/colour/stock: same variant
 * ========================================================================== */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, inventory, productVariants, products, promotions } from '@/db/schema'
import { countListing, loadListing, type ListingContext } from '../listing'
import { effectivePriceSql, resolvePrices } from '../pricing'

const ALL: ListingContext = { kind: 'new' }

async function names(qs: string, ctx: ListingContext = ALL) {
  const { listing } = await loadListing(new URLSearchParams(qs), ctx, 'en')
  return listing.items.map((i) => i.name.en).sort()
}

beforeAll(async () => {
  await db.execute(sql`truncate table categories, products, product_variants, inventory, promotions restart identity cascade`)
  const [women, men] = await db
    .insert(categories)
    .values([
      { slug: 'women', name: { en: 'Women' }, position: 0 },
      { slug: 'men', name: { en: 'Men' }, position: 1 },
    ])
    .returning({ id: categories.id })
  const [leggings, tops, hoodies] = await db
    .insert(categories)
    .values([
      { slug: 'leggings', parentId: women.id, name: { en: 'Leggings' }, position: 0 },
      { slug: 'tops', parentId: women.id, name: { en: 'Tops' }, position: 1 },
      { slug: 'hoodies', parentId: men.id, name: { en: 'Hoodies' }, position: 0 },
    ])
    .returning({ id: categories.id })

  const t0 = Date.now()
  const at = (n: number) => new Date(t0 - n * 60_000)
  const rows = await db
    .insert(products)
    .values([
      { slug: 'legging', categoryId: leggings.id, name: { en: 'Legging' }, priceCents: 5500, isActive: true, createdAt: at(1) },
      { slug: 'tee', categoryId: tops.id, name: { en: 'Tee' }, priceCents: 3000, salePriceCents: 2400, isActive: true, createdAt: at(2) },
      { slug: 'hoodie', categoryId: hoodies.id, name: { en: 'Hoodie' }, priceCents: 6900, isActive: true, createdAt: at(3) },
      { slug: 'bra', categoryId: tops.id, name: { en: 'Bra' }, priceCents: 4000, isActive: true, availability: 'SOLD_OUT', createdAt: at(4) },
      { slug: 'hidden', categoryId: leggings.id, name: { en: 'Hidden' }, priceCents: 5000, isActive: false, createdAt: at(5) },
      { slug: 'jacket', categoryId: tops.id, name: { en: 'Jacket' }, priceCents: 12000, isActive: true, createdAt: at(6) },
    ])
    .returning({ id: products.id, slug: products.slug })
  const id = Object.fromEntries(rows.map((r) => [r.slug, r.id]))

  /* [product, sku, size, colour, hex, onHand, reserved] */
  const variants: [string, string, string, string, string, number, number][] = [
    ['legging', 'LEG-BLK-XS', 'XS', 'Black', '#111111', 5, 0],
    ['legging', 'LEG-BLK-M', 'M', 'Black', '#111111', 0, 0], // a black M — with none left
    ['legging', 'LEG-SLT-M', 'M', 'Slate', '#4a5058', 3, 0],
    ['tee', 'TEE-WHT-M', 'M', 'White', '#ffffff', 2, 0],
    ['tee', 'TEE-BLK-L', 'L', 'Black', '#111111', 1, 0],
    ['hoodie', 'HOO-BLK-M', 'M', 'Black', '#111111', 4, 0],
    ['hoodie', 'HOO-BLK-XL', 'XL', 'Black', '#111111', 0, 0],
    ['bra', 'BRA-BLK-M', 'M', 'Black', '#111111', 5, 0], // stock, but marked sold out
    ['hidden', 'HID-BLK-M', 'M', 'Black', '#111111', 5, 0],
    ['jacket', 'JKT-OAT-OS', 'One size', 'Oat', '#ded6c9', 2, 2], // all of it in bags
  ]
  const made = await db
    .insert(productVariants)
    .values(variants.map(([p, sku, size, colour, hex]) => ({ productId: id[p], sku, size, colorName: { en: colour }, colorHex: hex })))
    .returning({ id: productVariants.id, sku: productVariants.sku })
  const bySku = Object.fromEntries(made.map((m) => [m.sku, m.id]))
  await db.insert(inventory).values(variants.map(([, sku, , , , onHand, reserved]) => ({ variantId: bySku[sku], onHand, reserved })))

  /* 20% off the hoodie: €69 → €55.20. */
  await db.insert(promotions).values({
    name: '20% hoodie',
    scope: 'PRODUCT',
    productId: id.hoodie,
    discountType: 'PERCENTAGE',
    discountValue: 20,
    startsAt: new Date(t0 - 60_000),
  })
})

afterAll(async () => {
  await pool.end()
})

describe('price — what the customer pays, promotions included', () => {
  it('minimum', async () => {
    expect(await names('minPrice=50')).toEqual(['Hoodie', 'Jacket', 'Legging'])
  })
  it('maximum — €55 includes a €55 legging, excludes a €55.20 hoodie', async () => {
    expect(await names('maxPrice=55')).toEqual(['Bra', 'Legging', 'Tee'])
  })
  it('minimum and maximum', async () => {
    expect(await names('minPrice=30&maxPrice=56')).toEqual(['Bra', 'Hoodie', 'Legging'])
  })
  it('boundaries are inclusive', async () => {
    expect(await names('minPrice=55&maxPrice=55')).toEqual(['Legging'])
    expect(await names('minPrice=24&maxPrice=24')).toEqual(['Tee'])
  })
  it('a reversed range is read the right way round', async () => {
    expect(await names('minPrice=56&maxPrice=30')).toEqual(await names('minPrice=30&maxPrice=56'))
  })
  it('nonsense prices are ignored, not an error', async () => {
    expect(await names('minPrice=-4&maxPrice=abc')).toHaveLength(5)
  })
  it('the slider range is the page’s cheapest and dearest price, whatever else is filtered', async () => {
    const a = await loadListing(new URLSearchParams(''), ALL, 'en')
    const b = await loadListing(new URLSearchParams('size=L&minPrice=90'), ALL, 'en')
    expect(a.listing.facets.priceRange).toEqual({ minCents: 2400, maxCents: 12000 })
    expect(b.listing.facets.priceRange).toEqual(a.listing.facets.priceRange)
  })
  it('sorting by price uses the same number (the promoted hoodie sorts at €55.20)', async () => {
    const { listing } = await loadListing(new URLSearchParams('sort=price-asc'), ALL, 'en')
    const shown = listing.items.map((i) => i.finalCents)
    expect(shown).toEqual([...shown].sort((x, y) => x - y))
    expect(listing.items.map((i) => i.name.en)).toEqual(['Tee', 'Bra', 'Legging', 'Hoodie', 'Jacket'])
  })
})

describe('size', () => {
  it('one size', async () => {
    expect(await names('size=XS')).toEqual(['Legging'])
  })
  it('several sizes are OR', async () => {
    expect(await names('size=XS,L')).toEqual(['Legging', 'Tee'])
  })
  it('offers only sizes that exist on the page', async () => {
    const { listing } = await loadListing(new URLSearchParams(''), { category: 'women', subcategory: 'leggings' }, 'en')
    expect(listing.facets.sizes.map((s) => s.size)).toEqual(['XS', 'M'])
  })
  it('a choice does not hide its alternatives; counts respect the other groups', async () => {
    const { listing } = await loadListing(new URLSearchParams('size=M&colour=white'), ALL, 'en')
    const sizes = Object.fromEntries(listing.facets.sizes.map((s) => [s.size, s.count]))
    expect(sizes.L).toBe(0) /* no white L */
    expect(sizes.M).toBe(1)
    expect(Object.keys(sizes)).toContain('XS') /* still offered, dimmed */
  })
})

describe('colour', () => {
  it('one colour', async () => {
    expect(await names('colour=slate')).toEqual(['Legging'])
  })
  it('several colours are OR', async () => {
    expect(await names('colour=slate,white')).toEqual(['Legging', 'Tee'])
  })
  it('the facet lists colours with names and swatches', async () => {
    const { listing } = await loadListing(new URLSearchParams(''), ALL, 'en')
    expect(listing.facets.colours.find((c) => c.value === 'black')).toMatchObject({ label: 'Black', hex: '#111111' })
  })
})

describe('availability', () => {
  it('in stock: available (shelf minus bags) above zero, and not marked sold out', async () => {
    expect(await names('inStock=1')).toEqual(['Hoodie', 'Legging', 'Tee'])
  })
  it('a product whose last units are all in bags is not in stock', async () => {
    expect(await names('inStock=1&size=One size')).toEqual([])
  })
  it('without the filter, sold-out products are still listed', async () => {
    expect(await names('')).toEqual(['Bra', 'Hoodie', 'Jacket', 'Legging', 'Tee'])
  })
  it('on sale = a sale price or a live promotion', async () => {
    expect(await names('sale=1')).toEqual(['Hoodie', 'Tee'])
  })
})

describe('combinations', () => {
  it('size and colour must be the same variant', async () => {
    expect(await names('size=M&colour=white')).toEqual(['Tee'])
    expect(await names('size=XS&colour=slate')).toEqual([]) /* XS exists, slate exists — not together */
  })
  it('size, colour and stock are one variant: the black M legging has none left', async () => {
    expect(await names('size=M&colour=black')).toEqual(['Bra', 'Hoodie', 'Legging'])
    expect(await names('size=M&colour=black&inStock=1')).toEqual(['Hoodie'])
  })
  it('the brief’s example: M + Black + €50–€100 + In stock', async () => {
    expect(await names('size=M&colour=black&minPrice=50&maxPrice=100&inStock=1')).toEqual(['Hoodie'])
  })
  it('groups are AND: sale and a colour', async () => {
    expect(await names('sale=1&colour=white')).toEqual(['Tee'])
  })
  it('hidden products never appear, whatever the filters', async () => {
    expect(await names('size=M&colour=black&minPrice=50&maxPrice=50')).toEqual([])
  })
  it('search and filters together', async () => {
    expect(await names('q=legging&colour=slate')).toEqual(['Legging'])
  })
  it('the live count agrees with the page', async () => {
    for (const qs of ['', 'size=M', 'size=M&colour=black&inStock=1', 'minPrice=30&maxPrice=56', 'sale=1']) {
      const { listing } = await loadListing(new URLSearchParams(qs), ALL, 'en')
      expect(await countListing(new URLSearchParams(qs), ALL, 'en'), qs).toBe(listing.total)
    }
  })
})

describe('department and category', () => {
  it('on a department page, categories are its subcategories', async () => {
    const { listing } = await loadListing(new URLSearchParams(''), { category: 'women' }, 'en')
    expect(listing.facets.categories.map((c) => c.value)).toEqual(['leggings', 'tops'])
    expect(listing.facets.departments).toEqual([])
    expect(await names('category=tops', { category: 'women' })).toEqual(['Bra', 'Jacket', 'Tee'])
  })
  it('on a subcategory page there is no category or department filter', async () => {
    const { listing, filters } = await loadListing(new URLSearchParams('category=tops&department=men'), { category: 'women', subcategory: 'leggings' }, 'en')
    expect(listing.facets.categories).toEqual([])
    expect(filters.categories).toEqual([])
    expect(filters.department).toBeUndefined()
    expect(listing.items.map((i) => i.name.en)).toEqual(['Legging'])
  })
  it('on pages that span departments: department, then its categories', async () => {
    expect(await names('department=men')).toEqual(['Hoodie'])
    expect(await names('category=women/leggings,men/hoodies')).toEqual(['Hoodie', 'Legging'])
    const { listing } = await loadListing(new URLSearchParams('department=women'), ALL, 'en')
    expect(listing.facets.departments.map((d) => [d.value, d.count])).toEqual([
      ['women', 4],
      ['men', 1],
    ])
    expect(listing.facets.categories.every((c) => c.value.startsWith('women/'))).toBe(true)
  })
})

describe('the SQL price and the card price are the same number', () => {
  it('for every product, under product, category and fixed-amount promotions', async () => {
    const [women] = await db.select({ id: categories.id }).from(categories).where(sql`slug = 'women' and parent_id is null`)
    const extra = await db
      .insert(promotions)
      .values([
        { name: '15% women', scope: 'CATEGORY', categoryId: women.id, discountType: 'PERCENTAGE', discountValue: 15, startsAt: new Date(Date.now() - 60_000) },
        { name: '€7 off everything', scope: 'ALL', discountType: 'FIXED', discountValue: 700, startsAt: new Date(Date.now() - 60_000) },
      ])
      .returning({ id: promotions.id })
    try {
      const price = await effectivePriceSql()
      const rows = await db
        .select({ id: products.id, categoryId: products.categoryId, list: products.priceCents, sale: products.salePriceCents, sqlPrice: sql<number>`${price}`.mapWith(Number) })
        .from(products)
      const resolved = await resolvePrices(rows.map((r) => ({ productId: r.id, categoryId: r.categoryId, variantId: r.id, listCents: r.list, saleCents: r.sale })))
      for (const r of rows) expect(r.sqlPrice, r.id).toBe(resolved.get(r.id)!.finalCents)
    } finally {
      await db.delete(promotions).where(sql`${promotions.id} in (${sql.join(extra.map((e) => sql`${e.id}::uuid`), sql`, `)})`)
    }
  })
})
