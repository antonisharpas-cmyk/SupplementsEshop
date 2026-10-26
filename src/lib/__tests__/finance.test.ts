/* Finance against the real database: landed cost and weighted average,
   receiving and undoing purchases, reverse charge VAT, stock out without a
   sale, opening stock, wholesale sales with invoices, payments and credit
   notes, repeating expenses, closed months, and the profit and loss. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, inventory, invoices, productVariants, products, stockMovements, users, variantCosts } from '@/db/schema'
import { invalidateSettingsCache, setSetting } from '../settings'
import { landedCosts, purchaseTotals, receivePurchase, saveSupplier, savePurchase, undoReceive, readOpening, applyOpening, importLines } from '../purchases'
import { nextAverage, recordManualMovement, stockValue } from '../stock'
import { createSale, creditSale, getSale, recordPayment, saveRetailer, setPrice, priceList, wholesalePrice } from '../wholesale'
import { listCategories, saveExpense, saveRecurring, writeRecurring } from '../expenses'
import { profitAndLoss, vatSummary } from '../finance-reports'
import { buildPack } from '../finance-pack'
import { buildDocuments } from '../finance-documents'
import { addAttachment } from '../finance'
import { readDelimited, parseNumber } from '../sheet-read'
import { monthOf, todayCy } from '../finance'

vi.spyOn(console, 'info').mockImplementation(() => {})

let staff: string
let tub: string // variant: whey 2kg
let bar: string // variant: protein bar box
const month = monthOf(todayCy())
const today = todayCy()

beforeEach(async () => {
  await db.execute(sql`truncate table attachments, stock_movements, variant_costs, purchase_lines, purchases, suppliers,
    wholesale_payments, wholesale_lines, wholesale_prices, invoices, wholesale_sales, retailers,
    expenses, recurring_expenses, expense_categories, stock_value_snapshots,
    order_items, orders, inventory, product_variants, products, categories, users restart identity cascade`)
  await db.execute(sql`delete from settings where key in ('books_closed_through', 'vat_rate_bp')`)
  invalidateSettingsCache()
  const [u] = await db
    .insert(users)
    .values({ email: 'owner@example.com', passwordHash: 'x', firstName: 'O', lastName: 'W', phone: '+35799000009', role: 'SUPER_ADMIN' })
    .returning({ id: users.id })
  staff = u.id
  const [cat] = await db.insert(categories).values({ slug: 'protein', name: { en: 'Protein' } }).returning({ id: categories.id })
  const [p1] = await db.insert(products).values({ categoryId: cat.id, slug: 'whey', name: { en: 'Whey' }, priceCents: 5950, isActive: true }).returning({ id: products.id })
  const [p2] = await db.insert(products).values({ categoryId: cat.id, slug: 'bar', name: { en: 'Bar box' }, priceCents: 2380, isActive: true }).returning({ id: products.id })
  const [v1] = await db.insert(productVariants).values({ productId: p1.id, sku: 'WHEY-2KG', size: '2kg' }).returning({ id: productVariants.id })
  const [v2] = await db.insert(productVariants).values({ productId: p2.id, sku: 'BAR-12', size: '12' }).returning({ id: productVariants.id })
  tub = v1.id
  bar = v2.id
  await db.insert(inventory).values([{ variantId: tub, onHand: 0 }, { variantId: bar, onHand: 0 }])
})

afterAll(async () => {
  await pool.end()
})

const onHand = async (v: string) => (await db.select().from(inventory).where(eq(inventory.variantId, v)))[0].onHand
const avg = async (v: string) => (await db.select().from(variantCosts).where(eq(variantCosts.variantId, v)))[0]?.avgCostCents ?? 0

async function olimp() {
  return saveSupplier({ name: 'Olimp', kind: 'manufacturer', country: 'PL', vatTreatment: 'EU_REVERSE' })
}

describe('arithmetic', () => {
  it('shares shipping by value', () => {
    /* 100 tubs at €15 and 50 boxes at €10: goods €2,000, shipping €120. */
    const l = landedCosts(
      [
        { quantity: 100, freeQuantity: 0, lineNetCents: 150_000 },
        { quantity: 50, freeQuantity: 0, lineNetCents: 50_000 },
      ],
      12_000,
    )
    expect(l[0]).toBeCloseTo(1590) // 15 + 90/100
    expect(l[1]).toBeCloseTo(1060) // 10 + 30/50
  })

  it('spreads a line over its free units', () => {
    expect(landedCosts([{ quantity: 10, freeQuantity: 2, lineNetCents: 12_000 }], 0)[0]).toBeCloseTo(1000)
  })

  it('weighted average', () => {
    expect(nextAverage(0, 0, 10, 1500, 'in')).toBe(1500)
    expect(nextAverage(10, 1500, 10, 1700, 'in')).toBe(1600)
    expect(nextAverage(20, 1600, 10, 1700, 'undo-in')).toBe(1500)
  })

  it('reverse charge on an EU invoice', () => {
    const t = purchaseTotals({ vatTreatment: 'EU_REVERSE', vatRateBp: 1900, lines: [{ lineNetCents: 100_000 }], shippingCents: 5000, otherFeesCents: 0 })
    expect(t).toEqual({ goodsNetCents: 100_000, vatCents: 0, reverseVatCents: 19_950, totalCents: 105_000 })
  })

  it('wholesale price order', () => {
    expect(wholesalePrice({ own: 900, general: 1000, retailGrossCents: 5950, vatRateBp: 1900, discountPercent: 20 }).unitNetCents).toBe(900)
    expect(wholesalePrice({ general: 1000, retailGrossCents: 5950, vatRateBp: 1900, discountPercent: 20 }).unitNetCents).toBe(1000)
    /* €59.50 with VAT is €50 before VAT; 20% off is €40. */
    expect(wholesalePrice({ retailGrossCents: 5950, vatRateBp: 1900, discountPercent: 20 }).unitNetCents).toBe(4000)
  })

  it('reads numbers and pasted rows', () => {
    expect(parseNumber('€ 1.234,50')).toBe(1234.5)
    expect(parseNumber('1,234.50')).toBe(1234.5)
    expect(parseNumber('15')).toBe(15)
    expect(readDelimited('SKU\tQty\tPrice\nWHEY-2KG\t10\t15,00\n')).toEqual([
      ['SKU', 'Qty', 'Price'],
      ['WHEY-2KG', '10', '15,00'],
    ])
  })
})

describe('purchases', () => {
  it('receives with the settings not read yet (nothing is read outside the transaction)', async () => {
    const s = await olimp()
    const p = await savePurchase(
      { supplierId: s.id, invoiceDate: today, vatTreatment: 'EU_REVERSE', shippingCents: 0, otherFeesCents: 0, lines: [{ variantId: tub, quantity: 5, unitNetCents: 1000 }] },
      staff,
    )
    invalidateSettingsCache()
    await receivePurchase(p, staff)
    expect(await onHand(tub)).toBe(5)
    invalidateSettingsCache()
    await undoReceive(p, staff)
    expect(await onHand(tub)).toBe(0)
  }, 15_000)

  it('receives stock at its landed cost and averages month to month', async () => {
    const s = await olimp()
    const p1 = await savePurchase(
      { supplierId: s.id, invoiceDate: today, vatTreatment: 'EU_REVERSE', shippingCents: 10_000, otherFeesCents: 0, lines: [{ variantId: tub, quantity: 100, unitNetCents: 1500 }] },
      staff,
    )
    await receivePurchase(p1, staff)
    expect(await onHand(tub)).toBe(100)
    expect(await avg(tub)).toBeCloseTo(1600)

    /* Next month the price went up: 100 more at €17, shipping €100. */
    const p2 = await savePurchase(
      { supplierId: s.id, invoiceDate: today, vatTreatment: 'EU_REVERSE', shippingCents: 10_000, otherFeesCents: 0, lines: [{ variantId: tub, quantity: 100, unitNetCents: 1700 }] },
      staff,
    )
    await receivePurchase(p2, staff)
    expect(await onHand(tub)).toBe(200)
    expect(await avg(tub)).toBeCloseTo(1700) // (100 × 16 + 100 × 18) / 200
    expect((await stockValue()).valueCents).toBe(340_000)

    /* Undo the second: back to 100 at €16. */
    await undoReceive(p2, staff)
    expect(await onHand(tub)).toBe(100)
    expect(await avg(tub)).toBeCloseTo(1600)
  })

  it('imports lines from pasted Excel rows', async () => {
    const lines = await importLines(readDelimited('Code\tQuantity\tUnit price\tFree\nwhey-2kg\t10\t15,50\t1\nNOPE\t3\t2\n'))
    expect(lines[0]).toMatchObject({ variantId: tub, quantity: 10, unitNetCents: 1550, freeQuantity: 1 })
    expect(lines[1].problem).toMatch(/No product/)
  })

  it('matches the supplier’s own code saved on the product', async () => {
    await db.update(productVariants).set({ supplierCode: 'OLI-5901330 0001' }).where(eq(productVariants.id, tub))
    const lines = await importLines(readDelimited('Item code;Qty;Net price\nOLI-59013300001;24;10,50\n'))
    expect(lines[0]).toMatchObject({ variantId: tub, quantity: 24, unitNetCents: 1050 })
    expect(lines[0].problem).toBeUndefined()
  })

  it('loads the opening stock', async () => {
    const rows = await readOpening(readDelimited('SKU,Product,Size,Counted quantity,Unit cost\nWHEY-2KG,Whey,2kg,40,16.20\nBAR-12,Bar,12,0,9\n'))
    expect(await applyOpening(rows, staff)).toEqual({ applied: 2, skipped: 0 })
    expect(await onHand(tub)).toBe(40)
    expect(await avg(tub)).toBeCloseTo(1620)
  })
})

describe('stock without a sale', () => {
  it('records samples at cost and refuses more than there is', async () => {
    await applyOpening(await readOpening([['SKU', 'x', 'y', 'Quantity', 'Cost'], ['WHEY-2KG', '', '', '10', '16']]), staff)
    await recordManualMovement({ variantId: tub, kind: 'SAMPLE', quantity: 2, note: 'Gym open day', by: staff })
    expect(await onHand(tub)).toBe(8)
    await expect(recordManualMovement({ variantId: tub, kind: 'DAMAGED', quantity: 9, by: staff })).rejects.toThrow(/Only 8/)
    await recordManualMovement({ variantId: tub, kind: 'COUNT', quantity: 7, by: staff })
    expect(await onHand(tub)).toBe(7)
    const pl = await profitAndLoss([month])
    expect(pl.stockOut.find((s) => s.kind === 'SAMPLE')?.byMonth.get(month)).toBe(3200)
    expect(pl.countDifference.get(month)).toBe(-1600)
  })
})

describe('wholesale', () => {
  async function stocked() {
    await applyOpening(await readOpening([['SKU', 'x', 'y', 'Quantity', 'Cost'], ['WHEY-2KG', '', '', '50', '16'], ['BAR-12', '', '', '20', '9']]), staff)
  }

  it('sells to a retailer on credit with an invoice, takes payments and credit notes', async () => {
    await stocked()
    const r = await saveRetailer({ name: 'Gym One', country: 'CY', vatTreatment: 'DOMESTIC', defaultDiscountPercent: 20, paymentTermsDays: 30, email: 'gym@example.com' })
    await setPrice(r.id, bar, 1500)
    const list = await priceList(r.id)
    expect(list.find((x) => x.variantId === tub)?.unitNetCents).toBe(4000)
    expect(list.find((x) => x.variantId === bar)?.unitNetCents).toBe(1500)

    const id = await createSale(
      { retailerId: r.id, saleDate: today, lines: [{ variantId: tub, quantity: 10, unitNetCents: 4000 }, { variantId: bar, quantity: 4, unitNetCents: 1500 }] },
      staff,
    )
    expect(await onHand(tub)).toBe(40)
    const s = (await getSale(id))!
    expect(s.sale).toMatchObject({ netCents: 46_000, vatCents: 8740, totalCents: 54_740, costCents: 19_600 })
    const inv = s.docs.find((d) => d.kind === 'INVOICE')!
    expect(inv.number).toMatch(/^INV-\d{4}-000001$/)
    expect(inv.linesNet).toBe(true)
    expect(inv.dueAt).not.toBeNull()

    await recordPayment(id, { amountCents: 20_000, method: 'bank', paidOn: today }, staff)
    /* Two tubs back into stock. */
    await creditSale(id, { lines: [{ lineId: s.lines[0].id, quantity: 2 }], restock: true, reason: 'Returned', on: today }, staff)
    expect(await onHand(tub)).toBe(42)
    const after = (await getSale(id))!
    expect(after.balance.creditedCents).toBe(9520) // 2 × 40 + 19% VAT
    expect(after.balance.dueCents).toBe(54_740 - 9520 - 20_000)
    expect(after.sale.costCents).toBe(19_600 - 3200)

    const pl = await profitAndLoss([month])
    expect(pl.wholesaleSales.get(month)).toBe(46_000 - 8000)
    expect(pl.wholesaleCost.get(month)).toBe(16_400)
    expect(pl.grossProfit.get(month)).toBe(38_000 - 16_400)
  })

  it('cannot sell what is not in stock', async () => {
    const r = await saveRetailer({ name: 'Shop', country: 'CY', vatTreatment: 'DOMESTIC', defaultDiscountPercent: 0, paymentTermsDays: 0 })
    await expect(createSale({ retailerId: r.id, saleDate: today, lines: [{ variantId: tub, quantity: 1, unitNetCents: 100 }] }, staff)).rejects.toThrow(/Only 0/)
    expect(await db.select().from(invoices)).toHaveLength(0)
  })
})

describe('expenses and VAT', () => {
  it('writes repeating expenses once a month and sums VAT', async () => {
    const cats = await listCategories()
    expect(cats.map((c) => c.name)).toContain('Rent and utilities')
    const rent = cats.find((c) => c.name === 'Rent and utilities')!
    await saveRecurring({ categoryId: rent.id, payee: 'Landlord', vatTreatment: 'NONE', netCents: 80_000, dayOfMonth: 1, startMonth: month })
    expect(await writeRecurring()).toBe(1)
    expect(await writeRecurring()).toBe(0)
    const ads = cats.find((c) => c.name === 'Marketing')!
    await saveExpense({ expenseDate: today, categoryId: ads.id, payee: 'Meta', vatTreatment: 'EU_REVERSE', netCents: 10_000 }, staff)
    await saveExpense({ expenseDate: today, categoryId: ads.id, payee: 'Printer', vatTreatment: 'DOMESTIC', netCents: 10_000 }, staff)
    const s = await olimp()
    const p = await savePurchase({ supplierId: s.id, invoiceDate: today, vatTreatment: 'EU_REVERSE', shippingCents: 0, otherFeesCents: 0, lines: [{ variantId: tub, quantity: 10, unitNetCents: 1000 }] }, staff)
    await receivePurchase(p, staff)

    const [v] = await vatSummary([month])
    expect(v.inputCents).toBe(1900)
    expect(v.reverseChargeCents).toBe(1900 + 1900)
    expect(v.euAcquisitionsCents).toBe(10_000)
    const pl = await profitAndLoss([month])
    expect(pl.totalExpenses.get(month)).toBe(100_000)
    expect(pl.netProfit.get(month)).toBe(-100_000)
  })

  it('refuses changes in a closed month', async () => {
    const [cat] = await listCategories()
    await setSetting('books_closed_through', month)
    invalidateSettingsCache()
    await expect(saveExpense({ expenseDate: today, categoryId: cat.id, payee: 'X', vatTreatment: 'NONE', netCents: 100 }, staff)).rejects.toThrow(/closed/)
  })

  it('downloads every document of a period in folders', async () => {
    await applyOpening(await readOpening([['SKU', 'x', 'y', 'Quantity', 'Cost'], ['WHEY-2KG', '', '', '10', '16']]), staff)
    const r = await saveRetailer({ name: 'Gym Two', country: 'CY', vatTreatment: 'DOMESTIC', defaultDiscountPercent: 0, paymentTermsDays: 0 })
    await createSale({ retailerId: r.id, saleDate: today, lines: [{ variantId: tub, quantity: 1, unitNetCents: 3000 }] }, staff)
    const cats = await listCategories()
    const e = await saveExpense({ expenseDate: today, categoryId: cats[0].id, payee: 'EAC', vatTreatment: 'DOMESTIC', netCents: 5000 }, staff)
    await addAttachment({ type: 'expense', id: e }, { bytes: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf', filename: 'eac.pdf' }, staff)
    const out = await buildDocuments({ from: today, to: today, kinds: ['online', 'wholesale', 'purchases', 'expenses'] })
    const names = out.bytes.toString('latin1')
    expect(names).toContain('index.xlsx')
    expect(names).toMatch(/sales\/wholesale\/INV-\d{4}-000001 Gym Two\.html/)
    expect(names).toContain('/eac.pdf')
    expect(out.count).toBe(2)
  })

  it('builds the accountant pack', async () => {
    const cats = await listCategories()
    await saveExpense({ expenseDate: today, categoryId: cats[0].id, payee: 'EAC', vatTreatment: 'DOMESTIC', netCents: 5000 }, staff)
    const pack = await buildPack(month)
    expect(pack.filename).toMatch(new RegExp(`${month}_accounts\\.zip$`))
    expect(pack.bytes.readUInt32LE(0)).toBe(0x04034b50)
    expect(pack.bytes.includes(Buffer.from('README.txt'))).toBe(true)
  })
})

void stockMovements
