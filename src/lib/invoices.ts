/* ============================================================================
 * Invoices and credit notes, for the accountant.
 *
 *  · An order gets its invoice the moment it is paid: a card payment going
 *    through, cash handed over on delivery, or cash taken at the counter.
 *  · A refund issues a credit note against that invoice, for the amount
 *    refunded. Partial refunds made in the Stripe dashboard are covered too.
 *  · Numbers run without gaps per kind and per year (INV-2026-000001,
 *    CN-2026-000001). An invoice is never edited or deleted afterwards.
 *  · ensureInvoices() catches up on anything missed (an order paid before
 *    this existed, or an issue that failed), so the books are always whole.
 * ========================================================================== */

import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { invoices, orderItems, orders, payments, type InvoiceLine, type InvoiceParty } from '@/db/schema'
import { getSettings } from '@/lib/settings'
import { BRAND } from '@/config/brand'

export type Invoice = typeof invoices.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const TZ = 'Europe/Nicosia'
/* Any constant: only invoice numbering takes this lock. */
const NUMBERING_LOCK = 7_311_001

/** Orders that count as sold, once paid (paidAt set). PENDING is a cash order
 *  paid at the counter before staff confirmed it. A late card payment on a
 *  cancelled order is not a sale; it is refunded instead. */
const SOLD = ['PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'REFUNDED'] as const

function yearIn(d: Date) {
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: TZ }).format(d)
}

/** VAT inside a VAT inclusive amount. */
export function vatOf(totalCents: number, rateBp: number) {
  return Math.round((totalCents * rateBp) / (10_000 + rateBp))
}

async function nextNumber(tx: Tx, kind: 'INVOICE' | 'CREDIT_NOTE', at: Date) {
  await tx.execute(sql`select pg_advisory_xact_lock(${NUMBERING_LOCK})`)
  const prefix = `${kind === 'INVOICE' ? 'INV' : 'CN'}-${yearIn(at)}-`
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.kind, kind), ilike(invoices.number, `${prefix}%`)))
  return `${prefix}${String((r?.n ?? 0) + 1).padStart(6, '0')}`
}

export async function sellerParty(): Promise<{ party: InvoiceParty; footer: string }> {
  const s = await getSettings([
    'company_legal_name',
    'company_vat_number',
    'company_tax_id',
    'company_address',
    'invoice_footer',
  ])
  const address = s.company_address
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  /* Until the company details are filled in, fall back to brand.ts, skipping
     its TODO placeholders. */
  const real = (v: string) => (v && !/^TODO/i.test(v) ? v : '')
  const fallbackAddress = BRAND.contact.addressLines.filter((l) => real(l))
  return {
    party: {
      name: s.company_legal_name.trim() || real(BRAND.legal.companyName) || BRAND.name,
      vatNumber: s.company_vat_number.trim() || real(BRAND.legal.vatNumber) || undefined,
      taxId: s.company_tax_id.trim() || undefined,
      address: address.length ? address : fallbackAddress.length ? fallbackAddress : undefined,
      email: BRAND.contact.email,
      phone: BRAND.contact.phone,
    },
    footer: s.invoice_footer,
  }
}

function customerParty(o: typeof orders.$inferSelect): InvoiceParty {
  const a = (o.billingAddress ?? o.shippingAddress) as Record<string, string | undefined> | null
  const address = a
    ? [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.country === 'CY' ? 'Cyprus' : a.country]
        .map((l) => (l ?? '').trim())
        .filter(Boolean)
    : ['Collected in store']
  return { name: o.customerName, email: o.email, phone: o.phone, address }
}

async function invoiceLines(tx: Tx, o: typeof orders.$inferSelect): Promise<InvoiceLine[]> {
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id)).orderBy(asc(orderItems.id))
  const lines: InvoiceLine[] = items.map((i) => ({
    description: [i.productName, i.colorName, i.size].filter(Boolean).join(', '),
    sku: i.sku ?? undefined,
    quantity: i.quantity,
    unitCents: Math.round(i.lineTotalCents / Math.max(1, i.quantity)),
    totalCents: i.lineTotalCents,
  }))
  if (o.promoCodeDiscountCents > 0) {
    const code = (o.promoCodeSnapshot as { code?: string } | null)?.code
    lines.push({
      description: code ? `Promo code ${code}` : 'Promo code',
      quantity: 1,
      unitCents: -o.promoCodeDiscountCents,
      totalCents: -o.promoCodeDiscountCents,
    })
  }
  if (o.deliveryCents > 0 || o.deliveryKind === 'SHIPPING') {
    const name = o.deliveryOptionName?.en ?? (o.deliveryKind === 'SHIPPING' ? 'Delivery' : 'Collection')
    lines.push({ description: `Delivery: ${name}`, quantity: 1, unitCents: o.deliveryCents, totalCents: o.deliveryCents })
  }
  /* The order total is what was charged; if rounding ever leaves the lines a
     cent away from it, say so on the invoice rather than print wrong sums. */
  const sum = lines.reduce((n, l) => n + l.totalCents, 0)
  if (sum !== o.totalCents) {
    lines.push({ description: 'Rounding', quantity: 1, unitCents: o.totalCents - sum, totalCents: o.totalCents - sum })
  }
  return lines
}

/** Issue the invoice for a paid order. Safe to call again: returns the
 *  existing one. Returns null if the order is not (yet) a sale. */
export async function issueInvoice(orderId: string): Promise<Invoice | null> {
  const [existing] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), eq(invoices.kind, 'INVOICE')))
  if (existing) return existing

  const { party: seller, footer } = await sellerParty()
  const { vat_rate_bp: rate } = await getSettings(['vat_rate_bp'])

  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!o || !o.paidAt || !(SOLD as readonly string[]).includes(o.status)) return null
    const [again] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.kind, 'INVOICE')))
    if (again) return again

    const at = o.paidAt
    /* The order recorded its VAT when it was placed; use that, so a rate
       change afterwards does not alter an existing sale. */
    const vat = o.vatCents > 0 || rate === 0 ? o.vatCents : vatOf(o.totalCents, rate)
    const effectiveRate = o.totalCents > vat && vat > 0 ? Math.round((vat * 10_000) / (o.totalCents - vat)) : rate
    const [inv] = await tx
      .insert(invoices)
      .values({
        number: await nextNumber(tx, 'INVOICE', at),
        kind: 'INVOICE',
        orderId: o.id,
        orderNumber: o.orderNumber,
        issuedAt: at,
        currency: o.currency,
        netCents: o.totalCents - vat,
        vatCents: vat,
        totalCents: o.totalCents,
        /* Rounded to the nearest whole percent: 19% stays 19%. */
        vatRateBp: Math.round(effectiveRate / 100) * 100,
        paymentMethod: o.paymentMethod,
        customer: customerParty(o),
        seller,
        lines: await invoiceLines(tx, o),
        note: footer || null,
      })
      .returning()
    return inv
  })
}

/** Credit whatever has been refunded on an order and not credited yet. */
export async function creditRefunds(orderId: string, reason = 'Refund'): Promise<Invoice | null> {
  const invoice = await issueInvoice(orderId)
  if (!invoice) return null

  const [r] = await db
    .select({ refunded: sql<number>`coalesce(sum(${payments.refundedCents}), 0)::int` })
    .from(payments)
    .where(eq(payments.orderId, orderId))
  const refunded = Math.min(r?.refunded ?? 0, invoice.totalCents)

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${NUMBERING_LOCK})`)
    const [c] = await tx
      .select({ credited: sql<number>`coalesce(sum(${invoices.totalCents}), 0)::int` })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.kind, 'CREDIT_NOTE')))
    const amount = refunded - (c?.credited ?? 0)
    if (amount <= 0) return null

    const now = new Date()
    const full = amount === invoice.totalCents
    const vat = full ? invoice.vatCents : vatOf(amount, invoice.vatRateBp)
    const lines: InvoiceLine[] = full
      ? invoice.lines.map((l) => ({ ...l, unitCents: -l.unitCents, totalCents: -l.totalCents }))
      : [{ description: `${reason}, against ${invoice.number}`, quantity: 1, unitCents: -amount, totalCents: -amount }]
    const [cn] = await tx
      .insert(invoices)
      .values({
        number: await nextNumber(tx, 'CREDIT_NOTE', now),
        kind: 'CREDIT_NOTE',
        orderId,
        orderNumber: invoice.orderNumber,
        relatesToId: invoice.id,
        issuedAt: now,
        currency: invoice.currency,
        netCents: amount - vat,
        vatCents: vat,
        totalCents: amount,
        vatRateBp: invoice.vatRateBp,
        paymentMethod: invoice.paymentMethod,
        customer: invoice.customer,
        seller: invoice.seller,
        lines,
        note: `${reason}. Credits invoice ${invoice.number}.`,
      })
      .returning()
    return cn
  })
}

/** Never let accounting break a payment: log, and ensureInvoices() will
 *  catch up the next time the accounting page is opened. */
export async function safely(fn: () => Promise<unknown>, what: string) {
  try {
    await fn()
  } catch (err) {
    console.error(`[invoices] ${what} failed; it will be retried from the accounting page`, err)
  }
}

/** Issue anything missing: invoices for paid orders, credit notes for refunds. */
export async function ensureInvoices() {
  const missing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        isNotNull(orders.paidAt),
        inArray(orders.status, [...SOLD]),
        sql`not exists (select 1 from ${invoices} where ${invoices.orderId} = ${orders.id} and ${invoices.kind} = 'INVOICE')`,
      ),
    )
    .orderBy(asc(orders.paidAt))
  for (const o of missing) await issueInvoice(o.id)

  const refunded = await db
    .select({ orderId: payments.orderId })
    .from(payments)
    .innerJoin(invoices, and(eq(invoices.orderId, payments.orderId), eq(invoices.kind, 'INVOICE')))
    .where(sql`${payments.refundedCents} > 0`)
    .groupBy(payments.orderId)
    .having(
      sql`sum(${payments.refundedCents}) > coalesce((select sum(c.total_cents) from invoices c where c.order_id = ${payments.orderId} and c.kind = 'CREDIT_NOTE'), 0)`,
    )
  for (const r of refunded) await creditRefunds(r.orderId)
  return { invoices: missing.length, creditNotes: refunded.length }
}

/* ============================================================ reading == */

export type InvoiceFilter = {
  from?: string // YYYY-MM-DD, Cyprus time, inclusive
  to?: string // YYYY-MM-DD, Cyprus time, inclusive
  kind?: 'INVOICE' | 'CREDIT_NOTE'
  method?: 'card' | 'cod'
  q?: string
}

/** Midnight in Cyprus at the start of that day, as an instant. */
export function cyprusDayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const utc = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(utc.getTime())) return null
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(utc)
    .find((p) => p.type === 'timeZoneName')?.value
  const m = name?.match(/GMT([+-]\d+)(?::(\d+))?/)
  const offsetMin = m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2] ?? 0) : 0
  return new Date(utc.getTime() - offsetMin * 60_000)
}

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return day
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function where(f: InvoiceFilter) {
  const conds = []
  const from = f.from ? cyprusDayStart(f.from) : null
  const to = f.to ? cyprusDayStart(nextDay(f.to)) : null
  if (from) conds.push(gte(invoices.issuedAt, from))
  if (to) conds.push(lt(invoices.issuedAt, to))
  if (f.kind) conds.push(eq(invoices.kind, f.kind))
  if (f.method) conds.push(eq(invoices.paymentMethod, f.method))
  const q = f.q?.trim()
  if (q) {
    const like = `%${q}%`
    conds.push(
      or(
        ilike(invoices.number, like),
        ilike(invoices.orderNumber, like),
        sql`${invoices.customer}->>'name' ilike ${like}`,
        sql`${invoices.customer}->>'email' ilike ${like}`,
      )!,
    )
  }
  return conds.length ? and(...conds) : undefined
}

export type InvoiceTotals = {
  invoices: number
  creditNotes: number
  net: number
  vat: number
  gross: number
  card: number
  cash: number
}

const signed = (col: typeof invoices.totalCents | typeof invoices.netCents | typeof invoices.vatCents) =>
  sql<number>`coalesce(sum(case when ${invoices.kind} = 'CREDIT_NOTE' then -${col} else ${col} end), 0)::int`

export async function invoiceTotals(f: InvoiceFilter): Promise<InvoiceTotals> {
  const [r] = await db
    .select({
      invoices: sql<number>`count(*) filter (where ${invoices.kind} = 'INVOICE')::int`,
      creditNotes: sql<number>`count(*) filter (where ${invoices.kind} = 'CREDIT_NOTE')::int`,
      net: signed(invoices.netCents),
      vat: signed(invoices.vatCents),
      gross: signed(invoices.totalCents),
      card: sql<number>`coalesce(sum(case when ${invoices.kind} = 'CREDIT_NOTE' then -${invoices.totalCents} else ${invoices.totalCents} end) filter (where ${invoices.paymentMethod} = 'card'), 0)::int`,
      cash: sql<number>`coalesce(sum(case when ${invoices.kind} = 'CREDIT_NOTE' then -${invoices.totalCents} else ${invoices.totalCents} end) filter (where ${invoices.paymentMethod} = 'cod'), 0)::int`,
    })
    .from(invoices)
    .where(where(f))
  return r
}

export const INVOICES_PER_PAGE = 15

export async function listInvoices(f: InvoiceFilter & { page?: number }) {
  const page = Math.max(1, f.page ?? 1)
  const w = where(f)
  const [rows, [{ n }]] = await Promise.all([
    db
      .select()
      .from(invoices)
      .where(w)
      .orderBy(desc(invoices.issuedAt), desc(invoices.number))
      .limit(INVOICES_PER_PAGE)
      .offset((page - 1) * INVOICES_PER_PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(w),
  ])
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / INVOICES_PER_PAGE)) }
}

/** Everything matching, oldest first, for the accountant's export. */
export async function invoicesForExport(f: InvoiceFilter) {
  return db.select().from(invoices).where(where(f)).orderBy(asc(invoices.issuedAt), asc(invoices.number)).limit(50_000)
}

export async function getInvoice(id: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id))
  if (!inv) return null
  const related = await db
    .select({ id: invoices.id, number: invoices.number, kind: invoices.kind, totalCents: invoices.totalCents })
    .from(invoices)
    .where(
      and(
        inv.orderId ? eq(invoices.orderId, inv.orderId) : eq(invoices.wholesaleSaleId, inv.wholesaleSaleId!),
        sql`${invoices.id} <> ${inv.id}`,
      ),
    )
    .orderBy(asc(invoices.issuedAt))
  return { invoice: inv, related }
}

export async function invoicesForOrder(orderId: string) {
  return db
    .select({ id: invoices.id, number: invoices.number, kind: invoices.kind, totalCents: invoices.totalCents, issuedAt: invoices.issuedAt })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(asc(invoices.issuedAt))
}

/* ======================================================== wholesale == */

/**
 * The invoice for a sale to a retailer, in the same numbering as every other
 * invoice. Prices on it are before VAT and VAT is added at the end. Issued
 * when the sale is made (paid or not); the due date says when to pay.
 * Runs inside the sale's own transaction.
 */
export async function insertWholesaleInvoice(
  tx: Tx,
  args: {
    saleId: string
    saleNumber: string
    issuedAt: Date
    dueAt: Date | null
    customer: InvoiceParty
    lines: InvoiceLine[]
    netCents: number
    vatCents: number
    vatRateBp: number
    paymentMethod: string
    note?: string | null
    /** The shop's details, read before the transaction (see checkOpen in
     *  lib/finance.ts for why nothing is read from outside it here). */
    seller?: { party: InvoiceParty; footer: string }
  },
): Promise<Invoice> {
  const { party: seller, footer } = args.seller ?? (await sellerParty())
  const [inv] = await tx
    .insert(invoices)
    .values({
      number: await nextNumber(tx, 'INVOICE', args.issuedAt),
      kind: 'INVOICE',
      orderId: null,
      wholesaleSaleId: args.saleId,
      orderNumber: args.saleNumber,
      issuedAt: args.issuedAt,
      dueAt: args.dueAt,
      linesNet: true,
      netCents: args.netCents,
      vatCents: args.vatCents,
      totalCents: args.netCents + args.vatCents,
      vatRateBp: args.vatRateBp,
      paymentMethod: args.paymentMethod,
      customer: args.customer,
      seller,
      lines: args.lines,
      note: [args.note, footer].filter(Boolean).join('\n') || null,
    })
    .returning()
  return inv
}

/** A credit note against a wholesale invoice (goods back, or a discount). */
export async function insertWholesaleCreditNote(
  tx: Tx,
  invoice: Invoice,
  args: { lines: InvoiceLine[]; netCents: number; reason: string; at: Date },
): Promise<Invoice> {
  const vat = Math.round((args.netCents * invoice.vatRateBp) / 10_000)
  const [cn] = await tx
    .insert(invoices)
    .values({
      number: await nextNumber(tx, 'CREDIT_NOTE', args.at),
      kind: 'CREDIT_NOTE',
      orderId: null,
      wholesaleSaleId: invoice.wholesaleSaleId,
      orderNumber: invoice.orderNumber,
      relatesToId: invoice.id,
      issuedAt: args.at,
      linesNet: true,
      currency: invoice.currency,
      netCents: args.netCents,
      vatCents: vat,
      totalCents: args.netCents + vat,
      vatRateBp: invoice.vatRateBp,
      paymentMethod: invoice.paymentMethod,
      customer: invoice.customer,
      seller: invoice.seller,
      lines: args.lines,
      note: `${args.reason}. Credits invoice ${invoice.number}.`,
    })
    .returning()
  return cn
}

export async function invoicesForWholesale(saleId: string) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.wholesaleSaleId, saleId))
    .orderBy(asc(invoices.issuedAt))
}
