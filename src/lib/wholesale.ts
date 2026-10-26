/* ============================================================================
 * Wholesale: selling to shops and gyms.
 *
 * Prices for a retailer are BEFORE VAT, chosen in this order:
 *   1. the retailer's own price for that product
 *   2. the general wholesale price for that product
 *   3. the website price, less VAT, less the retailer's default discount
 * The price can still be changed on the sale itself.
 *
 * Making a sale takes the stock, records what it cost, and issues the
 * invoice straight away (same numbering as the shop's invoices). A retailer
 * on credit has a due date; payments are recorded as they arrive, and an
 * overdue invoice gets a reminder email (at most three, a week apart).
 * Goods given back, or a discount after the fact, are a credit note.
 * ========================================================================== */

import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { invoices, productVariants, products, retailers, wholesaleLines, wholesalePayments, wholesalePrices, wholesaleSales, type InvoiceLine, type InvoiceParty } from '@/db/schema'
import { getSettings } from '@/lib/settings'
import { applyMovement, announceRestocks, costsOf, variantLabel } from '@/lib/stock'
import { addDays, assertOpen, FinanceError, nextNumber, todayCy, vatOn } from '@/lib/finance'
import { insertWholesaleCreditNote, insertWholesaleInvoice, sellerParty } from '@/lib/invoices'

export type Retailer = typeof retailers.$inferSelect
export type WholesaleSale = typeof wholesaleSales.$inferSelect

/* =========================================================== retailers == */

export type RetailerInput = {
  name: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  vatNumber?: string | null
  taxId?: string | null
  address?: string | null
  country: string
  vatTreatment: 'DOMESTIC' | 'EU_ZERO'
  defaultDiscountPercent: number
  paymentTermsDays: number
  note?: string | null
  isActive?: boolean
}

export async function saveRetailer(input: RetailerInput, id?: string) {
  const values = {
    name: input.name.trim().slice(0, 160),
    contactName: input.contactName?.trim() || null,
    email: input.email?.trim().toLowerCase() || null,
    phone: input.phone?.trim() || null,
    vatNumber: input.vatNumber?.trim() || null,
    taxId: input.taxId?.trim() || null,
    address: input.address?.trim() || null,
    country: input.country.toUpperCase().slice(0, 2) || 'CY',
    vatTreatment: input.vatTreatment,
    defaultDiscountPercent: Math.min(90, Math.max(0, input.defaultDiscountPercent)),
    paymentTermsDays: Math.min(365, Math.max(0, Math.round(input.paymentTermsDays))),
    note: input.note?.trim() || null,
    isActive: input.isActive ?? true,
  }
  if (!values.name) throw new FinanceError('Give the retailer a name.')
  if (values.vatTreatment === 'EU_ZERO' && !values.vatNumber) throw new FinanceError('A 0% EU sale needs the retailer’s VAT number.')
  if (id) {
    const [r] = await db.update(retailers).set(values).where(eq(retailers.id, id)).returning()
    if (!r) throw new FinanceError('That retailer no longer exists.')
    return r
  }
  const [r] = await db.insert(retailers).values(values).returning()
  return r
}

export async function listRetailers() {
  return db
    .select({
      retailer: retailers,
      sales: sql<number>`(select count(*) from wholesale_sales s where s.retailer_id = ${retailers.id})`.mapWith(Number),
      netCents: sql<number>`(select coalesce(sum(s.net_cents), 0) from wholesale_sales s where s.retailer_id = ${retailers.id})`.mapWith(Number),
    })
    .from(retailers)
    .orderBy(asc(retailers.name))
}

export async function getRetailer(id: string) {
  const [r] = await db.select().from(retailers).where(eq(retailers.id, id))
  return r ?? null
}

/* -------------------------------------------------------------- prices -- */

export async function pricesFor(retailerId: string | null) {
  return db
    .select({ variantId: wholesalePrices.variantId, unitNetCents: wholesalePrices.unitNetCents })
    .from(wholesalePrices)
    .where(retailerId ? eq(wholesalePrices.retailerId, retailerId) : isNull(wholesalePrices.retailerId))
}

/** Set (or clear with null) a fixed wholesale price, before VAT. */
export async function setPrice(retailerId: string | null, variantId: string, unitNetCents: number | null) {
  const match = and(eq(wholesalePrices.variantId, variantId), retailerId ? eq(wholesalePrices.retailerId, retailerId) : isNull(wholesalePrices.retailerId))
  if (unitNetCents === null) {
    await db.delete(wholesalePrices).where(match)
    return
  }
  if (!Number.isInteger(unitNetCents) || unitNetCents < 0) throw new FinanceError('Prices cannot be negative.')
  const [existing] = await db.select({ id: wholesalePrices.id }).from(wholesalePrices).where(match)
  if (existing) await db.update(wholesalePrices).set({ unitNetCents, updatedAt: new Date() }).where(eq(wholesalePrices.id, existing.id))
  else await db.insert(wholesalePrices).values({ retailerId, variantId, unitNetCents })
}

/** The pure rule, kept apart so it can be tested on its own. */
export function wholesalePrice(args: { own?: number; general?: number; retailGrossCents: number; vatRateBp: number; discountPercent: number }) {
  if (args.own !== undefined) return { unitNetCents: args.own, source: 'retailer' as const }
  if (args.general !== undefined) return { unitNetCents: args.general, source: 'general' as const }
  const net = args.retailGrossCents / (1 + args.vatRateBp / 10_000)
  return { unitNetCents: Math.round(net * (1 - args.discountPercent / 100)), source: 'discount' as const }
}

/** The price list for one retailer: every active variant with its price. */
export async function priceList(retailerId: string) {
  const r = await getRetailer(retailerId)
  if (!r) throw new FinanceError('That retailer no longer exists.')
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const [own, general, variants] = await Promise.all([
    pricesFor(retailerId),
    pricesFor(null),
    db
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        size: productVariants.size,
        colorName: productVariants.colorName,
        productName: products.name,
        retailGrossCents: sql<number>`coalesce(${productVariants.priceCentsOverride}, ${products.priceCents})`.mapWith(Number),
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.isActive, true))
      .orderBy(sql`${products.name}->>'en'`, productVariants.position),
  ])
  const ownM = new Map(own.map((p) => [p.variantId, p.unitNetCents]))
  const genM = new Map(general.map((p) => [p.variantId, p.unitNetCents]))
  const costs = await costsOf(variants.map((v) => v.variantId))
  return variants.map((v) => ({
    ...v,
    label: variantLabel(v),
    ownCents: ownM.get(v.variantId) ?? null,
    generalCents: genM.get(v.variantId) ?? null,
    avgCostCents: costs.get(v.variantId) ?? 0,
    ...wholesalePrice({
      own: ownM.get(v.variantId),
      general: genM.get(v.variantId),
      retailGrossCents: v.retailGrossCents,
      vatRateBp: vat_rate_bp,
      discountPercent: r.defaultDiscountPercent,
    }),
  }))
}

/* =============================================================== sales == */

function party(r: Retailer): InvoiceParty {
  return {
    name: r.name,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    vatNumber: r.vatNumber ?? undefined,
    taxId: r.taxId ?? undefined,
    address: (r.address ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  }
}

export type SaleInput = {
  retailerId: string
  saleDate: string
  lines: { variantId: string; quantity: number; unitNetCents: number }[]
  note?: string | null
  /** Paid at once (upfront retailers): how. */
  paidNow?: { method: string } | null
}

export async function createSale(input: SaleInput, by: string) {
  await assertOpen(input.saleDate)
  const r = await getRetailer(input.retailerId)
  if (!r) throw new FinanceError('That retailer no longer exists.')
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (lines.length === 0) throw new FinanceError('Add at least one product.')
  for (const l of lines) {
    if (!Number.isInteger(l.quantity)) throw new FinanceError('Quantities are whole numbers.')
    if (!Number.isInteger(l.unitNetCents) || l.unitNetCents < 0) throw new FinanceError('Prices cannot be negative.')
  }
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const rate = r.vatTreatment === 'EU_ZERO' ? 0 : vat_rate_bp
  const variants = await db
    .select({ id: productVariants.id, sku: productVariants.sku, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, lines.map((l) => l.variantId)))
  const vMap = new Map(variants.map((v) => [v.id, v]))
  const netCents = lines.reduce((n, l) => n + l.quantity * l.unitNetCents, 0)
  const vatCents = vatOn(netCents, rate)
  const dueDate = addDays(input.saleDate, r.paymentTermsDays)
  const issuedAt = input.saleDate === todayCy() ? new Date() : new Date(`${input.saleDate}T12:00:00Z`)

  const seller = await sellerParty()
  const { saleId, results } = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'wholesale_sales', 'WS', input.saleDate)
    const costs = await costsOf(lines.map((l) => l.variantId), tx)
    const [sale] = await tx
      .insert(wholesaleSales)
      .values({
        number,
        retailerId: r.id,
        saleDate: input.saleDate,
        dueDate,
        vatTreatment: r.vatTreatment,
        vatRateBp: rate,
        netCents,
        vatCents,
        totalCents: netCents + vatCents,
        costCents: Math.round(lines.reduce((n, l) => n + l.quantity * (costs.get(l.variantId) ?? 0), 0)),
        note: input.note?.trim() || null,
        createdBy: by,
      })
      .returning()
    const results = []
    for (const [i, l] of lines.entries()) {
      const v = vMap.get(l.variantId)
      if (!v) throw new FinanceError('A product on this sale no longer exists.')
      await tx.insert(wholesaleLines).values({
        saleId: sale.id,
        variantId: l.variantId,
        description: variantLabel(v),
        sku: v.sku,
        quantity: l.quantity,
        unitNetCents: l.unitNetCents,
        lineNetCents: l.quantity * l.unitNetCents,
        unitCostCents: costs.get(l.variantId) ?? 0,
        position: i,
      })
      results.push(
        await applyMovement(tx, {
          variantId: l.variantId,
          delta: -l.quantity,
          kind: 'WHOLESALE',
          refType: 'wholesale',
          refId: sale.id,
          note: `${number}, ${r.name}`,
          occurredAt: issuedAt,
          by,
        }),
      )
    }
    const invLines: InvoiceLine[] = lines.map((l) => {
      const v = vMap.get(l.variantId)!
      return { description: variantLabel(v), sku: v.sku, quantity: l.quantity, unitCents: l.unitNetCents, totalCents: l.quantity * l.unitNetCents }
    })
    const terms = r.paymentTermsDays > 0 ? `Payment due within ${r.paymentTermsDays} days, by ${dueDate}.` : null
    const zero = r.vatTreatment === 'EU_ZERO' ? 'Intra community supply, VAT 0%. Reverse charge: VAT to be accounted for by the customer (Article 138, Directive 2006/112/EC).' : null
    await insertWholesaleInvoice(tx, {
      seller,
      saleId: sale.id,
      saleNumber: number,
      issuedAt,
      dueAt: r.paymentTermsDays > 0 ? new Date(`${dueDate}T12:00:00Z`) : null,
      customer: party(r),
      lines: invLines,
      netCents,
      vatCents,
      vatRateBp: rate,
      paymentMethod: input.paidNow?.method ?? (r.paymentTermsDays > 0 ? 'credit' : 'bank'),
      note: [zero, terms, input.note?.trim()].filter(Boolean).join('\n'),
    })
    if (input.paidNow) {
      await tx.insert(wholesalePayments).values({ saleId: sale.id, amountCents: netCents + vatCents, method: input.paidNow.method, paidOn: input.saleDate, createdBy: by })
    }
    return { saleId: sale.id, results }
  })
  void results
  return saleId
}

export type SaleBalance = { totalCents: number; creditedCents: number; paidCents: number; dueCents: number }

export const balanceOf = (b: { totalCents: number; creditedCents: number; paidCents: number }): SaleBalance => ({
  ...b,
  dueCents: Math.max(0, b.totalCents - b.creditedCents - b.paidCents),
})

const creditedSql = sql<number>`(select coalesce(sum(i.total_cents), 0) from invoices i where i.wholesale_sale_id = ${wholesaleSales.id} and i.kind = 'CREDIT_NOTE')`.mapWith(Number)
const paidSql = sql<number>`(select coalesce(sum(p.amount_cents), 0) from wholesale_payments p where p.sale_id = ${wholesaleSales.id})`.mapWith(Number)

export async function listSales(f: { retailerId?: string; from?: string; to?: string; open?: boolean; overdue?: boolean }) {
  const conds = []
  if (f.retailerId) conds.push(eq(wholesaleSales.retailerId, f.retailerId))
  if (f.from) conds.push(gte(wholesaleSales.saleDate, f.from))
  if (f.to) conds.push(lt(wholesaleSales.saleDate, f.to))
  const rows = await db
    .select({ sale: wholesaleSales, retailerName: retailers.name, credited: creditedSql, paid: paidSql })
    .from(wholesaleSales)
    .innerJoin(retailers, eq(retailers.id, wholesaleSales.retailerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(wholesaleSales.saleDate), desc(wholesaleSales.number))
    .limit(1000)
  const today = todayCy()
  return rows
    .map((r) => {
      const b = balanceOf({ totalCents: r.sale.totalCents, creditedCents: r.credited, paidCents: r.paid })
      return { ...r, balance: b, overdue: b.dueCents > 0 && r.sale.dueDate < today }
    })
    .filter((r) => (f.open ? r.balance.dueCents > 0 : true) && (f.overdue ? r.overdue : true))
}

export async function getSale(id: string) {
  const [row] = await db
    .select({ sale: wholesaleSales, retailer: retailers, credited: creditedSql, paid: paidSql })
    .from(wholesaleSales)
    .innerJoin(retailers, eq(retailers.id, wholesaleSales.retailerId))
    .where(eq(wholesaleSales.id, id))
  if (!row) return null
  const [lines, payments, docs] = await Promise.all([
    db.select().from(wholesaleLines).where(eq(wholesaleLines.saleId, id)).orderBy(asc(wholesaleLines.position)),
    db.select().from(wholesalePayments).where(eq(wholesalePayments.saleId, id)).orderBy(asc(wholesalePayments.paidOn)),
    db.select().from(invoices).where(eq(invoices.wholesaleSaleId, id)).orderBy(asc(invoices.issuedAt)),
  ])
  const balance = balanceOf({ totalCents: row.sale.totalCents, creditedCents: row.credited, paidCents: row.paid })
  return { ...row, lines, payments, docs, balance, overdue: balance.dueCents > 0 && row.sale.dueDate < todayCy() }
}

export async function recordPayment(saleId: string, p: { amountCents: number; method: string; paidOn: string; note?: string | null }, by: string) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new FinanceError('Enter the amount received.')
  const s = await getSale(saleId)
  if (!s) throw new FinanceError('That sale no longer exists.')
  if (p.amountCents > s.balance.dueCents) throw new FinanceError(`Only ${(s.balance.dueCents / 100).toFixed(2)} is still due.`)
  await db.insert(wholesalePayments).values({ saleId, amountCents: p.amountCents, method: p.method, paidOn: p.paidOn, note: p.note?.trim() || null, createdBy: by })
}

export async function deletePayment(paymentId: string) {
  await db.delete(wholesalePayments).where(eq(wholesalePayments.id, paymentId))
}

/**
 * A credit note: goods given back (lines with quantities; back into stock at
 * what they cost when sold, if `restock`) and/or an amount off.
 */
export async function creditSale(
  saleId: string,
  input: { lines: { lineId: string; quantity: number }[]; amountNetCents?: number; restock: boolean; reason: string; on: string },
  by: string,
) {
  await assertOpen(input.on)
  const s = await getSale(saleId)
  if (!s) throw new FinanceError('That sale no longer exists.')
  const invoice = s.docs.find((d) => d.kind === 'INVOICE')
  if (!invoice) throw new FinanceError('This sale has no invoice to credit.')
  const byId = new Map(s.lines.map((l) => [l.id, l]))
  const back = input.lines.filter((l) => l.quantity > 0)
  for (const l of back) {
    const line = byId.get(l.lineId)
    if (!line) throw new FinanceError('A line on this credit note is not on the sale.')
    if (!Number.isInteger(l.quantity)) throw new FinanceError('Quantities are whole numbers.')
    /* Units already credited, whether restocked or not, from earlier credit notes. */
    const already = s.docs
      .filter((d) => d.kind === 'CREDIT_NOTE')
      .flatMap((d) => d.lines)
      .filter((x) => x.sku === line.sku && x.description === line.description && x.unitCents === -line.unitNetCents)
      .reduce((n, x) => n + x.quantity, 0)
    if (l.quantity > line.quantity - already) throw new FinanceError(`${line.description}: only ${line.quantity - already} can still be credited.`)
  }
  const amount = Math.max(0, Math.round(input.amountNetCents ?? 0))
  if (back.length === 0 && amount === 0) throw new FinanceError('Choose what to credit: units given back, or an amount.')
  const cnLines: InvoiceLine[] = back.map((l) => {
    const line = byId.get(l.lineId)!
    return { description: line.description, sku: line.sku ?? undefined, quantity: l.quantity, unitCents: -line.unitNetCents, totalCents: -l.quantity * line.unitNetCents }
  })
  if (amount > 0) cnLines.push({ description: input.reason || 'Discount', quantity: 1, unitCents: -amount, totalCents: -amount })
  const netCents = -cnLines.reduce((n, l) => n + l.totalCents, 0)
  const at = input.on === todayCy() ? new Date() : new Date(`${input.on}T12:00:00Z`)
  if (netCents + Math.round((netCents * invoice.vatRateBp) / 10_000) > s.balance.totalCents - s.balance.creditedCents) {
    throw new FinanceError('That is more than is left on this invoice.')
  }

  const results = await db.transaction(async (tx) => {
    await insertWholesaleCreditNote(tx, invoice, { lines: cnLines, netCents, reason: input.reason || 'Credit', at })
    const out = []
    if (input.restock) {
      for (const l of back) {
        const line = byId.get(l.lineId)!
        if (!line.variantId) continue
        await tx
          .update(wholesaleLines)
          .set({ returnedQuantity: sql`${wholesaleLines.returnedQuantity} + ${l.quantity}` })
          .where(eq(wholesaleLines.id, line.id))
        out.push(
          await applyMovement(tx, {
            variantId: line.variantId,
            delta: l.quantity,
            kind: 'WHOLESALE_RETURN',
            unitCostCents: line.unitCostCents,
            refType: 'wholesale',
            refId: saleId,
            note: `Returned on ${s.sale.number}`,
            occurredAt: at,
            by,
          }),
        )
      }
      const backCost = back.reduce((n, l) => n + l.quantity * (byId.get(l.lineId)!.unitCostCents ?? 0), 0)
      await tx
        .update(wholesaleSales)
        .set({ costCents: sql`greatest(0, ${wholesaleSales.costCents} - ${Math.round(backCost)})` })
        .where(eq(wholesaleSales.id, saleId))
    }
    return out
  })
  await announceRestocks(results)
}

/* ------------------------------------------------------------ reminders -- */

export async function sendReminder(saleId: string) {
  const s = await getSale(saleId)
  if (!s) throw new FinanceError('That sale no longer exists.')
  if (!s.retailer.email) throw new FinanceError('This retailer has no email address.')
  if (s.balance.dueCents <= 0) throw new FinanceError('Nothing is due on this sale.')
  const { send, escapeHtml, htmlLayout } = await import('@/lib/email')
  const invoice = s.docs.find((d) => d.kind === 'INVOICE')
  const amount = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(s.balance.dueCents / 100)
  const late = s.sale.dueDate < todayCy()
  const subject = `${late ? 'Overdue' : 'Reminder'}: invoice ${invoice?.number ?? s.sale.number}, ${amount}`
  const text = [
    `Hello ${s.retailer.contactName || s.retailer.name},`,
    '',
    `This is a friendly reminder that invoice ${invoice?.number ?? s.sale.number} of ${s.sale.saleDate} has ${amount} still to pay${late ? `, due on ${s.sale.dueDate}` : ` by ${s.sale.dueDate}`}.`,
    '',
    'If you have paid already, thank you, and please ignore this email.',
  ].join('\n')
  const html = htmlLayout(
    `<p>Hello ${escapeHtml(s.retailer.contactName || s.retailer.name)},</p><p>This is a friendly reminder that invoice <b>${escapeHtml(invoice?.number ?? s.sale.number)}</b> of ${escapeHtml(s.sale.saleDate)} has <b>${escapeHtml(amount)}</b> still to pay${late ? `, due on ${escapeHtml(s.sale.dueDate)}` : ` by ${escapeHtml(s.sale.dueDate)}`}.</p><p>If you have paid already, thank you, and please ignore this email.</p>`,
  )
  const res = await send({ to: s.retailer.email, subject, text, html, kind: 'wholesale_reminder', category: 'transactional', relatedId: saleId })
  await db
    .update(wholesaleSales)
    .set({ lastReminderAt: new Date(), remindersSent: sql`${wholesaleSales.remindersSent} + 1` })
    .where(eq(wholesaleSales.id, saleId))
  return res
}

/** The automation clock: overdue invoices, a week apart, three at most. */
export async function remindOverdue(now = new Date()) {
  const today = todayCy(now)
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000)
  const due = await db
    .select({ id: wholesaleSales.id, last: wholesaleSales.lastReminderAt, sent: wholesaleSales.remindersSent, email: retailers.email })
    .from(wholesaleSales)
    .innerJoin(retailers, eq(retailers.id, wholesaleSales.retailerId))
    .where(and(lt(wholesaleSales.dueDate, today), sql`${wholesaleSales.remindersSent} < 3`, sql`${retailers.email} is not null`))
    .limit(50)
  let sent = 0
  for (const d of due) {
    if (d.last && d.last > weekAgo) continue
    const s = await getSale(d.id)
    if (!s || s.balance.dueCents <= 0) continue
    try {
      await sendReminder(d.id)
      sent++
    } catch (err) {
      console.error('[wholesale] reminder failed', err)
    }
  }
  return sent
}
