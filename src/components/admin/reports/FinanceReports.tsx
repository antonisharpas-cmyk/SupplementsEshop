/* ============================================================================
 * The finance reports, one per page under /admin/reports: profit and loss,
 * margin by category, VAT, spending, stock value, and the accountant's pack.
 * Each page renders this with the part it shows; the month controls keep
 * the reader on the same page.
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
import { CONTEXT, ColumnChart, GOLD, HBarChart, LOSS, LineChart } from '@/components/admin/charts'

export type SP = Record<string, string | string[] | undefined>
const short = (m: string) =>
  new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  }).format(new Date(`${m}-15T12:00:00Z`))

export type FinancePart = 'profit' | 'margins' | 'vat' | 'spending' | 'stock-value' | 'accountant'

const TITLES: Record<FinancePart, { title: string; sub: string }> = {
  profit: {
    title: 'Profit and loss',
    sub: 'Sales, costs and profit month by month, before VAT. Cost of sales is what the sold units cost, with their share of shipping and fees.',
  },
  margins: {
    title: 'Margin by category',
    sub: 'What each product category sold and earned, before VAT.',
  },
  vat: { title: 'VAT', sub: 'VAT on sales and purchases, month by month.' },
  spending: {
    title: 'Spending by category',
    sub: 'Expenses by category, before VAT.',
  },
  'stock-value': {
    title: 'Stock value',
    sub: 'What the stock on the shelf cost, at the end of each month.',
  },
  accountant: {
    title: 'For the accountant',
    sub: 'Close a month and download everything the accountant needs.',
  },
}

export async function FinanceReports({ sp, part }: { sp: SP; part: FinancePart }) {
  await guardFinance(`/admin/reports/${part}`)
  const path = `/admin/reports/${part}`
  const now = thisMonth()
  const to = typeof sp.to === 'string' && isMonth(sp.to) ? sp.to : now
  const span = [3, 6, 12].includes(Number(sp.span)) ? Number(sp.span) : 12
  const months = lastMonths(to, span)
  /* "Later" moves forward by the same span as "Earlier" goes back, never past this month. */
  const [ty, tm] = to.split('-').map(Number)
  const ahead = new Date(Date.UTC(ty, tm - 1 + span, 15))
  const aheadMonth = `${ahead.getUTCFullYear()}-${String(ahead.getUTCMonth() + 1).padStart(2, '0')}`
  const later = aheadMonth < now ? aheadMonth : now
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

  const P = (
    rows: {
      label: string
      map: Map<string, number>
      strong?: boolean
      neg?: boolean
      muted?: boolean
    }[],
  ) =>
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
  const pill = (on: boolean) =>
    `inline-flex items-center rounded-full border px-4 py-2 text-sm ${on ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'}`

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/reports" className="text-muted hover:underline">
          ← Reports
        </Link>
      </p>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{TITLES[part].title}</h1>
        <p className="mt-1 text-sm text-muted">{TITLES[part].sub}</p>
      </div>

      {part === 'accountant' && (
        <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
          <h2 className="label mb-3 text-muted">For the accountant</h2>
          <BooksControl closedThrough={closed} lastMonth={prevOf(now)} />
          <p className="mt-3 text-xs text-muted">
            The pack is one ZIP: an Excel file with profit and loss, VAT, every invoice and credit note, purchases, expenses and stock movements, plus every
            invoice, supplier invoice and receipt as files.
          </p>
        </section>
      )}

      {part === 'profit' && (
        <>
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
        </>
      )}

      {part !== 'accountant' && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {[3, 6, 12].map((n) => (
              <Link key={n} href={`${path}?span=${n}&to=${to}`} className={pill(span === n)}>
                {n} months
              </Link>
            ))}
            <Link href={`${path}?span=${span}&to=${lastMonths(to, span + 1)[0]}`} className={pill(false)} aria-label="Earlier">
              ←
            </Link>
            {to !== now && (
              <Link href={`${path}?span=${span}&to=${later}`} className={pill(false)}>
                Later →
              </Link>
            )}
            <span className="text-sm text-muted">
              {monthName(months[0])} to {monthName(cur)}
            </span>
          </div>

          {part === 'profit' && (
            <section className="mb-8">
              <h2 className="sr-only">Profit and loss</h2>
              <div className="mb-4 rounded-2xl border border-line bg-paper p-5">
                <ColumnChart
                  categories={months.map(short)}
                  series={[
                    { name: 'Sales', color: CONTEXT, values: months.map((k) => pl.sales.get(k) ?? 0), labels: 'axis' },
                    { name: 'Net profit', color: GOLD, negativeColor: LOSS, values: months.map((k) => pl.netProfit.get(k) ?? 0), labels: 'all' },
                  ]}
                  caption="Before VAT. Sales are written under each month, net profit above its bar (gold, or red for a loss). Hover any bar for its exact value."
                />
              </div>
              <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
                <table className="w-full text-sm">
                  {head}
                  <tbody>
                    {P([
                      { label: 'Online sales', map: pl.onlineSales },
                      { label: 'Wholesale sales', map: pl.wholesaleSales },
                      { label: 'Total sales', map: pl.sales, strong: true },
                      {
                        label: 'Cost of sales, online',
                        map: pl.onlineCost,
                        neg: true,
                        muted: true,
                      },
                      {
                        label: 'Cost of sales, wholesale',
                        map: pl.wholesaleCost,
                        neg: true,
                        muted: true,
                      },
                      {
                        label: 'Gross profit',
                        map: pl.grossProfit,
                        strong: true,
                      },
                      ...pl.stockOut.map((s) => ({
                        label: `Stock out: ${MOVEMENT_KINDS[s.kind as MovementKind]?.label ?? s.kind}`,
                        map: s.byMonth,
                        neg: true,
                        muted: true,
                      })),
                      {
                        label: 'Stock count differences',
                        map: pl.countDifference,
                        muted: true,
                      },
                      ...pl.expenses.map((e) => ({
                        label: e.category,
                        map: e.byMonth,
                        neg: true,
                        muted: true,
                      })),
                      {
                        label: 'Total expenses',
                        map: pl.totalExpenses,
                        neg: true,
                      },
                      { label: 'Net profit', map: pl.netProfit, strong: true },
                    ])}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {part === 'margins' && (
            <section className="mb-8">
              <div>
                <h2 className="sr-only">Margin by product category</h2>
                {cats.size > 0 && (
                  <div className="mb-4 rounded-2xl border border-line bg-paper p-5">
                    <h3 className="mb-4 text-sm font-semibold">Profit by category</h3>
                    <HBarChart
                      format={m}
                      rows={[...cats.entries()]
                        .map(([label, c]) => ({ label, value: c.sales - c.cost, note: c.sales ? `${Math.round(((c.sales - c.cost) / c.sales) * 100)}% margin on ${m(c.sales)} sales` : undefined }))
                        .sort((a, b) => b.value - a.value)}
                    />
                  </div>
                )}
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
                            <td className="px-4 py-2 text-right tabular-nums font-medium">
                              {v.sales > 0 ? `${Math.round(((v.sales - v.cost) / v.sales) * 100)}%` : '—'}
                            </td>
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
            </section>
          )}

          {part === 'vat' && (
            <section className="mb-8">
              <div>
                <h2 className="sr-only">VAT</h2>
                <div className="mb-4 rounded-2xl border border-line bg-paper p-5">
                  <ColumnChart
                    categories={vat.map((v) => short(v.month))}
                    series={[{ name: 'VAT payable', color: GOLD, negativeColor: '#4cc77a', values: vat.map((v) => v.payableCents), labels: 'all' }]}
                    caption="VAT to pay each month, in gold. Below zero, in green, is VAT to be refunded."
                  />
                </div>
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
                <p className="mt-2 text-xs text-muted">
                  A negative amount is VAT to be refunded. Reverse charge VAT on EU purchases is both due and reclaimed, so it does not change what is payable;
                  your accountant reports it on the return.
                </p>
              </div>
            </section>
          )}

          {part === 'spending' && (
            <section className="mb-8">
              <h2 className="sr-only">Spending by category</h2>
              {spendRows.length > 0 && (
                <div className="mb-4 rounded-2xl border border-line bg-paper p-5">
                  <h3 className="mb-4 text-sm font-semibold">Total for the period</h3>
                  <HBarChart
                    format={m}
                    rows={spendRows
                      .map((key) => {
                        const [group, category] = key.split('|')
                        return { label: `${group === 'Stock' ? 'Stock: ' : ''}${category}`, value: spend.filter((x) => x.group === group && x.category === category).reduce((n, x) => n + x.cents, 0) }
                      })
                      .sort((a, b) => b.value - a.value)}
                  />
                </div>
              )}
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
                    {P([
                      {
                        label: 'Total spent',
                        map: new Map(months.map((k) => [k, spend.filter((s) => s.month === k).reduce((n, s) => n + s.cents, 0)])),
                        strong: true,
                      },
                    ])}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">
                Stock is what was bought (on the supplier invoice date), by product category, with shipping and fees. Expenses are before reclaimable VAT.
              </p>
            </section>
          )}

          {part === 'stock-value' && (
            <section>
              <p className="mb-4 text-sm">
                Now: <span className="font-semibold tabular-nums">{m(live.valueCents)}</span>
              </p>
              {values.some((v) => v.valueCents !== null) && (
                <div className="mb-4 rounded-2xl border border-line bg-paper p-5">
                  <LineChart categories={values.map((v) => short(v.month))} values={values.map((v) => v.valueCents)} />
                </div>
              )}
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
          )}
        </>
      )}
    </>
  )
}
