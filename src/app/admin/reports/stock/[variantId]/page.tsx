/* One size: where every unit went, line by line, with links to the order,
   purchase or wholesale sale behind each line. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardAdmin } from '@/lib/admin'
import { readPeriod } from '@/lib/period'
import { TRACE_COLUMNS, destinations, traceOne } from '@/lib/stock-trace'
import { CHART_SERIES, REMAINDER, SegmentedBar } from '@/components/admin/charts'
import { PeriodFilter } from '@/components/PeriodFilter'
import { Empty, PageHead } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

const when = (d: Date) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Nicosia' }).format(d)

export default async function StockTraceOnePage({ params, searchParams }: { params: Promise<{ variantId: string }>; searchParams: Promise<SP> }) {
  const { variantId } = await params
  await guardAdmin(`/admin/reports/stock/${variantId}`)
  if (!/^[0-9a-f-]{36}$/i.test(variantId)) notFound()
  const period = readPeriod(await searchParams, 'all')
  const t = await traceOne(variantId, period)
  if (!t) notFound()
  const name = `${t.head.product.en ?? Object.values(t.head.product)[0]} ${[t.head.flavour?.en, t.head.size].filter(Boolean).join(', ')}`

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/reports/stock" className="text-muted hover:underline">
          ← Where the stock went
        </Link>
      </p>
      <PageHead title={name} sub={<span className="font-mono">{t.head.sku}</span>} />
      <PeriodFilter path={`/admin/reports/stock/${variantId}`} period={period} fallback="all" />

      {t.summary && (
        <div className="mb-6 rounded-2xl border border-line bg-paper p-5">
          <h2 className="mb-4 text-sm font-semibold">Where the units went</h2>
          <SegmentedBar parts={destinations(t.summary.values, t.summary.onShelf).map((d, i) => ({ ...d, color: d.key === 'shelf' ? REMAINDER : CHART_SERIES[i] }))} />
        </div>
      )}

      {t.summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {TRACE_COLUMNS.filter((c) => t.summary!.values[c.key] !== 0).map((c) => (
            <div key={c.key} className="rounded-2xl border border-line bg-paper-2/60 p-4">
              <p className="text-xs text-muted">{c.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${t.summary!.values[c.key] < 0 ? 'text-sale' : 'text-ok'}`}>
                {t.summary!.values[c.key] > 0 ? '+' : ''}
                {t.summary!.values[c.key]}
              </p>
            </div>
          ))}
          {t.summary.unexplained ? (
            <div className="rounded-2xl border border-accent/50 p-4">
              <p className="text-xs text-muted">Not explained</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-accent">{t.summary.unexplained > 0 ? '+' : ''}{t.summary.unexplained}</p>
            </div>
          ) : null}
          <div className="rounded-2xl border border-line bg-paper p-4">
            <p className="text-xs text-muted">On shelf now</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{t.summary.onShelf}</p>
          </div>
        </div>
      )}

      {t.lines.length === 0 ? (
        <Empty>Nothing moved in this period.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label px-4 py-3 text-muted">Date</th>
                <th className="label px-4 py-3 text-muted">What</th>
                <th className="label px-4 py-3 text-right text-muted">Units</th>
                <th className="label px-4 py-3 text-muted">Order, purchase or note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {t.lines.map((l, i) => (
                <tr key={i} className={l.undone ? 'text-muted line-through' : ''}>
                  <td className="px-4 py-3 whitespace-nowrap">{when(l.at)}</td>
                  <td className="px-4 py-3">
                    {l.label}
                    {l.undone && <span className="ml-2 text-[10px] font-semibold uppercase">Undone</span>}
                  </td>
                  <td className={`px-4 py-3 text-right font-medium tabular-nums ${l.units < 0 ? 'text-sale' : 'text-ok'}`}>
                    {l.units > 0 ? '+' : ''}
                    {l.units}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {l.ref && (
                      <Link
                        href={l.ref.type === 'order' ? `/admin/orders/${l.ref.id}` : l.ref.type === 'purchase' ? `/admin/purchases/${l.ref.id}` : `/admin/wholesale/${l.ref.id}`}
                        className="mr-2 font-mono text-heading underline-offset-4 hover:underline"
                      >
                        {l.ref.label}
                      </Link>
                    )}
                    <span className="text-muted">{l.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
