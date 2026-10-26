/* This month's expenses by category, and a quick way to add one. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listCategories, listExpenses, writeRecurring } from '@/lib/expenses'
import { monthRange, VAT_TREATMENTS, type VatTreatment } from '@/lib/finance'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { Empty, Stat, Table, btn, input } from '@/components/admin/ui'
import { MonthNav, thisMonth } from '@/components/admin/finance/MonthNav'
import { ExpenseForm } from '@/components/admin/finance/ExpenseForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Expenses' }

type SP = Record<string, string | string[] | undefined>

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardFinance('/admin/expenses')
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const all = get('all') === '1'
  const month = all ? null : (get('month') ?? thisMonth())
  const range = month ? monthRange(month) : null
  /* Anything repeating that is due is written before the list is read. */
  await writeRecurring().catch(() => 0)
  const [categories, rows, { vat_rate_bp }, everything] = await Promise.all([
    listCategories(),
    listExpenses({ from: range?.from, to: range?.toExclusive, categoryId: get('category'), q: get('q') }),
    getSettings(['vat_rate_bp']),
    listExpenses({}),
  ])
  const money = (c: number) => formatMoney(c, 'en')
  const byCat = new Map<string, number>()
  for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.expense.netCents)
  const total = rows.reduce((n, r) => n + r.expense.netCents, 0)
  const vat = rows.reduce((n, r) => n + r.expense.vatCents, 0)
  const payees = [...new Set(everything.map((r) => r.expense.payee))].slice(0, 200)
  const params = { month: month ?? undefined, all: all ? '1' : undefined, category: get('category'), q: get('q') }

  return (
    <>
      <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-4 text-muted">Add an expense</h2>
        <ExpenseForm categories={categories} vatRateBp={vat_rate_bp} payees={payees} />
      </section>

      <MonthNav base="/admin/expenses" params={params} month={month} />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Expenses (cost)" value={money(total)} />
        <Stat label="VAT to reclaim" value={money(vat)} />
        {[...byCat.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([c, v]) => (
            <Stat key={c} label={c} value={money(v)} />
          ))}
      </div>

      <form className="mb-5 flex flex-wrap gap-2" action="/admin/expenses">
        {month && <input type="hidden" name="month" value={month} />}
        <input name="q" defaultValue={get('q')} placeholder="Search payee, description" className={`${input} max-w-xs`} />
        <select name="category" defaultValue={get('category') ?? ''} className={`${input} max-w-[14rem]`}>
          <option value="">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className={btn.secondary}>Filter</button>
      </form>

      {rows.length === 0 ? (
        <Empty>No expenses {month ? 'this month' : 'yet'}.</Empty>
      ) : (
        <Table head={['Date', 'Category', 'Paid to', 'What for', 'VAT', 'Cost', 'VAT reclaim', 'Receipt']} rightFrom={5}>
          {rows.map(({ expense: e, category, files }) => (
            <tr key={e.id} className="hover:bg-paper-2/50">
              <td className="px-4 py-3 whitespace-nowrap">
                <Link href={`/admin/expenses/${e.id}`} className="underline-offset-4 hover:text-accent hover:underline">
                  {e.expenseDate}
                </Link>
              </td>
              <td className="px-4 py-3">{category}</td>
              <td className="px-4 py-3">
                {e.payee}
                {e.recurringId && <span className="ml-2 text-[11px] text-muted">repeating</span>}
              </td>
              <td className="px-4 py-3 text-muted">{e.description ?? ''}</td>
              <td className="px-4 py-3 text-xs text-muted">{VAT_TREATMENTS[e.vatTreatment as VatTreatment]?.label}</td>
              <td className="px-4 py-3 text-right tabular-nums">{money(e.netCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{e.vatCents ? money(e.vatCents) : '—'}</td>
              <td className="px-4 py-3 text-right">
                {files > 0 ? (
                  <span className="text-xs text-ok">{files} file{files === 1 ? '' : 's'}</span>
                ) : (
                  <Link href={`/admin/expenses/${e.id}`} className="text-xs text-sale underline-offset-4 hover:underline">
                    Add receipt
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
