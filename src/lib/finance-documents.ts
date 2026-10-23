/* ============================================================================
 * Every document of a period in one ZIP, for the accountant: money in and
 * money out, each in its own folder.
 *
 *   Money in
 *     sales/online/       invoices and credit notes of shop orders
 *     sales/wholesale/    invoices and credit notes of retailer sales
 *   Money out
 *     purchases/          supplier invoices as uploaded, one folder per purchase
 *     expenses/           receipts as uploaded, one folder per expense
 *   Other
 *     stock/              photos kept with stock written off
 *     wholesale-files/    files kept with retailer sales (their orders)
 *   index.xlsx            every document in the period, with its amounts,
 *                         and which purchases and expenses have no file yet
 *
 * Invoices are printable pages (open in a browser, print or save as PDF).
 * ========================================================================== */

import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { attachments, expenseCategories, expenses, invoices, purchases, retailers, stockMovements, suppliers, wholesaleSales } from '@/db/schema'
import { toXlsx, zip, type Sheet } from '@/lib/spreadsheet'
import { addDays, attachmentBytes, FinanceError } from '@/lib/finance'
import { cyprusDayStart } from '@/lib/invoices'
import { invoiceHtml } from '@/lib/finance-pack'
import { BRAND } from '@/config/brand'

export const DOCUMENT_KINDS = {
  online: 'Shop invoices and credit notes',
  wholesale: 'Retailer invoices and credit notes',
  purchases: 'Supplier invoices',
  expenses: 'Expense receipts',
  stock: 'Photos of stock written off',
} as const
export type DocumentKind = keyof typeof DOCUMENT_KINDS

/* The server builds the ZIP in memory: keep a period's files within this. */
const MAX_BYTES = 150 * 1024 * 1024

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
const eur = (c: number) => Math.round(c) / 100

export async function buildDocuments(opts: { from: string; to: string; kinds: DocumentKind[] }): Promise<{ filename: string; bytes: Buffer; count: number }> {
  const { from, to, kinds } = opts
  if (to < from) throw new FinanceError('The end date is before the start date.')
  const toExclusive = addDays(to, 1)
  const start = cyprusDayStart(from)!
  const end = cyprusDayStart(toExclusive)!
  const want = new Set(kinds)

  const [invs, purs, exps, moves, sales] = await Promise.all([
    want.has('online') || want.has('wholesale')
      ? db.select().from(invoices).where(and(gte(invoices.issuedAt, start), lt(invoices.issuedAt, end))).orderBy(asc(invoices.issuedAt), asc(invoices.number))
      : Promise.resolve([]),
    want.has('purchases')
      ? db
          .select({ id: purchases.id, number: purchases.number, date: purchases.invoiceDate, supplierInvoiceNo: purchases.supplierInvoiceNo, supplier: suppliers.name, total: purchases.totalCents, status: purchases.status })
          .from(purchases)
          .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
          .where(and(gte(purchases.invoiceDate, from), lt(purchases.invoiceDate, toExclusive), sql`${purchases.status} <> 'CANCELLED'`))
          .orderBy(asc(purchases.invoiceDate))
      : Promise.resolve([]),
    want.has('expenses')
      ? db
          .select({ id: expenses.id, date: expenses.expenseDate, payee: expenses.payee, description: expenses.description, reference: expenses.reference, total: expenses.totalCents, category: expenseCategories.name })
          .from(expenses)
          .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
          .where(and(gte(expenses.expenseDate, from), lt(expenses.expenseDate, toExclusive)))
          .orderBy(asc(expenses.expenseDate))
      : Promise.resolve([]),
    want.has('stock')
      ? db.select({ id: stockMovements.id, at: stockMovements.occurredAt, kind: stockMovements.kind }).from(stockMovements).where(and(gte(stockMovements.occurredAt, start), lt(stockMovements.occurredAt, end)))
      : Promise.resolve([]),
    want.has('wholesale')
      ? db
          .select({ id: wholesaleSales.id, number: wholesaleSales.number, retailer: retailers.name })
          .from(wholesaleSales)
          .innerJoin(retailers, eq(retailers.id, wholesaleSales.retailerId))
          .where(and(gte(wholesaleSales.saleDate, from), lt(wholesaleSales.saleDate, toExclusive)))
      : Promise.resolve([]),
  ])

  const online = want.has('online') ? invs.filter((i) => i.orderId) : []
  const whole = want.has('wholesale') ? invs.filter((i) => i.wholesaleSaleId) : []

  /* The files kept with records, and their size, before reading any bytes. */
  const owners: { type: string; ids: string[] }[] = [
    { type: 'purchase', ids: purs.map((p) => p.id) },
    { type: 'expense', ids: exps.map((e) => e.id) },
    { type: 'movement', ids: moves.map((m) => m.id) },
    { type: 'wholesale', ids: sales.map((s) => s.id) },
  ].filter((o) => o.ids.length)
  const files = owners.length
    ? (
        await Promise.all(
          owners.map((o) =>
            db
              .select()
              .from(attachments)
              .where(and(eq(attachments.ownerType, o.type), inArray(attachments.ownerId, o.ids)))
              .orderBy(asc(attachments.createdAt)),
          ),
        )
      ).flat()
    : []
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > MAX_BYTES) {
    throw new FinanceError(`The files of this period come to ${Math.round(total / 1048576)} MB. Choose a shorter period (a quarter or a few months) and download it in parts.`)
  }
  const bytes = await attachmentBytes(files.map((f) => f.mediaId))

  const entries: { name: string; data: Buffer; store?: boolean }[] = []
  const used = new Set<string>()
  const unique = (name: string) => {
    let n = name
    let k = 2
    while (used.has(n)) n = name.replace(/(\.[a-z0-9]+)?$/i, (ext) => ` (${k++})${ext}`)
    used.add(n)
    return n
  }

  for (const i of online) entries.push({ name: unique(`sales/online/${safe(i.number)}.html`), data: Buffer.from(invoiceHtml(i), 'utf8') })
  for (const i of whole) entries.push({ name: unique(`sales/wholesale/${safe(i.number)} ${safe(i.customer.name)}.html`), data: Buffer.from(invoiceHtml(i), 'utf8') })

  const filesOf = new Map<string, typeof files>()
  for (const f of files) filesOf.set(f.ownerId, [...(filesOf.get(f.ownerId) ?? []), f])
  const put = (folder: string, f: (typeof files)[number]) => {
    const b = bytes.get(f.mediaId)
    if (b) entries.push({ name: unique(`${folder}/${safe(f.filename)}`), data: b, store: true })
  }
  for (const p of purs) for (const f of filesOf.get(p.id) ?? []) put(`purchases/${safe(`${p.date} ${p.supplier} ${p.supplierInvoiceNo ?? p.number}`)}`, f)
  for (const e of exps) for (const f of filesOf.get(e.id) ?? []) put(`expenses/${safe(`${e.date} ${e.payee}`)}`, f)
  for (const m of moves) for (const f of filesOf.get(m.id) ?? []) put(`stock/${safe(`${m.at.toISOString().slice(0, 10)} ${m.kind.toLowerCase()}`)}`, f)
  for (const s of sales) for (const f of filesOf.get(s.id) ?? []) put(`wholesale-files/${safe(`${s.number} ${s.retailer}`)}`, f)

  /* The index: what is in the ZIP, and what is missing. */
  const sign = (k: string) => (k === 'CREDIT_NOTE' ? -1 : 1)
  const sheets: Sheet[] = []
  if (online.length || whole.length) {
    sheets.push({
      name: 'Money in',
      columns: [
        { header: 'Number', width: 18 },
        { header: 'Type', width: 12 },
        { header: 'Date', kind: 'date' },
        { header: 'Channel', width: 10 },
        { header: 'Customer', width: 28 },
        { header: 'Customer VAT', width: 16 },
        { header: 'Net', kind: 'money' },
        { header: 'VAT', kind: 'money' },
        { header: 'Total', kind: 'money' },
      ],
      rows: [...online, ...whole]
        .sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime())
        .map((i) => [
          i.number,
          i.kind === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice',
          i.issuedAt,
          i.wholesaleSaleId ? 'Wholesale' : 'Online',
          i.customer.name,
          i.customer.vatNumber ?? '',
          sign(i.kind) * eur(i.netCents),
          sign(i.kind) * eur(i.vatCents),
          sign(i.kind) * eur(i.totalCents),
        ]),
    })
  }
  if (purs.length || exps.length) {
    sheets.push({
      name: 'Money out',
      columns: [
        { header: 'Date', width: 12 },
        { header: 'Kind', width: 16 },
        { header: 'Paid to', width: 26 },
        { header: 'Reference', width: 20 },
        { header: 'Category', width: 20 },
        { header: 'Total', kind: 'money' },
        { header: 'Files', kind: 'int' },
        { header: 'Note', width: 26 },
      ],
      rows: [
        ...purs.map((p) => [p.date, 'Supplier invoice', p.supplier, p.supplierInvoiceNo ?? p.number, 'Stock', eur(p.total), filesOf.get(p.id)?.length ?? 0, filesOf.get(p.id)?.length ? '' : 'No file attached yet']),
        ...exps.map((e) => [e.date, 'Expense', e.payee, e.reference ?? '', e.category, eur(e.total), filesOf.get(e.id)?.length ?? 0, filesOf.get(e.id)?.length ? '' : 'No receipt attached yet']),
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    })
  }
  if (sheets.length === 0) sheets.push({ name: 'Index', columns: [{ header: 'Nothing in this period', width: 40 }], rows: [] })
  entries.unshift({ name: 'index.xlsx', data: toXlsx(sheets), store: true })

  const count = entries.length - 1
  const name = `${safe(BRAND.name)}_documents_${from}_to_${to}.zip`
  return { filename: name, bytes: zip(entries), count }
}
