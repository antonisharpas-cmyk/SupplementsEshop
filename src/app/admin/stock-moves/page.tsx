/* Stock that moved without an online sale: purchases in, wholesale out,
   samples, gifts, own use, damaged, expired, counts and supplier extras. */

import Link from 'next/link'
import { canSeeFinance, guardAdmin } from '@/lib/admin'
import { listMovements, MOVEMENT_KINDS, stockWithCosts, variantLabel, type MovementKind } from '@/lib/stock'
import { monthRange } from '@/lib/finance'
import { cyprusDayStart } from '@/lib/invoices'
import { formatMoney } from '@/lib/pricing'
import { Empty, Pagination, Table, btn, input } from '@/components/admin/ui'
import { MonthNav, thisMonth } from '@/components/admin/finance/MonthNav'
import { MovementForm } from '@/components/admin/finance/MovementForm'
import { CATALOGUE_TABS, SectionTabs } from '@/components/admin/SectionTabs'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stock movements' }

type SP = Record<string, string | string[] | undefined>

export default async function StockMovesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await guardAdmin('/admin/stock-moves')
  const finance = canSeeFinance(user)
  const sp = await searchParams
  const get = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : undefined)
  const all = get('all') === '1'
  const month = all ? null : (get('month') ?? thisMonth())
  const range = month ? monthRange(month) : null
  const kind = get('kind')
  const page = Number(get('page')) || 1
  const [list, stock] = await Promise.all([
    listMovements({ from: range ? cyprusDayStart(range.from)! : undefined, to: range ? cyprusDayStart(range.toExclusive)! : undefined, kind, page }),
    stockWithCosts(),
  ])
  const params = { month: month ?? undefined, all: all ? '1' : undefined, kind }
  const when = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'Europe/Nicosia' }).format(d)

  return (
    <>
      <SectionTabs label="Catalogue" tabs={CATALOGUE_TABS} />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Stock movements</h1>
        <p className="mt-1 text-sm text-muted">Everything that changed stock apart from online orders, each with a reason.</p>
      </div>
      <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-4 text-muted">Record a movement</h2>
        <MovementForm variants={stock.map((v) => ({ variantId: v.variantId, label: variantLabel(v), sku: v.sku, onHand: v.onHand }))} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav base="/admin/stock-moves" params={params} month={month} />
        <form action="/admin/stock-moves" className="mb-5 flex gap-2">
          {month && <input type="hidden" name="month" value={month} />}
          <select name="kind" defaultValue={kind ?? ''} className={`${input} max-w-[16rem]`}>
            <option value="">Every kind</option>
            {Object.entries(MOVEMENT_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <button className={btn.secondary}>Filter</button>
        </form>
      </div>

      {list.rows.length === 0 ? (
        <Empty>No stock movements {month ? 'this month' : 'yet'}.</Empty>
      ) : (
        <>
          <Table head={finance ? ['Date', 'What', 'Product', 'Units', 'Cost / unit', 'Value', 'Note'] : ['Date', 'What', 'Product', 'Units', 'Note']} rightFrom={3}>
            {list.rows.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-3 whitespace-nowrap">{when(m.occurredAt)}</td>
                <td className="px-4 py-3">{MOVEMENT_KINDS[m.kind as MovementKind]?.label ?? m.kind}</td>
                <td className="px-4 py-3">
                  {variantLabel(m)} <span className="font-mono text-[11px] text-muted">{m.sku}</span>
                </td>
                <td className={`px-4 py-3 text-right tabular-nums font-medium ${m.quantity < 0 ? 'text-sale' : 'text-ok'}`}>
                  {m.quantity > 0 ? '+' : ''}
                  {m.quantity}
                </td>
                {finance && (
                  <>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(Math.round(m.unitCostCents), 'en')}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(Math.round(m.quantity * m.unitCostCents), 'en')}</td>
                  </>
                )}
                <td className="px-4 py-3 text-right text-xs text-muted">
                  {m.refType === 'purchase' && m.refId ? (
                    <Link href={`/admin/purchases/${m.refId}`} className="hover:text-accent">
                      {m.note}
                    </Link>
                  ) : m.refType === 'wholesale' && m.refId && finance ? (
                    <Link href={`/admin/wholesale/${m.refId}`} className="hover:text-accent">
                      {m.note}
                    </Link>
                  ) : (
                    m.note
                  )}
                  {m.photoCount > 0 && <span className="ml-2">· {m.photoCount} photo{m.photoCount === 1 ? '' : 's'}</span>}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={list.page} pages={list.pages} total={list.total} noun={['movement', 'movements']} href={(p: number) => `/admin/stock-moves?${new URLSearchParams({ ...(month ? { month } : { all: '1' }), ...(kind ? { kind } : {}), page: String(p) })}`} />
        </>
      )}
    </>
  )
}
