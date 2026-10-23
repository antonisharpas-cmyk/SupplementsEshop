/* ============================================================================
 * Suppliers and purchases.
 *
 * A purchase is the supplier's invoice: products with quantity and price
 * before VAT, plus shipping and other fees. It is a DRAFT until the goods
 * arrive; "Receive" adds the stock and works out the true cost of each unit:
 *
 *   landed unit cost = (line price + its share of shipping and fees)
 *                      / (units bought + free units)
 *
 * Shipping and fees are shared by VALUE: a line worth 60% of the goods
 * carries 60% of the shipping. VAT is never part of the cost when it can be
 * reclaimed (Cyprus VAT, import VAT, EU reverse charge).
 *
 * A received purchase can be taken back to draft ("Undo receive") while the
 * stock it brought is still there, to fix a mistake, then received again.
 * ========================================================================== */

import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { inventory, productVariants, products, purchaseLines, purchases, suppliers } from '@/db/schema'
import { getSettings } from '@/lib/settings'
import { applyMovement, announceRestocks, variantLabel } from '@/lib/stock'
import { assertOpen, FinanceError, isVatTreatment, nextNumber, todayCy, vatOn, type VatTreatment } from '@/lib/finance'
import { parseNumber, pickColumns, type Rows } from '@/lib/sheet-read'

export type Supplier = typeof suppliers.$inferSelect
export type Purchase = typeof purchases.$inferSelect
export type PurchaseLine = typeof purchaseLines.$inferSelect

/* ============================================================ suppliers == */

export type SupplierInput = {
  name: string
  kind: 'manufacturer' | 'retailer' | 'other'
  country: string
  vatNumber?: string | null
  vatTreatment: VatTreatment
  email?: string | null
  phone?: string | null
  address?: string | null
  note?: string | null
  isActive?: boolean
}

export async function listSuppliers(opts: { activeOnly?: boolean } = {}) {
  return db
    .select({
      supplier: suppliers,
      purchases: sql<number>`(select count(*) from purchases p where p.supplier_id = ${suppliers.id} and p.status <> 'CANCELLED')`.mapWith(Number),
      spentCents: sql<number>`(select coalesce(sum(p.total_cents), 0) from purchases p where p.supplier_id = ${suppliers.id} and p.status = 'RECEIVED')`.mapWith(Number),
      lastDate: sql<string | null>`(select max(p.invoice_date)::text from purchases p where p.supplier_id = ${suppliers.id})`,
    })
    .from(suppliers)
    .where(opts.activeOnly ? eq(suppliers.isActive, true) : undefined)
    .orderBy(asc(suppliers.name))
}

export async function saveSupplier(input: SupplierInput, id?: string) {
  const values = {
    name: input.name.trim().slice(0, 160),
    kind: input.kind,
    country: input.country.toUpperCase().slice(0, 2),
    vatNumber: input.vatNumber?.trim() || null,
    vatTreatment: input.vatTreatment,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    address: input.address?.trim() || null,
    note: input.note?.trim() || null,
    isActive: input.isActive ?? true,
  }
  if (!values.name) throw new FinanceError('Give the supplier a name.')
  if (id) {
    const [s] = await db.update(suppliers).set(values).where(eq(suppliers.id, id)).returning()
    if (!s) throw new FinanceError('That supplier no longer exists.')
    return s
  }
  const [s] = await db.insert(suppliers).values(values).returning()
  return s
}

/** The usual VAT for a supplier from their country. */
export function suggestedTreatment(country: string): VatTreatment {
  const EU = ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
  const c = country.toUpperCase()
  if (c === 'CY') return 'DOMESTIC'
  if (EU.includes(c)) return 'EU_REVERSE'
  return 'IMPORT'
}

/* ========================================================== arithmetic == */

export type LineForCost = { quantity: number; freeQuantity: number; lineNetCents: number }

/**
 * Share shipping and fees by value and give each line its landed unit cost.
 * With no priced goods at all (only free goods), shares by units instead.
 */
export function landedCosts(lines: LineForCost[], extrasCents: number): number[] {
  const goods = lines.reduce((n, l) => n + Math.max(0, l.lineNetCents), 0)
  const units = lines.reduce((n, l) => n + l.quantity + l.freeQuantity, 0)
  return lines.map((l) => {
    const u = l.quantity + l.freeQuantity
    if (u <= 0) return 0
    const share = goods > 0 ? (extrasCents * Math.max(0, l.lineNetCents)) / goods : units > 0 ? (extrasCents * u) / units : 0
    return (Math.max(0, l.lineNetCents) + share) / u
  })
}

export type PurchaseTotals = {
  goodsNetCents: number
  vatCents: number
  reverseVatCents: number
  totalCents: number
}

/**
 * DOMESTIC: VAT as on the invoice (or worked out at the rate when not given).
 * EU_REVERSE: no VAT paid; the reverse charge is worked out at the rate.
 * IMPORT: the import VAT paid, as entered.
 * NONE: no VAT.
 */
export function purchaseTotals(p: {
  vatTreatment: VatTreatment
  vatRateBp: number
  lines: { lineNetCents: number }[]
  shippingCents: number
  otherFeesCents: number
  vatCents?: number | null
}): PurchaseTotals {
  const goodsNetCents = p.lines.reduce((n, l) => n + l.lineNetCents, 0)
  const base = goodsNetCents + p.shippingCents + p.otherFeesCents
  let vatCents = 0
  let reverseVatCents = 0
  if (p.vatTreatment === 'DOMESTIC') vatCents = p.vatCents ?? vatOn(base, p.vatRateBp)
  else if (p.vatTreatment === 'IMPORT') vatCents = p.vatCents ?? 0
  else if (p.vatTreatment === 'EU_REVERSE') reverseVatCents = vatOn(base, p.vatRateBp)
  return { goodsNetCents, vatCents, reverseVatCents, totalCents: base + vatCents }
}

/* ============================================================ purchases == */

export type PurchaseInput = {
  supplierId: string
  supplierInvoiceNo?: string | null
  invoiceDate: string
  vatTreatment: VatTreatment
  vatRateBp?: number
  shippingCents: number
  otherFeesCents: number
  /** Null: work it out (DOMESTIC) or none (IMPORT). */
  vatCents?: number | null
  note?: string | null
  lines: {
    variantId: string | null
    description?: string | null
    quantity: number
    freeQuantity?: number
    unitNetCents: number
  }[]
}

async function lineDetails(variantIds: string[]) {
  if (variantIds.length === 0) return new Map<string, { sku: string; label: string }>()
  const rows = await db
    .select({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds))
  return new Map(rows.map((r) => [r.id, { sku: r.sku, label: variantLabel(r) }]))
}

/** Create a draft, or change one. Only drafts can be changed. */
export async function savePurchase(input: PurchaseInput, by: string, id?: string) {
  if (!isVatTreatment(input.vatTreatment)) throw new FinanceError('Choose how VAT works on this invoice.')
  await assertOpen(input.invoiceDate)
  const lines = input.lines.filter((l) => l.quantity > 0 || (l.freeQuantity ?? 0) > 0)
  if (lines.length === 0) throw new FinanceError('Add at least one product.')
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 0 || !Number.isInteger(l.freeQuantity ?? 0) || (l.freeQuantity ?? 0) < 0) {
      throw new FinanceError('Quantities are whole numbers.')
    }
    if (!Number.isInteger(l.unitNetCents) || l.unitNetCents < 0) throw new FinanceError('Prices cannot be negative.')
    if (!l.variantId && !l.description?.trim()) throw new FinanceError('Every line needs a product.')
  }
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const vatRateBp = input.vatRateBp ?? vat_rate_bp
  const details = await lineDetails(lines.map((l) => l.variantId).filter((v): v is string => Boolean(v)))
  const prepared = lines.map((l, i) => ({
    variantId: l.variantId,
    description: (l.variantId ? details.get(l.variantId)?.label : null) ?? l.description?.trim() ?? 'Item',
    sku: l.variantId ? (details.get(l.variantId)?.sku ?? null) : null,
    quantity: l.quantity,
    freeQuantity: l.freeQuantity ?? 0,
    unitNetCents: l.unitNetCents,
    lineNetCents: l.quantity * l.unitNetCents,
    position: i,
  }))
  const totals = purchaseTotals({
    vatTreatment: input.vatTreatment,
    vatRateBp,
    lines: prepared,
    shippingCents: input.shippingCents,
    otherFeesCents: input.otherFeesCents,
    vatCents: input.vatCents,
  })
  const head = {
    supplierId: input.supplierId,
    supplierInvoiceNo: input.supplierInvoiceNo?.trim() || null,
    invoiceDate: input.invoiceDate,
    vatTreatment: input.vatTreatment,
    vatRateBp,
    shippingCents: input.shippingCents,
    otherFeesCents: input.otherFeesCents,
    note: input.note?.trim() || null,
    ...totals,
    updatedAt: new Date(),
  }

  return db.transaction(async (tx) => {
    let purchaseId = id
    if (id) {
      const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update')
      if (!p) throw new FinanceError('That purchase no longer exists.')
      if (p.status !== 'DRAFT') throw new FinanceError('Only a draft can be changed. Undo the receipt first.')
      await assertOpen(p.invoiceDate)
      await tx.update(purchases).set(head).where(eq(purchases.id, id))
      await tx.delete(purchaseLines).where(eq(purchaseLines.purchaseId, id))
    } else {
      const [p] = await tx
        .insert(purchases)
        .values({ ...head, number: await nextNumber(tx, 'purchases', 'P', input.invoiceDate), status: 'DRAFT', createdBy: by })
        .returning({ id: purchases.id })
      purchaseId = p.id
    }
    await tx.insert(purchaseLines).values(prepared.map((l) => ({ ...l, purchaseId: purchaseId! })))
    return purchaseId!
  })
}

export async function getPurchase(id: string) {
  const [row] = await db
    .select({ purchase: purchases, supplier: suppliers })
    .from(purchases)
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(eq(purchases.id, id))
  if (!row) return null
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id)).orderBy(asc(purchaseLines.position))
  return { ...row, lines }
}

/** Goods arrived: add the stock at its landed cost. */
export async function receivePurchase(id: string, by: string, receivedOn?: string) {
  const results = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update')
    if (!p) throw new FinanceError('That purchase no longer exists.')
    if (p.status === 'RECEIVED') throw new FinanceError('This purchase was received already.')
    if (p.status !== 'DRAFT') throw new FinanceError('A cancelled purchase cannot be received.')
    await assertOpen(p.invoiceDate)
    const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id)).orderBy(asc(purchaseLines.position))
    /* Shipping and fees are shared over the lines that are stock; a line
       without a product (a service) simply carries its own price. */
    const landed = landedCosts(lines, p.shippingCents + p.otherFeesCents)
    const at = receivedOn ? new Date(`${receivedOn}T12:00:00Z`) : new Date()
    const out = []
    for (const [i, l] of lines.entries()) {
      await tx.update(purchaseLines).set({ landedUnitCents: landed[i] }).where(eq(purchaseLines.id, l.id))
      if (!l.variantId) continue
      const units = l.quantity + l.freeQuantity
      if (units <= 0) continue
      out.push(
        await applyMovement(tx, {
          variantId: l.variantId,
          delta: units,
          kind: 'PURCHASE',
          unitCostCents: landed[i],
          refType: 'purchase',
          refId: p.id,
          note: `${p.number}${p.supplierInvoiceNo ? `, supplier invoice ${p.supplierInvoiceNo}` : ''}`,
          occurredAt: at,
          by,
        }),
      )
    }
    await tx.update(purchases).set({ status: 'RECEIVED', receivedAt: at, updatedAt: new Date() }).where(eq(purchases.id, id))
    return out
  })
  await announceRestocks(results)
}

/** Back to draft, taking its stock and cost back out. */
export async function undoReceive(id: string, by: string) {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, id)).for('update')
    if (!p || p.status !== 'RECEIVED') throw new FinanceError('Only a received purchase can be undone.')
    await assertOpen(p.invoiceDate)
    const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id))
    for (const l of lines) {
      if (!l.variantId) continue
      const units = l.quantity + l.freeQuantity
      if (units <= 0) continue
      const [inv] = await tx.select({ onHand: inventory.onHand, reserved: inventory.reserved }).from(inventory).where(eq(inventory.variantId, l.variantId))
      if (!inv || inv.onHand - inv.reserved < units) {
        throw new FinanceError(`${l.description}: ${units} came in but only ${Math.max(0, (inv?.onHand ?? 0) - (inv?.reserved ?? 0))} are left, so this cannot be undone. Record a stock count instead.`)
      }
      await applyMovement(tx, {
        variantId: l.variantId,
        delta: -units,
        kind: 'PURCHASE_UNDO',
        undoOfCost: l.landedUnitCents ?? 0,
        refType: 'purchase',
        refId: p.id,
        note: `Undo ${p.number}`,
        by,
      })
    }
    await tx.update(purchases).set({ status: 'DRAFT', receivedAt: null, updatedAt: new Date() }).where(eq(purchases.id, id))
  })
}

export async function setPurchasePaid(id: string, paid: { on: string; method: string } | null) {
  const [p] = await db.select().from(purchases).where(eq(purchases.id, id))
  if (!p) throw new FinanceError('That purchase no longer exists.')
  await db
    .update(purchases)
    .set(paid ? { paidAt: new Date(`${paid.on}T12:00:00Z`), paymentMethod: paid.method, updatedAt: new Date() } : { paidAt: null, paymentMethod: null, updatedAt: new Date() })
    .where(eq(purchases.id, id))
}

/** A draft can be deleted; nothing else. */
export async function deletePurchase(id: string) {
  const [p] = await db.select().from(purchases).where(eq(purchases.id, id))
  if (!p) return
  if (p.status !== 'DRAFT') throw new FinanceError('Only a draft can be deleted. Undo the receipt first.')
  await assertOpen(p.invoiceDate)
  await db.delete(purchases).where(eq(purchases.id, id))
}

export type PurchaseFilter = { from?: string; to?: string; supplierId?: string; status?: string; q?: string; unpaid?: boolean; page?: number }

export async function listPurchases(f: PurchaseFilter) {
  const conds = []
  if (f.from) conds.push(gte(purchases.invoiceDate, f.from))
  if (f.to) conds.push(lt(purchases.invoiceDate, f.to))
  if (f.supplierId) conds.push(eq(purchases.supplierId, f.supplierId))
  if (f.status) conds.push(eq(purchases.status, f.status))
  if (f.unpaid) conds.push(isNull(purchases.paidAt), sql`${purchases.status} <> 'CANCELLED'`)
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`
    conds.push(or(ilike(purchases.number, like), ilike(purchases.supplierInvoiceNo, like), ilike(suppliers.name, like))!)
  }
  const where = conds.length ? and(...conds) : undefined
  const page = Math.max(1, f.page ?? 1)
  const PER = 50
  const [rows, [agg]] = await Promise.all([
    db
      .select({
        purchase: purchases,
        supplierName: suppliers.name,
        units: sql<number>`(select coalesce(sum(l.quantity + l.free_quantity), 0) from purchase_lines l where l.purchase_id = ${purchases.id})`.mapWith(Number),
        files: sql<number>`(select count(*) from attachments a where a.owner_type = 'purchase' and a.owner_id = ${purchases.id})`.mapWith(Number),
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(where)
      .orderBy(desc(purchases.invoiceDate), desc(purchases.number))
      .limit(PER)
      .offset((page - 1) * PER),
    db
      .select({
        n: sql<number>`count(*)::int`,
        goods: sql<number>`coalesce(sum(${purchases.goodsNetCents}) filter (where ${purchases.status} <> 'CANCELLED'), 0)`.mapWith(Number),
        extras: sql<number>`coalesce(sum(${purchases.shippingCents} + ${purchases.otherFeesCents}) filter (where ${purchases.status} <> 'CANCELLED'), 0)`.mapWith(Number),
        vat: sql<number>`coalesce(sum(${purchases.vatCents} + ${purchases.reverseVatCents}) filter (where ${purchases.status} <> 'CANCELLED'), 0)`.mapWith(Number),
        total: sql<number>`coalesce(sum(${purchases.totalCents}) filter (where ${purchases.status} <> 'CANCELLED'), 0)`.mapWith(Number),
        unpaid: sql<number>`coalesce(sum(${purchases.totalCents}) filter (where ${purchases.paidAt} is null and ${purchases.status} <> 'CANCELLED'), 0)`.mapWith(Number),
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(where),
  ])
  return { rows, total: agg.n, totals: agg, page, pages: Math.max(1, Math.ceil(agg.n / PER)) }
}

/** "Repeat last order": the supplier's latest purchase lines, last prices. */
export async function lastPurchaseFor(supplierId: string) {
  const [p] = await db
    .select()
    .from(purchases)
    .where(and(eq(purchases.supplierId, supplierId), sql`${purchases.status} <> 'CANCELLED'`))
    .orderBy(desc(purchases.invoiceDate), desc(purchases.createdAt))
    .limit(1)
  if (!p) return null
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, p.id)).orderBy(asc(purchaseLines.position))
  return { purchase: p, lines }
}

/** What one variant cost, purchase by purchase: the supplier's price history. */
export async function priceHistory(variantId: string) {
  return db
    .select({
      purchaseId: purchases.id,
      number: purchases.number,
      date: purchases.invoiceDate,
      status: purchases.status,
      supplier: suppliers.name,
      quantity: purchaseLines.quantity,
      freeQuantity: purchaseLines.freeQuantity,
      unitNetCents: purchaseLines.unitNetCents,
      landedUnitCents: purchaseLines.landedUnitCents,
      shippingCents: purchases.shippingCents,
    })
    .from(purchaseLines)
    .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
    .where(and(eq(purchaseLines.variantId, variantId), sql`${purchases.status} <> 'CANCELLED'`))
    .orderBy(desc(purchases.invoiceDate))
    .limit(200)
}

/** Every variant that has been bought, for the price history picker. */
export async function boughtVariants() {
  return db
    .selectDistinct({ variantId: productVariants.id, sku: productVariants.sku, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
    .from(purchaseLines)
    .innerJoin(productVariants, eq(productVariants.id, purchaseLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
}

/* ======================================================= importing rows == */

export type ImportedLine = {
  row: number
  variantId: string | null
  sku: string
  label: string
  quantity: number
  freeQuantity: number
  unitNetCents: number
  problem?: string
}

/**
 * Turn a supplier's list (pasted from Excel, a CSV or an .xlsx) into
 * purchase lines. Columns are found by their headers (SKU or code, quantity,
 * price, free) or else taken as SKU, quantity, price, free in that order.
 * Products are matched by our SKU or by the supplier's own code saved on
 * the product, so the supplier's invoice rows can be pasted as they are.
 */
export async function importLines(rows: Rows): Promise<ImportedLine[]> {
  if (rows.length === 0) return []
  const { cols, hasHeader } = pickColumns(
    rows[0],
    {
      sku: ['sku', 'code', 'κωδ', 'артикул', 'product code', 'item'],
      qty: ['qty', 'quantity', 'ποσ', 'кол', 'units', 'pcs'],
      price: ['price', 'unit price', 'unitprice', 'cost', 'τιμ', 'цена', 'net'],
      free: ['free', 'bonus', 'δωρε', 'бесплат', 'foc'],
    },
    { sku: 0, qty: 1, price: 2, free: 3 },
  )
  const body = hasHeader ? rows.slice(1) : rows
  const all = await db
    .select({ id: productVariants.id, sku: productVariants.sku, supplierCode: productVariants.supplierCode, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
  const key = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const bySku = new Map(all.map((v) => [key(v.sku), v]))
  for (const v of all) if (v.supplierCode && !bySku.has(key(v.supplierCode))) bySku.set(key(v.supplierCode), v)
  return body.map((r, i) => {
    const sku = (r[cols.sku] ?? '').trim()
    const qty = parseNumber(r[cols.qty])
    const price = parseNumber(r[cols.price])
    const free = cols.free >= 0 ? parseNumber(r[cols.free]) : 0
    const v = bySku.get(key(sku))
    const line: ImportedLine = {
      row: i + (hasHeader ? 2 : 1),
      variantId: v?.id ?? null,
      sku,
      label: v ? variantLabel(v) : sku,
      quantity: Number.isFinite(qty) ? Math.round(qty) : 0,
      freeQuantity: Number.isFinite(free) ? Math.max(0, Math.round(free)) : 0,
      unitNetCents: Number.isFinite(price) ? Math.round(price * 100) : 0,
    }
    if (!v) line.problem = sku ? `No product with code ${sku}. Save it as the supplier code on the product, then try again.` : 'No code'
    else if (!Number.isFinite(qty) || qty <= 0) line.problem = 'No quantity'
    else if (!Number.isFinite(price)) line.problem = 'No price'
    return line
  })
}

/* ========================================================== opening stock == */

export type OpeningRow = { row: number; variantId: string | null; sku: string; label: string; quantity: number; unitCostCents: number; problem?: string }

/** Read the filled opening stock template: SKU, quantity, unit cost. */
export async function readOpening(rows: Rows): Promise<OpeningRow[]> {
  if (rows.length === 0) return []
  const { cols, hasHeader } = pickColumns(
    rows[0],
    { sku: ['sku', 'code'], qty: ['countedquantity', 'quantity', 'qty', 'stock', 'onhand'], cost: ['unitcost', 'cost', 'price'] },
    { sku: 0, qty: 3, cost: 4 },
  )
  const body = hasHeader ? rows.slice(1) : rows
  const all = await db
    .select({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
  const bySku = new Map(all.map((v) => [v.sku.toLowerCase(), v]))
  return body
    .map((r, i) => {
      const sku = (r[cols.sku] ?? '').trim()
      const qty = parseNumber(r[cols.qty])
      const cost = parseNumber(r[cols.cost])
      const v = bySku.get(sku.toLowerCase())
      const out: OpeningRow = {
        row: i + (hasHeader ? 2 : 1),
        variantId: v?.id ?? null,
        sku,
        label: v ? variantLabel(v) : sku,
        quantity: Number.isFinite(qty) ? Math.round(qty) : -1,
        unitCostCents: Number.isFinite(cost) ? Math.round(cost * 100) : -1,
      }
      if (!v) out.problem = sku ? `No product with SKU ${sku}` : 'No SKU'
      else if (out.quantity < 0) out.problem = 'No quantity'
      else if (out.unitCostCents < 0) out.problem = 'No cost'
      return out
    })
    .filter((r) => r.sku || r.quantity >= 0)
}

/** Set the stock and the cost of every row to what was counted. */
export async function applyOpening(rows: OpeningRow[], by: string) {
  const good = rows.filter((r) => !r.problem && r.variantId)
  const results = await db.transaction(async (tx) => {
    const out = []
    for (const r of good) {
      const [inv] = await tx.select({ onHand: inventory.onHand }).from(inventory).where(eq(inventory.variantId, r.variantId!))
      out.push(
        await applyMovement(tx, {
          variantId: r.variantId!,
          delta: r.quantity - (inv?.onHand ?? 0),
          kind: 'OPENING',
          setAverageTo: r.unitCostCents,
          note: `Opening stock: ${r.quantity} at ${(r.unitCostCents / 100).toFixed(2)}`,
          occurredAt: new Date(`${todayCy()}T00:00:00Z`),
          by,
        }),
      )
    }
    return out
  })
  await announceRestocks(results)
  return { applied: good.length, skipped: rows.length - good.length }
}
