/* The admin Products and Stock lists: every filter and search, run against a
   real database, because that is where they run. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, inventory, productVariants, products } from '@/db/schema'
import { listAdminProductRows, listStockRows, parseProductFilters, parseStockFilters, stockViewCounts } from '../admin-catalog'

const LOW = 3
let leggingsCat: string
let hoodiesCat: string

beforeAll(async () => {
  await db.execute(sql`truncate table categories, products, product_variants, inventory, promotions restart identity cascade`)
  const [women, men] = await db
    .insert(categories)
    .values([
      { slug: 'women', name: { en: 'Women' }, position: 0 },
      { slug: 'men', name: { en: 'Men' }, position: 1 },
    ])
    .returning({ id: categories.id })
  const [leggings, hoodies] = await db
    .insert(categories)
    .values([
      { slug: 'leggings', parentId: women.id, name: { en: 'Leggings' } },
      { slug: 'hoodies', parentId: men.id, name: { en: 'Hoodies' } },
    ])
    .returning({ id: categories.id })
  leggingsCat = leggings.id
  hoodiesCat = hoodies.id

  const [legging, hoodie, hidden, markedOut] = await db
    .insert(products)
    .values([
      { categoryId: leggingsCat, slug: 'sculpt-legging', name: { en: 'Sculpt Legging' }, priceCents: 5500, isActive: true },
      { categoryId: hoodiesCat, slug: 'heavy-hoodie', name: { en: 'Heavy Hoodie' }, priceCents: 6900, salePriceCents: 5500, isActive: true },
      { categoryId: hoodiesCat, slug: 'old-hoodie', name: { en: 'Old Hoodie' }, priceCents: 4000, isActive: false },
      { categoryId: leggingsCat, slug: 'rib-legging', name: { en: 'Rib Legging' }, priceCents: 4500, availability: 'SOLD_OUT', isActive: true },
    ])
    .returning({ id: products.id })

  const variants = await db
    .insert(productVariants)
    .values([
      { productId: legging.id, sku: 'LEG-BLK-XS', size: 'XS', colorName: { en: 'Black' }, colorHex: '#111111' },
      { productId: legging.id, sku: 'LEG-BLK-S', size: 'S', colorName: { en: 'Black' }, colorHex: '#111111' },
      { productId: legging.id, sku: 'LEG-SLT-XS', size: 'XS', colorName: { en: 'Slate' }, colorHex: '#555555' },
      { productId: hoodie.id, sku: 'HOO-BLK-M', size: 'M', colorName: { en: 'Black' }, colorHex: '#111111' },
      { productId: hidden.id, sku: 'OLD-GRY-M', size: 'M', colorName: { en: 'Grey' } },
      { productId: markedOut.id, sku: 'RIB-BLK-S', size: 'S', colorName: { en: 'Black' } },
    ])
    .returning({ id: productVariants.id, sku: productVariants.sku })
  const stock: Record<string, [number, number]> = {
    'LEG-BLK-XS': [0, 0], // sold out
    'LEG-BLK-S': [2, 0], // low
    'LEG-SLT-XS': [9, 0],
    'HOO-BLK-M': [5, 4], // 1 available — low, because of holds
    'OLD-GRY-M': [0, 0], // out, but hidden: not "attention"
    'RIB-BLK-S': [0, 0], // out, but marked sold out: not "attention"
  }
  await db.insert(inventory).values(variants.map((v) => ({ variantId: v.id, onHand: stock[v.sku][0], reserved: stock[v.sku][1] })))
})

afterAll(async () => {
  await pool.end()
})

const names = (rows: { name?: string; productName?: string }[]) => rows.map((r) => r.name ?? r.productName).sort()

describe('products list', () => {
  it('searches name, SKU and category', async () => {
    expect(names((await listAdminProductRows({ q: 'legging' }, LOW)).rows)).toEqual(['Rib Legging', 'Sculpt Legging'])
    expect(names((await listAdminProductRows({ q: 'HOO-BLK' }, LOW)).rows)).toEqual(['Heavy Hoodie'])
    expect(names((await listAdminProductRows({ q: 'hoodies' }, LOW)).rows)).toEqual(['Heavy Hoodie', 'Old Hoodie'])
    /* A percent sign is a character, not a wildcard. */
    expect((await listAdminProductRows({ q: '%' }, LOW)).rows).toHaveLength(0)
  })

  it('keeps available, sold out and hidden apart', async () => {
    expect(names((await listAdminProductRows({ status: ['hidden'] }, LOW)).rows)).toEqual(['Old Hoodie'])
    expect(names((await listAdminProductRows({ status: ['sold_out'] }, LOW)).rows)).toEqual(['Rib Legging'])
    expect(names((await listAdminProductRows({ status: ['available'] }, LOW)).rows)).toEqual(['Heavy Hoodie', 'Sculpt Legging'])
    const row = (await listAdminProductRows({ q: 'rib' }, LOW)).rows[0]
    expect(row.status).toBe('sold_out')
  })

  it('combines department, category, sale and price filters', async () => {
    expect(names((await listAdminProductRows({ dept: ['men'], sale: ['on_sale'] }, LOW)).rows)).toEqual(['Heavy Hoodie'])
    expect(names((await listAdminProductRows({ cat: [leggingsCat], maxPrice: 50 }, LOW)).rows)).toEqual(['Rib Legging'])
    /* Price filters by what the customer pays today — the sale price. */
    expect(names((await listAdminProductRows({ minPrice: 55, maxPrice: 55 }, LOW)).rows)).toEqual(['Heavy Hoodie', 'Sculpt Legging'])
  })

  it('filters by stock', async () => {
    expect(names((await listAdminProductRows({ stock: ['sold_out'] }, LOW)).rows)).toEqual(['Old Hoodie', 'Rib Legging'])
    expect(names((await listAdminProductRows({ stock: ['low'] }, LOW)).rows)).toEqual(['Heavy Hoodie', 'Sculpt Legging'])
  })

  it('reads filters from the address bar and ignores junk', () => {
    const f = parseProductFilters({ status: 'hidden,bogus', cat: `${hoodiesCat},'; drop table x`, min: '-4', sort: 'evil' })
    expect(f.status).toEqual(['hidden'])
    expect(f.cat).toEqual([hoodiesCat])
    expect(f.minPrice).toBeUndefined()
    expect(f.sort).toBeUndefined()
  })
})

describe('stock list', () => {
  it('has one line per colour and size', async () => {
    const { rows } = await listStockRows({ view: 'all', q: 'sculpt' }, LOW)
    expect(rows.map((r) => r.sku).sort()).toEqual(['LEG-BLK-S', 'LEG-BLK-XS', 'LEG-SLT-XS'])
    expect(rows.find((r) => r.sku === 'LEG-SLT-XS')?.colourName).toBe('Slate')
  })

  it('"needs attention" means low or out on products customers can buy', async () => {
    const { rows } = await listStockRows({ view: 'attention' }, LOW)
    expect(rows.map((r) => r.sku)).toEqual(['LEG-BLK-XS', 'HOO-BLK-M', 'LEG-BLK-S']) // out first, then fewest
    const counts = await stockViewCounts({}, LOW)
    expect(counts).toMatchObject({ all: 6, attention: 3, sold_out: 3, low: 2, in_stock: 3 })
  })

  it('counts held units: 5 on the shelf with 4 in bags is 1 available', async () => {
    const hoodie = (await listStockRows({ view: 'all', q: 'HOO-BLK-M' }, LOW)).rows[0]
    expect(hoodie).toMatchObject({ onHand: 5, reserved: 4, available: 1, state: 'low' })
  })

  it('searches colour, size (whole word) and several words at once', async () => {
    expect((await listStockRows({ view: 'all', q: 'black' }, LOW)).rows).toHaveLength(4)
    /* A size on its own means that size — "s" is small, not every name with an s. */
    expect((await listStockRows({ view: 'all', q: 's' }, LOW)).rows.map((r) => r.size)).toEqual(['S', 'S'])
    expect((await listStockRows({ view: 'all', q: 'black xs' }, LOW)).rows.map((r) => r.sku)).toEqual(['LEG-BLK-XS'])
    expect((await listStockRows({ view: 'all', colour: ['Slate'], size: ['XS'] }, LOW)).rows).toHaveLength(1)
  })

  it('reads the view from the address bar', () => {
    expect(parseStockFilters({ view: 'low' }).view).toBe('low')
    expect(parseStockFilters({ view: 'nope' }).view).toBeUndefined()
  })
})
