/* Every sale to a retailer, with what is still due and what is overdue. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listRetailers, listSales } from '@/lib/wholesale'
import { monthRange } from '@/lib/finance'
import { formatMoney } from '@/lib/pricing'
import { Empty, Pill, Stat, Table, btn, input, withParams } from '@/components/admin/ui'
import { MonthNav, thisMonth } from '@/components/admin/finance/MonthNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Wholesale' }

type SP = Record<string, string | string[] | undefined>

export default async function WholesalePage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardFinance('/admin/wholesale')
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const show = get('show') // open | overdue
  const all = get('all') === '1' || Boolean(show)
  const month = all ? null : (get('month') ?? thisMonth())
  const range = month ? monthRange(month) : null
  const retailerId = get('retailer')
  const [rows, open, retailers] = await Promise.all([
    listSales({ from: range?.from, to: range?.toExclusive, retailerId, open: show === 'open', overdue: show === 'overdue' }),
    listSales({ open: true }),
    listRetailers(),
  ])
  const money = (c: number) => formatMoney(c, 'en')
  const net = rows.reduce((n, r) => n + r.sale.netCents, 0)
  const profit = rows.reduce((n, r) => n + r.sale.netCents - r.sale.costCents, 0)
  const due = open.reduce((n, r) => n + r.balance.dueCents, 0)
  const overdue = open.filter((r) => r.overdue).reduce((n, r) => n + r.balance.dueCents, 0)
  const params = { month: month ?? undefined, all: get('all'), retailer: retailerId, show }

  return (
    <>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={month ? 'Sold this month (before VAT)' : 'Sold (before VAT)'} value={money(net)} />
        <Stat label="Profit on these sales" value={money(profit)} />
        <Stat label="Still to be paid" value={money(due)} href="/admin/wholesale?show=open" tone={due > 0 ? 'warn' : 'plain'} />
        <Stat label="Overdue" value={money(overdue)} href="/admin/wholesale?show=overdue" tone={overdue > 0 ? 'bad' : 'plain'} />
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        {show ? (
          <p className="mb-5 text-sm">
            Showing {show === 'overdue' ? 'overdue' : 'unpaid'} sales of every month ·{' '}
            <Link href="/admin/wholesale" className="underline">
              back to this month
            </Link>
          </p>
        ) : (
          <MonthNav base="/admin/wholesale" params={params} month={month} />
        )}
        <Link href="/admin/wholesale/new" className={`${btn.primary} mb-5`}>
          + New sale
        </Link>
      </div>
      <form className="mb-5 flex gap-2" action="/admin/wholesale">
        {month && <input type="hidden" name="month" value={month} />}
        {show && <input type="hidden" name="show" value={show} />}
        <select name="retailer" defaultValue={retailerId ?? ''} className={`${input} max-w-xs`}>
          <option value="">Every retailer</option>
          {retailers.map((r) => (
            <option key={r.retailer.id} value={r.retailer.id}>
              {r.retailer.name}
            </option>
          ))}
        </select>
        <button className={btn.secondary}>Filter</button>
      </form>
      {rows.length === 0 ? (
        <Empty>
          No sales here.{' '}
          {retailers.length === 0 && (
            <Link href="/admin/wholesale/retailers" className="underline">
              Add your first retailer
            </Link>
          )}
        </Empty>
      ) : (
        <Table head={['Sale', 'Date', 'Retailer', 'Net', 'Total', 'Profit', 'Due by', 'Still due']} rightFrom={3}>
          {rows.map((r) => (
            <tr key={r.sale.id} className="hover:bg-paper-2/50">
              <td className="px-4 py-3 font-mono text-xs">
                <Link href={`/admin/wholesale/${r.sale.id}`} className="underline-offset-4 hover:text-accent hover:underline">
                  {r.sale.number}
                </Link>
              </td>
              <td className="px-4 py-3">{r.sale.saleDate}</td>
              <td className="px-4 py-3">
                <Link href={withParams('/admin/wholesale', params, { retailer: r.sale.retailerId })} className="hover:text-accent">
                  {r.retailerName}
                </Link>
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.sale.netCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.sale.totalCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(r.sale.netCents - r.sale.costCents)}</td>
              <td className="px-4 py-3 text-right">{r.sale.dueDate}</td>
              <td className="px-4 py-3 text-right">
                {r.balance.dueCents === 0 ? <Pill tone="ok">Paid</Pill> : <Pill tone={r.overdue ? 'bad' : 'warn'}>{money(r.balance.dueCents)}</Pill>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
