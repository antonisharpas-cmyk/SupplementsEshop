/* ============================================================================
 * The accountant's monthly pack: one ZIP with
 *
 *   AIONIX_<month>_summary.xlsx   profit and loss, VAT, every sales invoice and
 *                                 credit note, purchases and their lines,
 *                                 expenses, stock movements, unpaid retailer
 *                                 invoices, stock value
 *   sales/                        every invoice and credit note, printable
 *   purchases/                    supplier invoices as uploaded
 *   expenses/                     receipts as uploaded
 *   stock/                        photos of damaged or expired goods
 *   README.txt                    what is where
 * ========================================================================== */

import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { expenseCategories, expenses, invoices, purchaseLines, purchases, stockMovements, productVariants, products, suppliers, type InvoiceParty } from '@/db/schema'
import { toXlsx, zip, type Sheet } from '@/lib/spreadsheet'
import { attachmentBytes, attachmentsOf, monthName, monthRange, VAT_TREATMENTS, type VatTreatment } from '@/lib/finance'
import { cyprusDayStart } from '@/lib/invoices'
import { profitAndLoss, stockValueByMonth, vatSummary } from '@/lib/finance-reports'
import { listSales } from '@/lib/wholesale'
import { MOVEMENT_KINDS, variantLabel, type MovementKind } from '@/lib/stock'
import { BRAND } from '@/config/brand'

const eur = (c: number) => Math.round(c) / 100
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const money = (c: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(c / 100)
const day = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Nicosia' }).format(d)

function partyHtml(p: InvoiceParty) {
  return [p.name, ...(p.address ?? []), p.vatNumber ? `VAT ${p.vatNumber}` : '', p.taxId ? `TIC ${p.taxId}` : '', p.email ?? '', p.phone ?? '']
    .filter(Boolean)
    .map((l, i) => (i === 0 ? `<b>${esc(l)}</b>` : esc(l)))
    .join('<br>')
}

/** One invoice or credit note as a page that prints like the one in the admin. */
export function invoiceHtml(inv: typeof invoices.$inferSelect): string {
  const credit = inv.kind === 'CREDIT_NOTE'
  const sign = credit ? -1 : 1
  const rows = inv.lines
    .map((l) => `<tr><td>${esc(l.description)}${l.sku ? `<br><small>${esc(l.sku)}</small>` : ''}</td><td class="n">${l.quantity}</td><td class="n">${money(l.unitCents)}</td><td class="n">${money(l.totalCents)}</td></tr>`)
    .join('')
  const pay = inv.wholesaleSaleId
    ? inv.dueAt
      ? `Payment due by ${day(inv.dueAt)}`
      : 'Payment on delivery'
    : credit
      ? `Refunded by ${inv.paymentMethod === 'cod' ? 'cash' : 'card'}`
      : `Paid with ${inv.paymentMethod === 'cod' ? 'cash' : 'card'}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number)}</title>
<style>body{font-family:Helvetica,Arial,sans-serif;color:#111;max-width:800px;margin:40px auto;padding:0 24px}h1{font-size:28px;margin:0}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:16px}.muted{color:#555;font-size:13px;line-height:1.5}
table{width:100%;border-collapse:collapse;margin-top:24px;font-size:14px}th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#777;border-bottom:1px solid #ddd;padding:8px 6px}
td{border-bottom:1px solid #eee;padding:10px 6px;vertical-align:top}.n{text-align:right;white-space:nowrap}small{color:#888}.tot{margin-left:auto;max-width:300px;margin-top:20px;font-size:14px}
.tot div{display:flex;justify-content:space-between;padding:3px 0}.tot .big{border-top:2px solid #111;font-weight:700;font-size:16px;padding-top:8px}@media print{body{margin:0}}</style></head><body>
<div class="top"><div><h1>${esc(inv.seller.name)}</h1><p class="muted">${partyHtml({ ...inv.seller, name: '' }).replace(/^<b><\/b><br>/, '')}</p></div>
<div style="text-align:right"><p class="muted" style="text-transform:uppercase;letter-spacing:.14em;font-weight:700">${credit ? 'Credit note' : inv.wholesaleSaleId ? 'Invoice' : 'Invoice / Receipt'}</p>
<p style="font-family:monospace;font-size:20px;font-weight:700;margin:4px 0">${esc(inv.number)}</p>
<p class="muted">Date: ${day(inv.issuedAt)}<br>${inv.wholesaleSaleId ? 'Sale' : 'Order'}: ${esc(inv.orderNumber)}<br>${esc(pay)}</p></div></div>
<p class="muted" style="margin-top:20px;text-transform:uppercase;letter-spacing:.14em;font-weight:700">Bill to</p><p class="muted">${partyHtml(inv.customer)}</p>
<table><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Unit${inv.linesNet ? ' (net)' : ''}</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Net</span><span>${money(sign * inv.netCents)}</span></div><div><span>VAT ${inv.vatRateBp / 100}%</span><span>${money(sign * inv.vatCents)}</span></div>
<div class="big"><span>${credit ? 'Total credited' : 'Total'}</span><span>${money(sign * inv.totalCents)}</span></div><p class="muted" style="text-align:right">${inv.linesNet ? 'Prices before VAT' : 'Prices include VAT'}</p></div>
${inv.note ? `<p class="muted" style="margin-top:40px;border-top:1px solid #eee;padding-top:16px;white-space:pre-line">${esc(inv.note)}</p>` : ''}
</body></html>`
}

export async function buildPack(month: string): Promise<{ filename: string; bytes: Buffer }> {
  const { from, toExclusive } = monthRange(month)
  const start = cyprusDayStart(from)!
  const end = cyprusDayStart(toExclusive)!

  const [invs, purs, lines, exps, moves, pl, vat, unpaid, value] = await Promise.all([
    db.select().from(invoices).where(and(gte(invoices.issuedAt, start), lt(invoices.issuedAt, end))).orderBy(asc(invoices.issuedAt), asc(invoices.number)),
    db
      .select({ p: purchases, supplier: suppliers.name, supplierVat: suppliers.vatNumber, country: suppliers.country })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(and(gte(purchases.invoiceDate, from), lt(purchases.invoiceDate, toExclusive), sql`${purchases.status} <> 'CANCELLED'`))
      .orderBy(asc(purchases.invoiceDate), asc(purchases.number)),
    db
      .select({ l: purchaseLines, number: purchases.number })
      .from(purchaseLines)
      .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
      .where(and(gte(purchases.invoiceDate, from), lt(purchases.invoiceDate, toExclusive), sql`${purchases.status} <> 'CANCELLED'`))
      .orderBy(asc(purchases.number), asc(purchaseLines.position)),
    db
      .select({ e: expenses, category: expenseCategories.name })
      .from(expenses)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
      .where(and(gte(expenses.expenseDate, from), lt(expenses.expenseDate, toExclusive)))
      .orderBy(asc(expenses.expenseDate)),
    db
      .select({ m: stockMovements, sku: productVariants.sku, size: productVariants.size, colorName: productVariants.colorName, productName: products.name })
      .from(stockMovements)
      .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(gte(stockMovements.occurredAt, start), lt(stockMovements.occurredAt, end)))
      .orderBy(asc(stockMovements.occurredAt)),
    profitAndLoss([month]),
    vatSummary([month]),
    listSales({ open: true }),
    stockValueByMonth([month]),
  ])

  const g = (m: Map<string, number>) => eur(m.get(month) ?? 0)
  const v = vat[0]
  const summary: Sheet = {
    name: 'Summary',
    columns: [{ header: monthName(month), width: 44 }, { header: 'EUR', kind: 'money', width: 16 }],
    rows: [
      ['Sales, online (net)', g(pl.onlineSales)],
      ['Sales, wholesale (net)', g(pl.wholesaleSales)],
      ['Total sales', g(pl.sales)],
      ['Cost of sales, online', -g(pl.onlineCost)],
      ['Cost of sales, wholesale', -g(pl.wholesaleCost)],
      ['Gross profit', g(pl.grossProfit)],
      ...pl.stockOut.map((s) => [`Stock out without sale: ${MOVEMENT_KINDS[s.kind as MovementKind]?.label ?? s.kind}`, -g(s.byMonth)]),
      ['Stock count differences', g(pl.countDifference)],
      ...pl.expenses.map((e) => [`Expenses: ${e.category}`, -g(e.byMonth)]),
      ['Total expenses', -g(pl.totalExpenses)],
      ['Net profit', g(pl.netProfit)],
      [null, null],
      ['VAT on sales (output)', eur(v.outputCents)],
      ['VAT reclaimable (input)', eur(v.inputCents)],
      ['EU reverse charge (due and reclaimed)', eur(v.reverseChargeCents)],
      ['VAT payable', eur(v.payableCents)],
      ['EU acquisitions of goods (net)', eur(v.euAcquisitionsCents)],
      ['Sales at 0% to EU businesses (net)', eur(v.euZeroSalesCents)],
      [null, null],
      ['Stock value at month end (at cost)', value[0].valueCents === null ? null : eur(value[0].valueCents)],
      ['Online units sold without a known cost', pl.uncostedUnits.get(month) ?? 0],
    ],
  }
  const sign = (k: string) => (k === 'CREDIT_NOTE' ? -1 : 1)
  const sales: Sheet = {
    name: 'Sales invoices',
    columns: [
      { header: 'Number', width: 18 },
      { header: 'Type', width: 12 },
      { header: 'Date', kind: 'date' },
      { header: 'Channel', width: 10 },
      { header: 'Order or sale', width: 14 },
      { header: 'Customer', width: 26 },
      { header: 'Customer VAT', width: 16 },
      { header: 'Net', kind: 'money' },
      { header: 'VAT rate', kind: 'percent' },
      { header: 'VAT', kind: 'money' },
      { header: 'Total', kind: 'money' },
      { header: 'Payment', width: 10 },
    ],
    rows: invs.map((i) => [
      i.number,
      i.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice',
      i.issuedAt,
      i.wholesaleSaleId ? 'Wholesale' : 'Online',
      i.orderNumber,
      i.customer.name,
      i.customer.vatNumber ?? '',
      sign(i.kind) * eur(i.netCents),
      i.vatRateBp / 10_000,
      sign(i.kind) * eur(i.vatCents),
      sign(i.kind) * eur(i.totalCents),
      i.paymentMethod === 'cod' ? 'Cash' : i.paymentMethod === 'card' ? 'Card' : i.paymentMethod,
    ]),
  }
  const purchaseSheet: Sheet = {
    name: 'Purchases',
    columns: [
      { header: 'Ref', width: 12 },
      { header: 'Supplier', width: 22 },
      { header: 'Country', width: 8 },
      { header: 'Supplier VAT', width: 16 },
      { header: 'Supplier invoice', width: 16 },
      { header: 'Invoice date', width: 12 },
      { header: 'VAT treatment', width: 22 },
      { header: 'Goods', kind: 'money' },
      { header: 'Shipping', kind: 'money' },
      { header: 'Other fees', kind: 'money' },
      { header: 'VAT paid', kind: 'money' },
      { header: 'Reverse charge VAT', kind: 'money' },
      { header: 'Total to pay', kind: 'money' },
      { header: 'Status', width: 10 },
      { header: 'Paid', width: 12 },
    ],
    rows: purs.map(({ p, supplier, supplierVat, country }) => [
      p.number,
      supplier,
      country,
      supplierVat ?? '',
      p.supplierInvoiceNo ?? '',
      p.invoiceDate,
      VAT_TREATMENTS[p.vatTreatment as VatTreatment]?.label ?? p.vatTreatment,
      eur(p.goodsNetCents),
      eur(p.shippingCents),
      eur(p.otherFeesCents),
      eur(p.vatCents),
      eur(p.reverseVatCents),
      eur(p.totalCents),
      p.status === 'RECEIVED' ? 'Received' : 'Not received',
      p.paidAt ? p.paidAt.toISOString().slice(0, 10) : 'Unpaid',
    ]),
  }
  const lineSheet: Sheet = {
    name: 'Purchase lines',
    columns: [
      { header: 'Ref', width: 12 },
      { header: 'Product', width: 36 },
      { header: 'SKU', width: 16 },
      { header: 'Qty', kind: 'int' },
      { header: 'Free', kind: 'int' },
      { header: 'Unit price', kind: 'money' },
      { header: 'Line', kind: 'money' },
      { header: 'Landed unit cost', kind: 'money' },
    ],
    rows: lines.map(({ l, number }) => [number, l.description, l.sku ?? '', l.quantity, l.freeQuantity, eur(l.unitNetCents), eur(l.lineNetCents), l.landedUnitCents === null ? null : eur(l.landedUnitCents)]),
  }
  const expenseSheet: Sheet = {
    name: 'Expenses',
    columns: [
      { header: 'Date', width: 12 },
      { header: 'Category', width: 20 },
      { header: 'Paid to', width: 22 },
      { header: 'Description', width: 30 },
      { header: 'Receipt no', width: 14 },
      { header: 'VAT treatment', width: 20 },
      { header: 'Net', kind: 'money' },
      { header: 'VAT', kind: 'money' },
      { header: 'Reverse charge VAT', kind: 'money' },
      { header: 'Total', kind: 'money' },
      { header: 'Paid by', width: 10 },
    ],
    rows: exps.map(({ e, category }) => [
      e.expenseDate,
      category,
      e.payee,
      e.description ?? '',
      e.reference ?? '',
      VAT_TREATMENTS[e.vatTreatment as VatTreatment]?.label ?? e.vatTreatment,
      eur(e.netCents),
      eur(e.vatCents),
      eur(e.reverseVatCents),
      eur(e.totalCents),
      e.paymentMethod ?? '',
    ]),
  }
  const moveSheet: Sheet = {
    name: 'Stock movements',
    columns: [
      { header: 'Date', kind: 'date' },
      { header: 'Kind', width: 26 },
      { header: 'Product', width: 36 },
      { header: 'SKU', width: 16 },
      { header: 'Units', kind: 'int' },
      { header: 'Unit cost', kind: 'money' },
      { header: 'Value at cost', kind: 'money' },
      { header: 'Note', width: 40 },
    ],
    rows: moves.map(({ m, ...v }) => [
      m.occurredAt,
      MOVEMENT_KINDS[m.kind as MovementKind]?.label ?? m.kind,
      variantLabel(v),
      v.sku,
      m.quantity,
      eur(m.unitCostCents),
      eur(m.quantity * m.unitCostCents),
      m.note ?? '',
    ]),
  }
  const unpaidSheet: Sheet = {
    name: 'Unpaid wholesale',
    columns: [
      { header: 'Sale', width: 14 },
      { header: 'Retailer', width: 26 },
      { header: 'Date', width: 12 },
      { header: 'Due', width: 12 },
      { header: 'Total', kind: 'money' },
      { header: 'Credited', kind: 'money' },
      { header: 'Paid', kind: 'money' },
      { header: 'Still due', kind: 'money' },
    ],
    rows: unpaid.map((s) => [
      s.sale.number,
      s.retailerName,
      s.sale.saleDate,
      s.sale.dueDate,
      eur(s.balance.totalCents),
      eur(s.balance.creditedCents),
      eur(s.balance.paidCents),
      eur(s.balance.dueCents),
    ]),
  }

  const entries: { name: string; data: Buffer; store?: boolean }[] = []
  const base = `${safe(BRAND.name)}_${month}`
  entries.push({ name: `${base}_summary.xlsx`, data: toXlsx([summary, sales, purchaseSheet, lineSheet, expenseSheet, moveSheet, unpaidSheet]), store: true })
  for (const i of invs) entries.push({ name: `sales/${safe(i.number)}.html`, data: Buffer.from(invoiceHtml(i), 'utf8') })

  /* Uploaded files, under the record they belong to. */
  const purchaseFiles = await attachmentsOf('purchase', purs.map((p) => p.p.id))
  const expenseFiles = await attachmentsOf('expense', exps.map((e) => e.e.id))
  const moveFiles = await attachmentsOf('movement', moves.map((m) => m.m.id))
  const bytes = await attachmentBytes([...purchaseFiles, ...expenseFiles, ...moveFiles].map((a) => a.mediaId))
  const used = new Set<string>()
  const unique = (name: string) => {
    let n = name
    let k = 2
    while (used.has(n)) n = name.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (${k++})${ext}`)
    used.add(n)
    return n
  }
  const pById = new Map(purs.map((p) => [p.p.id, p]))
  for (const a of purchaseFiles) {
    const p = pById.get(a.ownerId)!
    const b = bytes.get(a.mediaId)
    if (b) entries.push({ name: unique(`purchases/${safe(`${p.p.number} ${p.supplier}`)}/${safe(a.filename)}`), data: b, store: true })
  }
  const eById = new Map(exps.map((e) => [e.e.id, e]))
  for (const a of expenseFiles) {
    const e = eById.get(a.ownerId)!
    const b = bytes.get(a.mediaId)
    if (b) entries.push({ name: unique(`expenses/${safe(`${e.e.expenseDate} ${e.e.payee}`)}/${safe(a.filename)}`), data: b, store: true })
  }
  const mById = new Map(moves.map((m) => [m.m.id, m]))
  for (const a of moveFiles) {
    const m = mById.get(a.ownerId)!
    const b = bytes.get(a.mediaId)
    if (b) entries.push({ name: unique(`stock/${safe(`${m.m.occurredAt.toISOString().slice(0, 10)} ${m.sku}`)}/${safe(a.filename)}`), data: b, store: true })
  }
  entries.push({
    name: 'README.txt',
    data: Buffer.from(
      [
        `${BRAND.name}, records for ${monthName(month)}`,
        '',
        `${base}_summary.xlsx  Profit and loss, VAT, sales invoices, purchases, purchase lines, expenses, stock movements, unpaid wholesale invoices.`,
        'sales/       Every invoice and credit note issued this month. Open in a browser to view or print.',
        'purchases/   Supplier invoices as uploaded, one folder per purchase.',
        'expenses/    Receipts as uploaded, one folder per expense.',
        'stock/       Photos kept with stock written off.',
        '',
        'Amounts are in EUR. Purchases from EU suppliers are recorded with reverse charge VAT at the Cyprus rate.',
        'Stock is valued at weighted average cost, including shipping and fees shared by value.',
      ].join('\r\n'),
      'utf8',
    ),
  })
  return { filename: `${base}_accounts.zip`, bytes: zip(entries) }
}
