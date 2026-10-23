/* Every purchase, month by month, with what is still to pay. */

import Link from 'next/link'
import { canSeeFinance, guardAdmin } from '@/lib/admin'
import { listPurchases, listSuppliers } from '@/lib/purchases'
import { monthRange } from '@/lib/finance'
import { Empty, Pill, Stat, Table, btn, input, withParams } from '@/components/admin/ui'
import { MonthNav, thisMonth } from '@/components/admin/finance/MonthNav'
import { formatMoney } from '@/lib/pricing'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Purchases' }

type SP = Record<string, string | string[] | undefined>

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await guardAdmin('/admin/purchases')
  const finance = canSeeFinance(user)
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const all = get('all') === '1'
  const month = all ? null : (get('month') ?? thisMonth())
  const range = month ? monthRange(month) : null
  const status = get('status')
  const supplierId = get('supplier')
  const unpaid = get('unpaid') === '1'
  const [{ rows, totals }, suppliers] = await Promise.all([
    listPurchases({ from: range?.from, to: range?.toExclusive, status, supplierId, unpaid, q: get('q'), page: Number(get('page')) || 1 }),
    listSuppliers(),
  ])
  const money = (c: number) => formatMoney(c, 'en')
  const params = { month: month ?? undefined, all: all ? '1' : undefined, status, supplier: supplierId, unpaid: unpaid ? '1' : undefined, q: get('q') }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <MonthNav base="/admin/purchases" params={params} month={month} />
        {finance && (
          <Link href="/admin/purchases/new" className={btn.primary}>
            + New purchase
          </Link>
        )}
      </div>

      {finance && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Products" value={money(totals.goods)} />
          <Stat label="Shipping and fees" value={money(totals.extras)} />
          <Stat label="VAT (paid or reverse charge)" value={money(totals.vat)} />
          <Stat label="Still to pay suppliers" value={money(totals.unpaid)} tone={totals.unpaid > 0 ? 'warn' : 'plain'} href={withParams('/admin/purchases', params, { unpaid: '1' })} />
        </div>
      )}

      <form className="mb-5 flex flex-wrap gap-2" action="/admin/purchases">
        {month && <input type="hidden" name="month" value={month} />}
        {all && <input type="hidden" name="all" value="1" />}
        <input name="q" defaultValue={get('q')} placeholder="Search ref, supplier, invoice number" className={`${input} max-w-xs`} />
        <select name="supplier" defaultValue={supplierId ?? ''} className={`${input} max-w-[14rem]`}>
          <option value="">Every supplier</option>
          {suppliers.map((s) => (
            <option key={s.supplier.id} value={s.supplier.id}>
              {s.supplier.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ''} className={`${input} max-w-[12rem]`}>
          <option value="">Received and not</option>
          <option value="DRAFT">Not arrived yet</option>
          <option value="RECEIVED">Received</option>
        </select>
        {finance && (
          <label className="flex items-center gap-2 px-2 text-sm">
            <input type="checkbox" name="unpaid" value="1" defaultChecked={unpaid} className="h-4 w-4 accent-[var(--color-accent)]" /> Unpaid only
          </label>
        )}
        <button className={btn.secondary}>Filter</button>
      </form>

      {rows.length === 0 ? (
        <Empty>
          No purchases {month ? 'this month' : 'yet'}.{' '}
          {finance && suppliers.length === 0 && (
            <>
              Start by <Link href="/admin/purchases/suppliers" className="underline">adding your suppliers</Link>.
            </>
          )}
        </Empty>
      ) : (
        <Table head={finance ? ['Ref', 'Date', 'Supplier', 'Their invoice', 'Units', 'Products', 'Shipping & fees', 'Total', 'Status'] : ['Ref', 'Date', 'Supplier', 'Their invoice', 'Units', 'Status']} rightFrom={4}>
          {rows.map(({ purchase: p, supplierName, units, files }) => (
            <tr key={p.id} className="hover:bg-paper-2/50">
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/admin/purchases/${p.id}`} className="underline-offset-4 hover:text-accent hover:underline">
                  {p.number}
                </Link>
              </td>
              <td className="px-4 py-3 whitespace-nowrap">{p.invoiceDate}</td>
              <td className="px-4 py-3">{supplierName}</td>
              <td className="px-4 py-3 text-muted">
                {p.supplierInvoiceNo ?? '—'}
                {files > 0 && <span className="ml-2 text-[11px]">· {files} file{files === 1 ? '' : 's'}</span>}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{units}</td>
              {finance && (
                <>
                  <td className="px-4 py-3 text-right tabular-nums">{money(p.goodsNetCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(p.shippingCents + p.otherFeesCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">{money(p.totalCents)}</td>
                </>
              )}
              <td className="px-4 py-3 text-right">
                <span className="inline-flex flex-wrap justify-end gap-1">
                  <Pill tone={p.status === 'RECEIVED' ? 'ok' : 'warn'}>{p.status === 'RECEIVED' ? 'Received' : 'Not arrived'}</Pill>
                  {finance && <Pill tone={p.paidAt ? 'off' : 'bad'}>{p.paidAt ? 'Paid' : 'Unpaid'}</Pill>}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
