/* ============================================================================
 * Reports: profit and loss month by month, margin by product category,
 * spending by category, VAT, stock value; and the accountant's monthly pack.
 * ========================================================================== */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { categoryMargins, profitAndLoss, spending, stockValueByMonth, vatSummary } from '@/lib/finance-reports'
import { closedThrough, isMonth, lastMonths, monthName } from '@/lib/finance'
import { MOVEMENT_KINDS, stockValue, type MovementKind } from '@/lib/stock'
import { formatMoney } from '@/lib/pricing'
import { Stat } from '@/components/admin/ui'
import { BooksControl } from '@/components/admin/finance/BooksControl'
import { thisMonth } from '@/components/admin/finance/MonthNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reports' }

type SP = Record<string, string | string[] | undefined>
const short = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`))

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardFinance('/admin/reports')
  const sp = await searchParams
  const now = thisMonth()
  const to = typeof sp.to === 'string' && isMonth(sp.to) ? sp.to : now
  const span = [3, 6, 12].includes(Number(sp.span)) ? Number(sp.span) : 12
  const months = lastMonths(to, span)
  const [pl, vat, margins, spend, values, closed, live] = await Promise.all([
    profitAndLoss(months),
    vatSummary(months),
    categoryMargins(months),
    spending(months),
    stockValueByMonth(months),
    closedThrough(),
    stockValue(),
  ])
  const m = (c: number) => formatMoney(Math.round(c), 'en')
  const sum = (map: Map<string, number>) => months.reduce((n, k) => n + (map.get(k) ?? 0), 0)
  const prevOf = (mm: string) => lastMonths(mm, 2)[0]

  const cur = months[months.length - 1]
  const salesNow = pl.sales.get(cur) ?? 0
  const gross = pl.grossProfit.get(cur) ?? 0
  const net = pl.netProfit.get(cur) ?? 0
  const uncosted = sum(pl.uncostedUnits)

  /* Margin by category over the whole period. */
  const cats = new Map<string, { sales: number; cost: number; units: number }>()
  for (const r of margins) {
    const c = cats.get(r.category) ?? { sales: 0, cost: 0, units: 0 }
    c.sales += r.salesCents
    c.cost += r.costCents
    c.units += r.units
    cats.set(r.category, c)
  }
  const spendRows = [...new Set(spend.map((s) => `${s.group}|${s.category}`))].sort()

  const P = (rows: { label: string; map: Map<string, number>; strong?: boolean; neg?: boolean; muted?: boolean }[]) =>
    rows.map((r) => (
      <tr key={r.label} className={`${r.strong ? 'border-t-2 border-line font-semibold' : ''} ${r.muted ? 'text-muted' : ''}`}>
        <td className="sticky left-0 bg-paper px-4 py-2 whitespace-nowrap">{r.label}</td>
        {months.map((k) => {
          const v = (r.neg ? -1 : 1) * (r.map.get(k) ?? 0)
          return (
            <td key={k} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${r.strong && v < 0 ? 'text-sale' : ''}`}>
              {v === 0 ? <span className="text-muted">·</span> : m(v)}
            </td>
          )
        })}
        <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap font-medium">{m((r.neg ? -1 : 1) * sum(r.map))}</td>
      </tr>
    ))

  const head = (
    <thead>
      <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
        <th className="sticky left-0 bg-paper px-4 py-3 text-left font-medium" />
        {months.map((k) => (
          <th key={k} className="px-3 py-3 text-right font-medium whitespace-nowrap">
            {short(k)}
          </th>
        ))}
        <th className="px-4 py-3 text-right font-medium">Total</th>
      </tr>
    </thead>
  )
  const maxProfit = Math.max(1, ...months.map((k) => Math.abs(pl.netProfit.get(k) ?? 0)))
  const pill = (on: boolean) => `inline-flex items-center rounded-full border px-4 py-2 text-sm ${on ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'}`

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted">Everything before VAT. Cost of sales is what the sold units cost, with their share of shipping and fees.</p>
      </div>

      <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-3 text-muted">For the accountant</h2>
        <BooksControl closedThrough={closed} lastMonth={prevOf(now)} />
        <p className="mt-3 text-xs text-muted">The pack is one ZIP: an Excel file with profit and loss, VAT, every invoice and credit note, purchases, expenses and stock movements, plus every invoice, supplier invoice and receipt as files.</p>
      </section>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Sales, ${monthName(cur)}`} value={m(salesNow)} />
        <Stat label="Gross profit" value={`${m(gross)}${salesNow ? ` · ${Math.round((gross / salesNow) * 100)}%` : ''}`} />
        <Stat label="Net profit" value={m(net)} tone={net < 0 ? 'bad' : 'plain'} />
        <Stat label="Stock value at cost, now" value={m(live.valueCents)} href="/admin/purchases/opening" />
      </div>
      {(uncosted > 0 || live.uncosted > 0) && (
        <p className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-3 text-sm">
          {uncosted > 0 && `${uncosted} units were sold online in this period without a known cost, so their profit is overstated. `}
          {live.uncosted > 0 && `${live.uncosted} products in stock have no cost yet. `}
          <Link href="/admin/purchases/opening" className="underline">
            Load the opening stock
          </Link>{' '}
          to fix it.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[3, 6, 12].map((n) => (
          <Link key={n} href={`/admin/reports?span=${n}&to=${to}`} className={pill(span === n)}>
            {n} months
          </Link>
        ))}
        <Link href={`/admin/reports?span=${span}&to=${lastMonths(to, span + 1)[0]}`} className={pill(false)} aria-label="Earlier">
          ←
        </Link>
        {to !== now && (
          <Link href={`/admin/reports?span=${span}&to=${lastMonths(to, 0)[0] ?? now}`} className={pill(false)}>
            Later →
          </Link>
        )}
        <span className="text-sm text-muted">
          {monthName(months[0])} to {monthName(cur)}
        </span>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Profit and loss</h2>
        <div className="mb-4 flex h-24 items-end gap-1.5 rounded-2xl border border-line bg-paper px-4 py-3">
          {months.map((k) => {
            const v = pl.netProfit.get(k) ?? 0
            return (
              <div key={k} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${monthName(k)}: ${m(v)}`}>
                <div className={`w-full rounded-t ${v < 0 ? 'bg-sale/70' : 'bg-gold'}`} style={{ height: `${Math.max(2, (Math.abs(v) / maxProfit) * 64)}px` }} />
                <span className="text-[10px] text-muted">{short(k)}</span>
              </div>
            )
          })}
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full text-sm">
            {head}
            <tbody>
              {P([
                { label: 'Online sales', map: pl.onlineSales },
                { label: 'Wholesale sales', map: pl.wholesaleSales },
                { label: 'Total sales', map: pl.sales, strong: true },
                { label: 'Cost of sales, online', map: pl.onlineCost, neg: true, muted: true },
                { label: 'Cost of sales, wholesale', map: pl.wholesaleCost, neg: true, muted: true },
                { label: 'Gross profit', map: pl.grossProfit, strong: true },
                ...pl.stockOut.map((s) => ({ label: `Stock out: ${MOVEMENT_KINDS[s.kind as MovementKind]?.label ?? s.kind}`, map: s.byMonth, neg: true, muted: true })),
                { label: 'Stock count differences', map: pl.countDifference, muted: true },
                ...pl.expenses.map((e) => ({ label: e.category, map: e.byMonth, neg: true, muted: true })),
                { label: 'Total expenses', map: pl.totalExpenses, neg: true },
                { label: 'Net profit', map: pl.netProfit, strong: true },
              ])}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-semibold">Margin by product category</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-left font-medium">Category</th>
                  <th className="px-4 py-3 text-right font-medium">Units</th>
                  <th className="px-4 py-3 text-right font-medium">Sales</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Profit</th>
                  <th className="px-4 py-3 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {[...cats.entries()]
                  .sort((a, b) => b[1].sales - a[1].sales)
                  .map(([c, v]) => (
                    <tr key={c}>
                      <td className="px-4 py-2">{c}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{v.units}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m(v.sales)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted">{m(v.cost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{m(v.sales - v.cost)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{v.sales > 0 ? `${Math.round(((v.sales - v.cost) / v.sales) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                {cats.size === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-muted">
                      No sales in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h2 className="mb-3 text-lg font-semibold">VAT</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 text-left font-medium">Month</th>
                  <th className="px-4 py-3 text-right font-medium">On sales</th>
                  <th className="px-4 py-3 text-right font-medium">To reclaim</th>
                  <th className="px-4 py-3 text-right font-medium" title="EU reverse charge: due and reclaimed at once">
                    Reverse charge
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {vat.map((v) => (
                  <tr key={v.month}>
                    <td className="px-4 py-2">{short(v.month)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m(v.outputCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{m(v.inputCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted">{m(v.reverseChargeCents)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums font-medium ${v.payableCents < 0 ? 'text-ok' : ''}`}>{m(v.payableCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">A negative amount is VAT to be refunded. Reverse charge VAT on EU purchases is both due and reclaimed, so it does not change what is payable; your accountant reports it on the return.</p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Spending by category</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full text-sm">
            {head}
            <tbody>
              {P(
                spendRows.map((key) => {
                  const [group, category] = key.split('|')
                  return {
                    label: `${group === 'Stock' ? 'Stock: ' : ''}${category}`,
                    map: new Map(spend.filter((s) => s.group === group && s.category === category).map((s) => [s.month, s.cents])),
                    muted: group === 'Expenses',
                  }
                }),
              )}
              {P([{ label: 'Total spent', map: new Map(months.map((k) => [k, spend.filter((s) => s.month === k).reduce((n, s) => n + s.cents, 0)])), strong: true }])}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Stock is what was bought (on the supplier invoice date), by product category, with shipping and fees. Expenses are before reclaimable VAT.</p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Stock value at month end</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full text-sm">
            <tbody>
              <tr>
                {values.map((v) => (
                  <td key={v.month} className="px-3 py-3 text-center">
                    <span className="block text-[11px] uppercase text-muted">{short(v.month)}</span>
                    <span className="tabular-nums">{v.valueCents === null ? '·' : m(v.valueCents)}</span>
                    {v.live && <span className="block text-[10px] text-muted">now</span>}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Kept automatically at the start of each month from now on. Months before that show a dot.</p>
      </section>
    </>
  )
}
