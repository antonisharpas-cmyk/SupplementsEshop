/* The shops and gyms the business sells to. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listRetailers, listSales } from '@/lib/wholesale'
import { formatMoney } from '@/lib/pricing'
import { Empty, Pill, btn } from '@/components/admin/ui'
import { RetailerForm } from '@/components/admin/finance/RetailerForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Retailers' }

export default async function RetailersPage() {
  await guardFinance('/admin/wholesale/retailers')
  const [list, open] = await Promise.all([listRetailers(), listSales({ open: true })])
  const due = new Map<string, number>()
  for (const s of open) due.set(s.sale.retailerId, (due.get(s.sale.retailerId) ?? 0) + s.balance.dueCents)
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-4 text-muted">Add a retailer</h2>
        <RetailerForm />
      </section>
      {list.length === 0 ? (
        <Empty>No retailers yet.</Empty>
      ) : (
        list.map(({ retailer: r, sales, netCents }) => (
          <details key={r.id} className="group rounded-2xl border border-line bg-paper">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span>
                <span className="font-semibold">{r.name}</span>
                <span className="ml-2 text-xs text-muted">
                  {r.defaultDiscountPercent}% off · {r.paymentTermsDays ? `${r.paymentTermsDays} days` : 'upfront'}
                  {r.vatTreatment === 'EU_ZERO' && ' · VAT 0% EU'}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span>
                  {sales} sales · {formatMoney(netCents, 'en')}
                </span>
                {(due.get(r.id) ?? 0) > 0 && <Pill tone="warn">{`${formatMoney(due.get(r.id)!, 'en')} due`}</Pill>}
                {!r.isActive && <Pill tone="off">Inactive</Pill>}
                <Link href={`/admin/wholesale/new?retailer=${r.id}`} className={btn.secondary}>
                  New sale
                </Link>
                <Link href={`/admin/wholesale/prices?retailer=${r.id}`} className={btn.quiet}>
                  Their prices
                </Link>
                <span className="text-accent group-open:hidden">Edit</span>
              </span>
            </summary>
            <div className="border-t border-line p-5">
              <RetailerForm initial={r} />
            </div>
          </details>
        ))
      )}
    </div>
  )
}
