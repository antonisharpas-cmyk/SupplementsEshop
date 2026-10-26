/* Products from a sheet: the invoice text becomes the sheet, the sheet is
   checked and creates hidden products with their flavours and barcodes,
   photos find their flavour by barcode, and the supplier invoice then finds
   the same flavours. */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, inventory, productVariants, products } from '@/db/schema'
import { applyImport, checkImport, codeFromFilename, invoiceSheet, matchPhotos, readInvoiceText, splitDescription } from '../product-import'
import { importLines } from '../purchases'
import { readTable, type Rows } from '../sheet-read'

const INVOICE = `Line Description EAN PCN Net Price VAT 0% Quantity Net Value
1 AAKG 7500 25ml Shot S GL grapefr 5901330098765 1.21 EUR 36 PCE 43.56 EUR
2 Whey Protein Complex 100% 700g chocolate bag 5901330052491 12.50 EUR 20 PCE 250.00 EUR
3 Whey Protein Complex 100% 700g vanilla bag 5901330052492 12.50 EUR 10 PCE 125.00 EUR
52 Whey Protein Complex 100% vanilla 1800 g 5901330052484 30.10 EUR 2 PCE
53 Whey Protein Complex 100% vanilla 1800 g 5901330052484 30.10 EUR 3 PCE`

beforeEach(async () => {
  await db.execute(sql`truncate table product_images, inventory, product_variants, products, categories restart identity cascade`)
  const [range] = await db.insert(categories).values({ slug: 'sports', name: { en: 'Sports Nutrition' }, position: 0 }).returning({ id: categories.id })
  await db.insert(categories).values([
    { slug: 'protein', parentId: range.id, name: { en: 'Protein' }, position: 0 },
    { slug: 'amino', parentId: range.id, name: { en: 'Amino Acids & BCAA' }, position: 1 },
  ])
})

afterAll(async () => {
  await pool.end()
})

describe('invoice text', () => {
  it('reads every line with a barcode and merges the same barcode', () => {
    const lines = readInvoiceText(INVOICE)
    expect(lines.map((l) => l.ean)).toEqual(['5901330098765', '5901330052491', '5901330052492', '5901330052484'])
    expect(lines[0]).toMatchObject({ costCents: 121, quantity: 36, name: 'AAKG 7500', size: '25 ml' })
    expect(lines[1]).toMatchObject({ name: 'Whey Protein Complex 100%', size: '700 g', flavour: 'Chocolate' })
    expect(lines[3]).toMatchObject({ name: 'Whey Protein Complex 100%', size: '1800 g', flavour: 'Vanilla', quantity: 5 })
  })

  it('guesses name, size and flavour', () => {
    expect(splitDescription('Protein Complex 700g cookies cream bag')).toEqual({ name: 'Protein Complex', size: '700 g', flavour: 'Cookies Cream' })
    expect(splitDescription('Gold Omega 3 60 softgels')).toEqual({ name: 'Gold Omega 3', size: '60 softgels', flavour: '' })
  })

  it('photo names give the code', () => {
    expect(codeFromFilename('5901330098765.jpg')).toBe('5901330098765')
    expect(codeFromFilename('5901330098765_2.png')).toBe('5901330098765')
    expect(codeFromFilename('5901330098765 (3).webp')).toBe('5901330098765')
  })
})

/* The sheet as the owner fills it in. */
const sheet = (body: (string | number)[][]): Rows => [
  ['Product name', 'Flavour', 'Size', 'Category', 'Selling price', 'EAN', 'Name in Greek', 'Name in Russian', 'Supplier description', 'Cost price', 'Quantity'],
  ...body.map((r) => r.map(String)),
]

describe('import', () => {
  it('checks, creates hidden products with their flavours, and is safe to run twice', async () => {
    const rows = sheet([
      ['Whey Protein Complex 100%', 'Chocolate', '700 g', 'Protein', '24.90', '5901330052491'],
      ['Whey Protein Complex 100%', 'Vanilla', '700 g', 'Protein', '24.90', '5901330052492'],
      ['Whey Protein Complex 100%', 'Vanilla', '1800 g', 'Sports Nutrition > Protein', '54,90', '5901330052484'],
      ['AAKG 7500 Shot', 'Grapefruit', '25 ml', 'Amino acids & BCAA', '2.50', '5901330098765'],
      ['Mystery', 'X', '1 kg', 'Snacks', '9', '5900000000001'],
      ['No price', 'X', '1 kg', 'Protein', '', '5900000000002'],
      ['Whey Protein Complex 100%', 'Vanilla', '1800 g', 'Protein', '54.90', '5901330052484'],
    ])
    const checked = await checkImport(rows)
    expect(checked.map((r) => r.problem ?? r.action)).toEqual([
      'new product',
      'new product',
      'new product',
      'new product',
      expect.stringContaining('No category called'),
      'No selling price',
      'This EAN is on an earlier row too',
    ])

    const result = await applyImport(checked)
    expect(result).toMatchObject({ products: 2, flavours: 4, failed: [] })

    const [whey] = await db.select().from(products).where(eq(products.slug, 'whey-protein-complex-100'))
    expect(whey).toMatchObject({ isActive: false, priceCents: 2490 })
    const vs = await db.select().from(productVariants).where(eq(productVariants.productId, whey.id))
    expect(vs).toHaveLength(3)
    const big = vs.find((v) => v.size === '1800 g')!
    expect(big).toMatchObject({ supplierCode: '5901330052484', priceCentsOverride: 5490 })
    expect(vs.find((v) => v.supplierCode === '5901330052491')!.priceCentsOverride).toBeNull()
    /* Two flavours of one size need different colours. */
    const small = vs.filter((v) => v.size === '700 g')
    expect(new Set(small.map((v) => v.colorHex)).size).toBe(2)
    expect((await db.select().from(inventory).where(eq(inventory.variantId, big.id)))[0].onHand).toBe(0)

    /* Again: everything is already there, nothing new. */
    const again = await checkImport(rows)
    expect(again.slice(0, 4).every((r) => r.action === 'already there')).toBe(true)
    expect(await applyImport(again)).toMatchObject({ products: 0, flavours: 0 })

    /* A new flavour of a product that exists joins it. */
    const more = await checkImport(sheet([['whey protein complex 100%', 'Strawberry', '700 g', '', '24.90', '5901330052499']]))
    expect(more[0]).toMatchObject({ action: 'new flavour', productId: whey.id })
    expect(more[0].problem).toBeUndefined()
    await applyImport(more)
    expect(await db.select().from(productVariants).where(eq(productVariants.productId, whey.id))).toHaveLength(4)
  })

  it('a second import fills in Greek and Russian names, English untouched', async () => {
    await applyImport(await checkImport(sheet([['Pure Whey Isolate 95', 'Chocolate', '600 g', 'Protein', '40', '5901330038525']])))
    const withText = [
      ['Product name', 'Flavour', 'Size', 'Category', 'Selling price', 'EAN', 'Name in Greek', 'Name in Russian', 'Supplier description', 'Cost price', 'Quantity', 'Flavour in Greek', 'Flavour in Russian'],
      ['Pure Whey Isolate 95', 'Chocolate', '600 g', 'Protein', '40', '5901330038525', 'Πρωτεΐνη Isolate 95', 'Изолят 95', '', '', '', 'Σοκολάτα', 'Шоколад'],
    ]
    const checked = await checkImport(withText)
    expect(checked[0]).toMatchObject({ action: 'already there', nameEl: 'Πρωτεΐνη Isolate 95', flavourRu: 'Шоколад' })
    expect(await applyImport(checked)).toMatchObject({ translated: 2, products: 0, flavours: 0 })
    const [p] = await db.select().from(products).where(eq(products.slug, 'pure-whey-isolate-95'))
    expect(p.name).toEqual({ en: 'Pure Whey Isolate 95', el: 'Πρωτεΐνη Isolate 95', ru: 'Изолят 95' })
    const [v] = await db.select().from(productVariants).where(eq(productVariants.productId, p.id))
    expect(v.colorName).toEqual({ en: 'Chocolate', el: 'Σοκολάτα', ru: 'Шоколад' })
    /* Again: nothing left to change. */
    expect(await applyImport(await checkImport(withText))).toMatchObject({ translated: 0 })
  })

  it('texts: a new product gets them, a product already there only gets the empty ones', async () => {
    const head = ['Product name', 'Flavour', 'Size', 'Category', 'Selling price', 'EAN', 'Short line', 'Short line in Greek', 'Description', 'Description in Greek', 'Description in Russian', 'Nutrition & usage', 'Search title']
    await applyImport(
      await checkImport([head, ['Iso Plus Powder', 'Lemon', '700 g', 'Protein', '20', '5901330024221', 'Isotonic drink', 'Ισοτονικό ρόφημα', 'With carnitine.', 'Με καρνιτίνη.', '', 'Two scoops in 500 ml', '']]),
    )
    const [p] = await db.select().from(products).where(eq(products.slug, 'iso-plus-powder'))
    expect(p.summary).toEqual({ en: 'Isotonic drink', el: 'Ισοτονικό ρόφημα' })
    expect(p.description).toEqual({ en: 'With carnitine.', el: 'Με καρνιτίνη.' })
    expect(p.sizeGuide).toEqual({ en: 'Two scoops in 500 ml' })
    /* The owner changes the English short line in the console; a later sheet
       adds the Russian description and search title but keeps the edit. */
    await db.update(products).set({ summary: { en: 'Edited in the console', el: 'Ισοτονικό ρόφημα' } }).where(eq(products.id, p.id))
    const res = await applyImport(
      await checkImport([head, ['Iso Plus Powder', 'Lemon', '700 g', 'Protein', '20', '5901330024221', 'Isotonic drink', 'Άλλο', 'Other', '', 'С карнитином.', '', 'Iso Plus lemon']]),
    )
    expect(res.translated).toBe(1)
    const [q] = await db.select().from(products).where(eq(products.id, p.id))
    expect(q.summary).toEqual({ en: 'Edited in the console', el: 'Ισοτονικό ρόφημα' })
    expect(q.description).toEqual({ en: 'With carnitine.', el: 'Με καρνιτίνη.', ru: 'С карнитином.' })
    expect(q.seoTitle).toEqual({ en: 'Iso Plus lemon' })
  })

  it('saves the barcode on a flavour that had none', async () => {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, 'protein'))
    const [p] = await db.insert(products).values({ categoryId: cat.id, slug: 'iso', name: { en: 'Isolate' }, priceCents: 4000 }).returning()
    await db.insert(productVariants).values({ productId: p.id, sku: 'ISO-1', size: '600 g', colorName: { en: 'Natural' } })
    const checked = await checkImport(sheet([['Isolate', 'Natural', '600 g', 'Protein', '40', '5901330059384']]))
    expect(checked[0]).toMatchObject({ action: 'already there', saveCode: true })
    expect(await applyImport(checked)).toMatchObject({ codes: 1 })
    const [v] = await db.select().from(productVariants).where(eq(productVariants.sku, 'ISO-1'))
    expect(v.supplierCode).toBe('5901330059384')
  })

  it('the sheet from the invoice works for the purchase too, and photos find their flavour', async () => {
    const file = await invoiceSheet(readInvoiceText(INVOICE))
    const table = readTable(file)
    expect(table[0].slice(0, 6)).toEqual(['Product name', 'Flavour', 'Size', 'Category', 'Selling price', 'EAN'])
    /* The owner fills in category and price. */
    const filled = table.map((r, i) => (i === 0 ? r : [r[0], r[1], r[2], 'Protein', '20', ...r.slice(5)]))
    await applyImport(await checkImport(filled))

    const lines = await importLines(filled)
    expect(lines.filter((l) => !l.problem)).toHaveLength(4)
    expect(lines.find((l) => l.sku === '5901330052484')).toMatchObject({ quantity: 5, unitNetCents: 3010 })

    const photos = await matchPhotos(['5901330052491.jpg', '5901330052491_2.jpg', '123.jpg'])
    expect(photos[0].label).toBe('Whey Protein Complex 100%, Chocolate, 700 g')
    expect(photos[1].variantId).toBe(photos[0].variantId)
    expect(photos[2].variantId).toBeNull()
  })
})
