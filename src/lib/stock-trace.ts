/* ============================================================================
 * Where the stock went: for every size, how many units came in and where
 * each one went (sold online, sold wholesale, samples, opened, lost…), for a
 * period, plus what is on the shelf now.
 *
 *   Online sales come from the orders (every order except cancelled ones,
 *   whose units went back on the shelf). Everything else comes from Stock
 *   history. Undone mistakes cancel out, because their opposite line has
 *   the same kind.
 *
 *   For "All time" the columns must add up to the shelf. "Not explained" is
 *   whatever does not: changes made before every change was recorded.
 * ========================================================================== */

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { MOVEMENT_KINDS, type MovementKind } from '@/lib/stock'

export type Period = { from?: string | null; to?: string | null }

/** The columns, in order, with the movement kinds each one adds up. */
export const TRACE_COLUMNS = [
  { key: 'bought', label: 'Bought', kinds: ['PURCHASE', 'PURCHASE_UNDO'] },
  { key: 'free', label: 'Free from supplier', kinds: ['SUPPLIER_EXTRA'] },
  { key: 'opening', label: 'Opening stock', kinds: ['OPENING'] },
  { key: 'returned', label: 'Returned', kinds: ['ORDER_RETURN', 'WHOLESALE_RETURN'] },
  { key: 'online', label: 'Sold online', kinds: [] },
  { key: 'wholesale', label: 'Sold wholesale', kinds: ['WHOLESALE'] },
  { key: 'samples', label: 'Samples and gifts', kinds: ['SAMPLE', 'GIFT'] },
  { key: 'opened', label: 'Opened or own use', kinds: ['OWN_USE'] },
  { key: 'lost', label: 'Damaged, expired or lost', kinds: ['DAMAGED', 'EXPIRED', 'LOST'] },
  { key: 'count', label: 'Count corrections', kinds: ['COUNT'] },
] as const

export type TraceKey = (typeof TRACE_COLUMNS)[number]['key']

const DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v?: string | null) => (v && DAY.test(v) ? v : null)
const CY = (col: string) => sql.raw(`(${col} at time zone 'Europe/Nicosia')::date`)

function periodSql(col: string, p: Period) {
  const from = day(p.from)
  const to = day(p.to)
  return sql`${from ? sql`and ${CY(col)} >= ${from}::date` : sql``} ${to ? sql`and ${CY(col)} <= ${to}::date` : sql``}`
}

const columnOf = new Map<string, TraceKey>(TRACE_COLUMNS.flatMap((c) => c.kinds.map((k) => [k, c.key] as [string, TraceKey])))

export type TraceRow = {
  variantId: string
  productId: string
  product: Record<string, string>
  flavour: Record<string, string> | null
  size: string
  sku: string
  values: Record<TraceKey, number>
  onShelf: number
  /** All time only: what the recorded changes do not account for. */
  unexplained: number | null
}

/** Every size that moved in the period (or has stock), with its columns. */
export async function traceAll(period: Period, opts: { q?: string } = {}): Promise<TraceRow[]> {
  const allTime = !day(period.from) && !day(period.to)
  const q = opts.q?.trim().toLowerCase().slice(0, 80)
  const [variants, moves, online] = await Promise.all([
    db.execute<{ id: string; product_id: string; product: Record<string, string>; flavour: Record<string, string> | null; size: string; sku: string; on_hand: number }>(sql`
      select v.id, p.id as product_id, p.name as product, v.color_name as flavour, v.size, v.sku, coalesce(i.on_hand, 0)::int as on_hand
      from product_variants v join products p on p.id = v.product_id left join inventory i on i.variant_id = v.id
      ${q ? sql`where lower(p.name->>'en') like ${`%${q}%`} or lower(v.sku) like ${`%${q}%`} or lower(coalesce(v.color_name->>'en', '')) like ${`%${q}%`}` : sql``}
      order by p.name->>'en', v.position`),
    db.execute<{ variant_id: string; kind: string; units: number }>(sql`
      select variant_id, kind, sum(quantity)::int as units from stock_movements m
      where true ${periodSql('m.occurred_at', period)}
      group by 1, 2`),
    db.execute<{ variant_id: string; units: number }>(sql`
      select oi.variant_id, sum(oi.quantity)::int as units
      from order_items oi join orders o on o.id = oi.order_id
      where oi.variant_id is not null and o.status <> 'CANCELLED' ${periodSql('o.created_at', period)}
      group by 1`),
  ])

  const empty = () => Object.fromEntries(TRACE_COLUMNS.map((c) => [c.key, 0])) as Record<TraceKey, number>
  const byVariant = new Map<string, Record<TraceKey, number>>()
  for (const m of moves.rows) {
    const col = columnOf.get(m.kind)
    if (!col) continue
    const v = byVariant.get(m.variant_id) ?? empty()
    v[col] += Number(m.units)
    byVariant.set(m.variant_id, v)
  }
  for (const o of online.rows) {
    const v = byVariant.get(o.variant_id) ?? empty()
    v.online -= Number(o.units)
    byVariant.set(o.variant_id, v)
  }

  return variants.rows
    .filter((v) => byVariant.has(v.id) || Number(v.on_hand) !== 0)
    .map((v) => {
      const values = byVariant.get(v.id) ?? empty()
      const net = Object.values(values).reduce((a, b) => a + b, 0)
      return {
        variantId: v.id,
        productId: v.product_id,
        product: v.product,
        flavour: v.flavour,
        size: v.size,
        sku: v.sku,
        values,
        onShelf: Number(v.on_hand),
        unexplained: allTime ? Number(v.on_hand) - net : null,
      }
    })
}

export type TraceLine = {
  at: Date
  kind: string
  label: string
  units: number
  note: string | null
  /** An order number, a purchase or a wholesale sale, to link to. */
  ref: { type: 'order' | 'purchase' | 'wholesale'; id: string; label: string } | null
  undone: boolean
}

/** One size: every line, newest first, for the period. */
export async function traceOne(variantId: string, period: Period) {
  const [head] = (
    await db.execute<{ product_id: string; product: Record<string, string>; flavour: Record<string, string> | null; size: string; sku: string }>(sql`
      select p.id as product_id, p.name as product, v.color_name as flavour, v.size, v.sku
      from product_variants v join products p on p.id = v.product_id where v.id = ${variantId}::uuid`)
  ).rows
  if (!head) return null
  const [moves, online, summary] = await Promise.all([
    db.execute<{ at: Date; kind: string; units: number; note: string | null; ref_type: string | null; ref_id: string | null; undone: boolean; ref_label: string | null }>(sql`
      select m.occurred_at as at, m.kind, m.quantity as units, m.note, m.ref_type, m.ref_id,
             exists (select 1 from stock_movements u where u.ref_type = 'undo' and u.ref_id = m.id) as undone,
             case m.ref_type
               when 'purchase' then (select number from purchases where id = m.ref_id)
               when 'wholesale' then (select number from wholesale_sales where id = m.ref_id)
             end as ref_label
      from stock_movements m
      where m.variant_id = ${variantId}::uuid and m.ref_type is distinct from 'undo' ${periodSql('m.occurred_at', period)}`),
    db.execute<{ at: Date; units: number; order_id: string; number: string; status: string }>(sql`
      select o.created_at as at, oi.quantity as units, o.id as order_id, o.order_number as number, o.status::text as status
      from order_items oi join orders o on o.id = oi.order_id
      where oi.variant_id = ${variantId}::uuid and o.status <> 'CANCELLED' ${periodSql('o.created_at', period)}`),
    traceAll(period).then((rows) => rows.find((r) => r.variantId === variantId) ?? null),
  ])
  const lines: TraceLine[] = [
    ...moves.rows.map((m) => ({
      at: new Date(m.at),
      kind: m.kind,
      label: MOVEMENT_KINDS[m.kind as MovementKind]?.label ?? m.kind,
      units: Number(m.units),
      note: m.note,
      ref:
        (m.ref_type === 'purchase' || m.ref_type === 'wholesale') && m.ref_id
          ? { type: m.ref_type as 'purchase' | 'wholesale', id: m.ref_id, label: m.ref_label ?? 'Open' }
          : null,
      undone: Boolean(m.undone),
    })),
    ...online.rows.map((o) => ({
      at: new Date(o.at),
      kind: 'ORDER',
      label: o.status === 'REFUNDED' ? 'Sold online (refunded)' : 'Sold online',
      units: -Number(o.units),
      note: null,
      ref: { type: 'order' as const, id: o.order_id, label: o.number },
      undone: false,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime())
  return { head, lines, summary }
}

/** Where the units went, as parts of one bar: every way out, then the shelf. */
export function destinations(values: Record<TraceKey, number>, onShelf: number) {
  const out = (k: TraceKey) => Math.max(0, -values[k])
  return [
    { key: 'online', label: 'Sold online', value: out('online') },
    { key: 'wholesale', label: 'Sold wholesale', value: out('wholesale') },
    { key: 'samples', label: 'Samples and gifts', value: out('samples') },
    { key: 'opened', label: 'Opened or own use', value: out('opened') },
    { key: 'lost', label: 'Damaged, expired or lost', value: out('lost') },
    { key: 'shelf', label: 'On the shelf now', value: Math.max(0, onShelf) },
  ]
}
