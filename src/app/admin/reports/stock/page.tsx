/* ============================================================================
 * Report: where the stock went. One line per size: what came in, where every
 * unit went, and what is on the shelf now. Units only, so every staff member
 * may see it (no costs or profit here).
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { readPeriod } from '@/lib/period'
import { TRACE_COLUMNS, destinations, traceAll } from '@/lib/stock-trace'
import { CHART_SERIES, REMAINDER, SegmentedBar } from '@/components/admin/charts'
import { PeriodFilter } from '@/components/PeriodFilter'
import { Empty, PageHead, btn, input } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

const n = (v: number) => (v === 0 ? <span className="text-muted">·</span> : v > 0 ? `+${v}` : String(v))

export default async function StockTracePage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/reports/stock')
  const sp = await searchParams
  const period = readPeriod(sp, 'all')
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 80) : ''
  const rows = await traceAll(period, { q })
  const allTime = period.key === 'all'
  const keep: Record<string, string> = q ? { q } : {}
  /* The period, carried to each product's page. */
  const periodQs = new URLSearchParams(
    period.key === 'custom' ? { ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) } : period.key === 'all' ? {} : { period: period.key },
  ).toString()
  const exportQs = new URLSearchParams({ ...keep, ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) })
  const totals = Object.fromEntries(TRACE_COLUMNS.map((c) => [c.key, rows.reduce((s, r) => s + r.values[c.key], 0)]))
  const shelf = rows.reduce((s, r) => s + r.onShelf, 0)
  const unexplained = rows.reduce((s, r) => s + (r.unexplained ?? 0), 0)

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/reports" className="text-muted hover:underline">
          ← Reports
        </Link>
      </p>
      <PageHead
        title="Where the stock went"
        sub="Every size: what came in, where each unit went, and what is on the shelf now. Click a product to see every line."
        action={
          <a href={`/api/admin/reports/stock?${exportQs}`} className={btn.secondary}>
            Download Excel
          </a>
        }
      />

      <PeriodFilter path="/admin/reports/stock" period={period} fallback="all" keep={keep} />
      <form action="/admin/reports/stock" className="mb-5 flex gap-2">
        {period.key !== 'all' && period.key !== 'custom' && <input type="hidden" name="period" value={period.key} />}
        {period.from && period.key === 'custom' && <input type="hidden" name="from" value={period.from} />}
        {period.to && period.key === 'custom' && <input type="hidden" name="to" value={period.to} />}
        <input name="q" defaultValue={q} placeholder="Search product, flavour or SKU" className={`${input} max-w-md`} />
      </form>

      {rows.length > 0 && (
        <div className="mb-6 rounded-2xl border border-line bg-paper p-5">
          <h2 className="mb-4 text-sm font-semibold">Where the units went{q ? ` (${q})` : ', every product'}</h2>
          <SegmentedBar parts={destinations(totals as Record<(typeof TRACE_COLUMNS)[number]['key'], number>, shelf).map((d, i) => ({ ...d, color: d.key === 'shelf' ? REMAINDER : CHART_SERIES[i] }))} />
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>Nothing moved in this period.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full min-w-[84rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label min-w-[18rem] px-4 py-3 text-muted">Product</th>
                {TRACE_COLUMNS.map((c) => (
                  <th key={c.key} className="label px-3 py-3 text-right text-muted">
                    {c.label}
                  </th>
                ))}
                {allTime && <th className="label px-3 py-3 text-right text-muted">Not explained</th>}
                <th className="label px-4 py-3 text-right text-muted">On shelf now</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => (
                <tr key={r.variantId} className="hover:bg-paper-2">
                  <td className="px-4 py-3">
                    <Link href={`/admin/reports/stock/${r.variantId}${periodQs ? `?${periodQs}` : ''}`} className="hover:underline">
                      {r.product.en ?? Object.values(r.product)[0]}
                      <span className="text-muted"> {[r.flavour?.en, r.size].filter(Boolean).join(', ')}</span>
                    </Link>
                    <div className="font-mono text-[11px] text-muted">{r.sku}</div>
                  </td>
                  {TRACE_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-3 py-3 text-right tabular-nums ${r.values[c.key] < 0 ? 'text-sale' : r.values[c.key] > 0 ? 'text-ok' : ''}`}>
                      {n(r.values[c.key])}
                    </td>
                  ))}
                  {allTime && (
                    <td className={`px-3 py-3 text-right tabular-nums ${r.unexplained ? 'font-semibold text-accent' : ''}`}>{n(r.unexplained ?? 0)}</td>
                  )}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.onShelf}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-3">Total</td>
                {TRACE_COLUMNS.map((c) => (
                  <td key={c.key} className="px-3 py-3 text-right tabular-nums">
                    {n(totals[c.key])}
                  </td>
                ))}
                {allTime && <td className="px-3 py-3 text-right tabular-nums">{n(unexplained)}</td>}
                <td className="px-4 py-3 text-right tabular-nums">{shelf}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        In plus, out minus. Sold online counts every order that was not cancelled; a refunded order whose items came back shows under Returned.
        {allTime && ' Not explained: changes from before every change was kept in the history, for example stock typed on the Stock page before today.'}
      </p>
    </>
  )
}
