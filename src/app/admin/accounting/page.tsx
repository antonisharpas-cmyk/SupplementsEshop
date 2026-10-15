/* ============================================================================
 * Accounting: every invoice and credit note, with totals for the period and
 * downloads for the accountant (Excel or CSV).
 *
 * Opens on the current month. Anything paid that has no invoice yet (an order
 * paid before invoicing existed, or one whose invoice failed) is issued as
 * the page loads, so the list is always complete.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { ensureInvoices, invoiceTotals, listInvoices } from '@/lib/invoices'
import { filterFrom } from '@/lib/accounting-export'
import { formatMoney } from '@/lib/pricing'
import { getSettings } from '@/lib/settings'
import { Empty, PageHead, Pagination, Pill, Stat, Table, btn, input, withParams } from '@/components/admin/ui'
import { CompanyDetailsForm } from '@/components/admin/CompanyDetailsForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Accounting' }

type SP = Record<string, string | string[] | undefined>

const TZ = 'Europe/Nicosia'
const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const when = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }).format(d)

function periods(now = new Date()) {
  const [y, m] = day(now).split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const q = Math.floor((m - 1) / 3)
  return [
    { key: 'month', label: 'This month', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}` },
    { key: 'last', label: 'Last month', from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastDay(py, pm)}` },
    { key: 'quarter', label: 'This quarter', from: `${y}-${pad(q * 3 + 1)}-01`, to: `${y}-${pad(q * 3 + 3)}-${lastDay(y, q * 3 + 3)}` },
    { key: 'year', label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
    { key: 'all', label: 'All time', from: '', to: '' },
  ]
}

export default async function AccountingPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/accounting')
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)

  const P = periods()
  /* No dates in the address means "this month"; all=1 means no dates at all. */
  const allTime = get('all') === '1'
  const filter = filterFrom(get)
  if (!allTime && !filter.from && !filter.to) {
    filter.from = P[0].from
    filter.to = P[0].to
  }
  const page = Number(get('page')) || 1

  await ensureInvoices()
  const [list, totals, company] = await Promise.all([
    listInvoices({ ...filter, page }),
    invoiceTotals(filter),
    getSettings(['company_legal_name', 'company_vat_number', 'company_tax_id', 'company_address', 'invoice_footer']),
  ])

  const params: SP = {
    from: filter.from,
    to: filter.to,
    kind: filter.kind,
    method: filter.method,
    q: filter.q,
    all: allTime ? '1' : undefined,
  }
  const download = (format: 'xlsx' | 'csv', sheet?: 'lines') =>
    withParams('/api/admin/accounting/export', { ...params, all: undefined }, { format, sheet })
  const activePeriod = P.find((p) => (p.key === 'all' ? allTime : !allTime && p.from === filter.from && p.to === filter.to))?.key
  const money = (c: number) => formatMoney(c, 'en')
  const missingCompany = !company.company_legal_name || !company.company_vat_number

  return (
    <>
      <PageHead
        title="Accounting"
        sub={
          allTime
            ? 'Every invoice and credit note'
            : `Invoices and credit notes from ${filter.from ? when(new Date(`${filter.from}T12:00:00Z`)) : 'the start'} to ${filter.to ? when(new Date(`${filter.to}T12:00:00Z`)) : 'today'}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            <a href={download('xlsx')} className={btn.primary}>
              <DownloadIcon /> Excel
            </a>
            <a href={download('csv')} className={btn.secondary}>
              <DownloadIcon /> CSV
            </a>
            <a href={download('csv', 'lines')} className={btn.secondary} title="One row per product line">
              <DownloadIcon /> CSV with lines
            </a>
          </div>
        }
      />

      {missingCompany && (
        <p className="mb-6 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 text-sm text-ink">
          Add the company name and VAT number at the bottom of this page, so they print on every new invoice.
        </p>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {P.map((p) => (
          <Link
            key={p.key}
            href={withParams('/admin/accounting', { ...params, page: undefined }, p.key === 'all' ? { from: null, to: null, all: '1' } : { from: p.from, to: p.to, all: null })}
            className={`inline-flex items-center rounded-full border px-4 py-2 text-sm transition-colors ${
              activePeriod === p.key ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form action="/admin/accounting" className="mb-6 grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.6fr)_auto]">
        <label className="text-sm">
          <span className="label mb-1.5 block text-muted">From</span>
          <input type="date" name="from" defaultValue={filter.from ?? ''} className={input} />
        </label>
        <label className="text-sm">
          <span className="label mb-1.5 block text-muted">To</span>
          <input type="date" name="to" defaultValue={filter.to ?? ''} className={input} />
        </label>
        <label className="text-sm">
          <span className="label mb-1.5 block text-muted">Type</span>
          <select name="kind" defaultValue={filter.kind ?? ''} className={input}>
            <option value="">All</option>
            <option value="INVOICE">Invoices</option>
            <option value="CREDIT_NOTE">Credit notes</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="label mb-1.5 block text-muted">Payment</span>
          <select name="method" defaultValue={filter.method ?? ''} className={input}>
            <option value="">All</option>
            <option value="card">Card</option>
            <option value="cod">Cash</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="label mb-1.5 block text-muted">Search</span>
          <input name="q" defaultValue={filter.q ?? ''} placeholder="Invoice, order, customer or email" className={input} />
        </label>
        <div className="flex items-end">
          <button type="submit" className={`${btn.primary} w-full`}>
            Apply
          </button>
        </div>
      </form>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Invoices" value={totals.invoices} />
        <Stat label="Credit notes" value={totals.creditNotes} />
        <Stat label="Net sales" value={money(totals.net)} />
        <Stat label="VAT" value={money(totals.vat)} />
        <Stat label="Total" value={money(totals.gross)} />
        <Stat
          label="By payment"
          value={
            <span className="block space-y-0.5 text-sm font-medium">
              <span className="flex justify-between gap-2">
                <span className="text-muted">Card</span> {money(totals.card)}
              </span>
              <span className="flex justify-between gap-2">
                <span className="text-muted">Cash</span> {money(totals.cash)}
              </span>
            </span>
          }
        />
      </div>

      {list.rows.length === 0 ? (
        <Empty>
          No invoices in this period. An invoice is issued automatically when an order is paid: a card payment going
          through, or cash received.
        </Empty>
      ) : (
        <Table head={['Number', 'Date', 'Type', 'Order', 'Customer', 'Payment', 'Net', 'VAT', 'Total']} rightFrom={6}>
          {list.rows.map((i) => {
            const s = i.kind === 'CREDIT_NOTE' ? -1 : 1
            return (
              <tr key={i.id} className="hover:bg-paper-2">
                <td className="px-4 py-3">
                  <Link href={`/admin/accounting/${i.id}`} className="font-mono text-heading underline-offset-4 hover:text-accent hover:underline">
                    {i.number}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">{when(i.issuedAt)}</td>
                <td className="px-4 py-3">
                  {i.kind === 'CREDIT_NOTE' ? <Pill tone="bad">Credit note</Pill> : <Pill tone="ok">Invoice</Pill>}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/admin/orders/${i.orderId}`} className="font-mono text-muted underline-offset-4 hover:text-ink hover:underline">
                    {i.orderNumber}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{i.customer.name}</div>
                  <div className="text-xs text-muted">{i.customer.email}</div>
                </td>
                <td className="px-4 py-3 text-muted">{i.paymentMethod === 'cod' ? 'Cash' : 'Card'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(s * i.netCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">{money(s * i.vatCents)}</td>
                <td className={`px-4 py-3 text-right font-semibold tabular-nums ${s < 0 ? 'text-sale' : 'text-heading'}`}>{money(s * i.totalCents)}</td>
              </tr>
            )
          })}
        </Table>
      )}
      <Pagination
        page={list.page}
        pages={list.pages}
        total={list.total}
        noun={['document', 'documents']}
        href={(p) => withParams('/admin/accounting', params, { page: p })}
      />

      <section className="mt-12 rounded-2xl border border-line bg-paper p-6">
        <h2 className="text-lg font-semibold text-heading">Company details on invoices</h2>
        <p className="mt-1 text-sm text-muted">
          Printed on every invoice issued from now on. Invoices already issued keep the details they were issued with.
        </p>
        <CompanyDetailsForm initial={company} />
      </section>
    </>
  )
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v12M7 10l5 5 5-5M4 20h16" />
    </svg>
  )
}
