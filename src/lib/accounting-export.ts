/* The accountant's download: invoices, their lines, and a monthly summary.
   Credit notes are negative, so every column simply sums to the period's
   figures. */

import { invoicesForExport, type Invoice, type InvoiceFilter } from '@/lib/invoices'
import type { Sheet } from '@/lib/spreadsheet'

const eur = (cents: number) => Math.round(cents) / 100
const sign = (i: Invoice) => (i.kind === 'CREDIT_NOTE' ? -1 : 1)
const method = (m: string) => (m === 'cod' ? 'Cash' : m === 'card' ? 'Card' : m)
const kindLabel = (k: string) => (k === 'CREDIT_NOTE' ? 'Credit note' : 'Invoice')

function monthOf(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia', year: 'numeric', month: '2-digit' }).format(d)
}

export async function accountingSheets(f: InvoiceFilter): Promise<{ invoices: Sheet; lines: Sheet; summary: Sheet }> {
  const list = await invoicesForExport(f)
  const numberById = new Map(list.map((i) => [i.id, i.number]))

  const invoices: Sheet = {
    name: 'Invoices',
    columns: [
      { header: 'Number', width: 18 },
      { header: 'Type', width: 12 },
      { header: 'Date', kind: 'date' },
      { header: 'Order', width: 14 },
      { header: 'Credits invoice', width: 18 },
      { header: 'Customer', width: 24 },
      { header: 'Email', width: 28 },
      { header: 'Phone', width: 16 },
      { header: 'Customer address', width: 40 },
      { header: 'Payment', width: 10 },
      { header: 'Net', kind: 'money' },
      { header: 'VAT rate', kind: 'percent', width: 10 },
      { header: 'VAT', kind: 'money' },
      { header: 'Total', kind: 'money' },
      { header: 'Currency', width: 9 },
    ],
    rows: list.map((i) => [
      i.number,
      kindLabel(i.kind),
      i.issuedAt,
      i.orderNumber,
      i.relatesToId ? (numberById.get(i.relatesToId) ?? '') : '',
      i.customer.name,
      i.customer.email ?? '',
      i.customer.phone ?? '',
      (i.customer.address ?? []).join(', '),
      method(i.paymentMethod),
      eur(sign(i) * i.netCents),
      i.vatRateBp / 10_000,
      eur(sign(i) * i.vatCents),
      eur(sign(i) * i.totalCents),
      i.currency,
    ]),
  }

  const lines: Sheet = {
    name: 'Lines',
    columns: [
      { header: 'Number', width: 18 },
      { header: 'Type', width: 12 },
      { header: 'Date', kind: 'date' },
      { header: 'Order', width: 14 },
      { header: 'Description', width: 44 },
      { header: 'SKU', width: 26 },
      { header: 'Quantity', kind: 'int', width: 9 },
      { header: 'Unit price', kind: 'money' },
      { header: 'Line total', kind: 'money' },
    ],
    rows: list.flatMap((i) =>
      i.lines.map((l) => [i.number, kindLabel(i.kind), i.issuedAt, i.orderNumber, l.description, l.sku ?? '', l.quantity, eur(l.unitCents), eur(l.totalCents)]),
    ),
  }

  const months = new Map<string, { inv: number; cn: number; net: number; vat: number; gross: number; card: number; cash: number }>()
  for (const i of list) {
    const m = monthOf(i.issuedAt)
    const r = months.get(m) ?? { inv: 0, cn: 0, net: 0, vat: 0, gross: 0, card: 0, cash: 0 }
    if (i.kind === 'CREDIT_NOTE') r.cn++
    else r.inv++
    r.net += sign(i) * i.netCents
    r.vat += sign(i) * i.vatCents
    r.gross += sign(i) * i.totalCents
    if (i.paymentMethod === 'cod') r.cash += sign(i) * i.totalCents
    else r.card += sign(i) * i.totalCents
    months.set(m, r)
  }
  const summary: Sheet = {
    name: 'Monthly summary',
    columns: [
      { header: 'Month', width: 10 },
      { header: 'Invoices', kind: 'int', width: 10 },
      { header: 'Credit notes', kind: 'int', width: 12 },
      { header: 'Net', kind: 'money' },
      { header: 'VAT', kind: 'money' },
      { header: 'Total', kind: 'money' },
      { header: 'Card', kind: 'money' },
      { header: 'Cash', kind: 'money' },
    ],
    rows: [...months.entries()].map(([m, r]) => [m, r.inv, r.cn, eur(r.net), eur(r.vat), eur(r.gross), eur(r.card), eur(r.cash)]),
  }

  return { invoices, lines, summary }
}

/** The filter from a query string, shared by the page and the download. */
export function filterFrom(get: (k: string) => string | undefined): InvoiceFilter {
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)
  const kind = get('kind')
  const m = get('method')
  return {
    from: day(get('from')),
    to: day(get('to')),
    kind: kind === 'INVOICE' || kind === 'CREDIT_NOTE' ? kind : undefined,
    method: m === 'card' || m === 'cod' ? m : undefined,
    q: get('q')?.slice(0, 100) || undefined,
  }
}
