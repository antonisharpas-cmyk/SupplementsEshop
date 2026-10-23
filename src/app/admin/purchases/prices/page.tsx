/* What one product cost, purchase by purchase: the supplier's prices over time. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { boughtVariants, priceHistory } from '@/lib/purchases'
import { costsOf, variantLabel } from '@/lib/stock'
import { formatMoney } from '@/lib/pricing'
import { UUID } from '@/lib/api'
import { Empty, Table, btn, input } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Price history' }

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await guardFinance('/admin/purchases/prices')
  const { v } = await searchParams
  const variants = (await boughtVariants()).map((x) => ({ ...x, label: variantLabel(x) })).sort((a, b) => a.label.localeCompare(b.label))
  const chosen = v && UUID.test(v) ? v : variants[0]?.variantId
  const history = chosen ? await priceHistory(chosen) : []
  const avg = chosen ? ((await costsOf([chosen])).get(chosen) ?? 0) : 0
  const money = (c: number) => formatMoney(Math.round(c), 'en')
  const oldest = history[history.length - 1]
  const newest = history[0]
  const change = oldest && newest && oldest.unitNetCents > 0 ? (newest.unitNetCents - oldest.unitNetCents) / oldest.unitNetCents : null

  if (variants.length === 0) return <Empty>Price history appears once you have entered purchases.</Empty>
  return (
    <>
      <form className="mb-6 flex flex-wrap gap-2" action="/admin/purchases/prices">
        <select name="v" defaultValue={chosen} className={`${input} max-w-md`}>
          {variants.map((x) => (
            <option key={x.variantId} value={x.variantId}>
              {x.label} ({x.sku})
            </option>
          ))}
        </select>
        <button className={btn.secondary}>Show</button>
      </form>
      <p className="mb-4 text-sm text-muted">
        Average cost now: <b className="text-ink">{money(avg)}</b>
        {change !== null && history.length > 1 && (
          <>
            {' '}
            · supplier price {change >= 0 ? 'up' : 'down'} <b className={change > 0 ? 'text-sale' : 'text-ok'}>{Math.abs(Math.round(change * 1000) / 10)}%</b> since {oldest.date}
          </>
        )}
      </p>
      <Table head={['Date', 'Purchase', 'Supplier', 'Qty', 'Free', 'Unit price', 'True cost / unit']} rightFrom={3}>
        {history.map((h) => (
          <tr key={`${h.purchaseId}-${h.unitNetCents}-${h.quantity}`}>
            <td className="px-4 py-3">{h.date}</td>
            <td className="px-4 py-3 font-mono text-xs">
              <Link href={`/admin/purchases/${h.purchaseId}`} className="hover:text-accent">
                {h.number}
              </Link>
            </td>
            <td className="px-4 py-3">{h.supplier}</td>
            <td className="px-4 py-3 text-right tabular-nums">{h.quantity}</td>
            <td className="px-4 py-3 text-right tabular-nums">{h.freeQuantity || '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(h.unitNetCents)}</td>
            <td className="px-4 py-3 text-right tabular-nums font-medium">{h.landedUnitCents === null ? <span className="text-muted">not received</span> : money(h.landedUnitCents)}</td>
          </tr>
        ))}
      </Table>
    </>
  )
}
