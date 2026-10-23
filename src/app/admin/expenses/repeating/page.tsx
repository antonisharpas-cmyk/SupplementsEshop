/* Repeating expenses: rent and other fixed costs, written by themselves. */

import { guardFinance } from '@/lib/admin'
import { listCategories, listRecurring } from '@/lib/expenses'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { RecurringForm } from '@/components/admin/finance/RecurringForm'
import { thisMonth } from '@/components/admin/finance/MonthNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Repeating expenses' }

export default async function RepeatingPage() {
  await guardFinance('/admin/expenses/repeating')
  const [categories, list, { vat_rate_bp }] = await Promise.all([listCategories(), listRecurring(), getSettings(['vat_rate_bp'])])
  const month = thisMonth()
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-1 text-muted">Add a repeating expense</h2>
        <p className="mb-4 text-xs text-muted">Written as an expense every month on its day, from the first month. Months already past are written straight away. To skip a month, open that month’s expense and set its amount to 0.</p>
        <RecurringForm categories={categories} vatRateBp={vat_rate_bp} month={month} />
      </section>
      {list.map(({ recurring: r, category }) => (
        <details key={r.id} className="group rounded-2xl border border-line bg-paper">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
            <span>
              <span className="font-semibold">{r.payee}</span>
              <span className="ml-2 text-xs text-muted">
                {category} · day {r.dayOfMonth} · from {r.startMonth}
                {r.endMonth ? ` to ${r.endMonth}` : ''}
                {!r.isActive && ' · off'}
              </span>
            </span>
            <span className="text-sm tabular-nums">
              {formatMoney(r.netCents + r.vatCents, 'en')} a month <span className="ml-3 text-xs text-accent group-open:hidden">Edit</span>
            </span>
          </summary>
          <div className="border-t border-line p-5">
            <RecurringForm categories={categories} vatRateBp={vat_rate_bp} initial={r} month={month} />
          </div>
        </details>
      ))}
    </div>
  )
}
