/* ============================================================================
 * The numbers: profit and loss by month, margin by product category,
 * spending by category, stock value and VAT.
 *
 * Everything is before VAT. A month is Cyprus time.
 *
 *   Sales          invoices less credit notes, online and wholesale apart
 *   Cost of sales  what the sold units cost (weighted average at the time
 *                  of sale, including their share of shipping and fees).
 *                  Fully refunded online orders count no cost.
 *   Gross profit   sales less cost of sales
 *   Stock out      samples, gifts, own use, damaged, expired: at cost
 *   Count          stock count corrections: a shortfall is a loss
 *   Expenses       by category, before reclaimable VAT
 *   Net profit     gross profit less all of the above
 * ========================================================================== */

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { stockValueSnapshots } from '@/db/schema'
import { OUT_WITHOUT_SALE, stockValue } from '@/lib/stock'
import { monthOf } from '@/lib/finance'

type MonthMap = Map<string, number>

const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[]
const toMap = (r: { month: string; v: number | string }[]): MonthMap => new Map(r.map((x) => [x.month, Number(x.v)]))
const cyMonth = (col: ReturnType<typeof sql>) => sql`to_char(${col} at time zone 'Europe/Nicosia', 'YYYY-MM')`

function range(months: string[]) {
  const first = `${months[0]}-01`
  const [y, m] = months[months.length - 1].split('-').map(Number)
  const after = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { first, after }
}

export type ProfitAndLoss = {
  months: string[]
  onlineSales: MonthMap
  wholesaleSales: MonthMap
  sales: MonthMap
  onlineCost: MonthMap
  wholesaleCost: MonthMap
  costOfSales: MonthMap
  grossProfit: MonthMap
  stockOut: { kind: string; byMonth: MonthMap }[]
  countDifference: MonthMap
  expenses: { category: string; byMonth: MonthMap }[]
  totalExpenses: MonthMap
  netProfit: MonthMap
  /** Online units sold without a known cost (before costs were tracked). */
  uncostedUnits: MonthMap
}

export async function profitAndLoss(months: string[]): Promise<ProfitAndLoss> {
  const { first, after } = range(months)
  const from = sql`(${first}::date at time zone 'Europe/Nicosia')`
  const to = sql`(${after}::date at time zone 'Europe/Nicosia')`

  const [online, whole, onlineCost, uncosted, wholeCost, out, count, exp] = await Promise.all([
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`issued_at`)} as month,
             sum(case when kind = 'CREDIT_NOTE' then -net_cents else net_cents end)::bigint as v
      from invoices where order_id is not null and issued_at >= ${from} and issued_at < ${to} group by 1`),
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`issued_at`)} as month,
             sum(case when kind = 'CREDIT_NOTE' then -net_cents else net_cents end)::bigint as v
      from invoices where wholesale_sale_id is not null and issued_at >= ${from} and issued_at < ${to} group by 1`),
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`i.issued_at`)} as month, sum(oi.quantity * coalesce(oi.unit_cost_cents, 0))::bigint as v
      from invoices i join orders o on o.id = i.order_id join order_items oi on oi.order_id = o.id
      where i.kind = 'INVOICE' and o.status <> 'REFUNDED' and i.issued_at >= ${from} and i.issued_at < ${to} group by 1`),
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`i.issued_at`)} as month, sum(oi.quantity)::bigint as v
      from invoices i join orders o on o.id = i.order_id join order_items oi on oi.order_id = o.id
      where i.kind = 'INVOICE' and o.status <> 'REFUNDED' and oi.unit_cost_cents is null
        and i.issued_at >= ${from} and i.issued_at < ${to} group by 1`),
    rows<{ month: string; v: number }>(sql`
      select substr(sale_date::text, 1, 7) as month, sum(cost_cents)::bigint as v
      from wholesale_sales where sale_date >= ${first}::date and sale_date < ${after}::date group by 1`),
    rows<{ month: string; kind: string; v: number }>(sql`
      select ${cyMonth(sql`occurred_at`)} as month, kind, sum(-quantity * unit_cost_cents)::bigint as v
      from stock_movements
      where kind in (${sql.join(OUT_WITHOUT_SALE.map((k) => sql`${k}`), sql`, `)}) and occurred_at >= ${from} and occurred_at < ${to}
      group by 1, 2`),
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`occurred_at`)} as month, sum(quantity * unit_cost_cents)::bigint as v
      from stock_movements where kind = 'COUNT' and occurred_at >= ${from} and occurred_at < ${to} group by 1`),
    rows<{ month: string; category: string; position: number; v: number }>(sql`
      select substr(e.expense_date::text, 1, 7) as month, c.name as category, c.position, sum(e.net_cents)::bigint as v
      from expenses e join expense_categories c on c.id = e.category_id
      where e.expense_date >= ${first}::date and e.expense_date < ${after}::date group by 1, 2, 3 order by 3, 2`),
  ])

  const sum = (...maps: MonthMap[]) => new Map(months.map((m) => [m, maps.reduce((n, x) => n + (x.get(m) ?? 0), 0)]))
  const neg = (m: MonthMap) => new Map([...m].map(([k, v]) => [k, -v]))
  const onlineSales = toMap(online)
  const wholesaleSales = toMap(whole)
  const sales = sum(onlineSales, wholesaleSales)
  const oc = toMap(onlineCost)
  const wc = toMap(wholeCost)
  const costOfSales = sum(oc, wc)
  const grossProfit = sum(sales, neg(costOfSales))

  const kinds = [...new Set(out.map((o) => o.kind))]
  const stockOut = kinds.map((kind) => ({ kind, byMonth: toMap(out.filter((o) => o.kind === kind)) }))
  const countDifference = toMap(count)
  const cats = [...new Set(exp.map((e) => e.category))]
  const expenses = cats.map((category) => ({ category, byMonth: toMap(exp.filter((e) => e.category === category)) }))
  const totalExpenses = sum(...expenses.map((e) => e.byMonth))
  const netProfit = sum(grossProfit, neg(sum(...stockOut.map((s) => s.byMonth))), countDifference, neg(totalExpenses))

  return {
    months,
    onlineSales,
    wholesaleSales,
    sales,
    onlineCost: oc,
    wholesaleCost: wc,
    costOfSales,
    grossProfit,
    stockOut,
    countDifference,
    expenses,
    totalExpenses,
    netProfit,
    uncostedUnits: toMap(uncosted),
  }
}

/* -------------------------------------------------- by product category -- */

export type CategoryMargin = { category: string; month: string; salesCents: number; costCents: number; units: number }

/**
 * Sales and cost per product category. An online line's share of its order's
 * net (VAT and promo codes taken off in proportion); wholesale lines as sold.
 */
export async function categoryMargins(months: string[]): Promise<CategoryMargin[]> {
  const { first, after } = range(months)
  const from = sql`(${first}::date at time zone 'Europe/Nicosia')`
  const to = sql`(${after}::date at time zone 'Europe/Nicosia')`
  const r = await rows<{ category: string; month: string; sales: number; cost: number; units: number }>(sql`
    with lines as (
      select coalesce(top.name->>'en', c.name->>'en', 'Other') as category,
             ${cyMonth(sql`i.issued_at`)} as month,
             oi.line_total_cents::float8 * i.net_cents / nullif(i.total_cents, 0) as sales,
             oi.quantity * coalesce(oi.unit_cost_cents, 0) as cost,
             oi.quantity as units
      from invoices i
      join orders o on o.id = i.order_id
      join order_items oi on oi.order_id = o.id
      left join products p on p.id = oi.product_id
      left join categories c on c.id = p.category_id
      left join categories top on top.id = c.parent_id
      where i.kind = 'INVOICE' and o.status <> 'REFUNDED' and i.issued_at >= ${from} and i.issued_at < ${to}
      union all
      select coalesce(top.name->>'en', c.name->>'en', 'Other'),
             substr(s.sale_date::text, 1, 7),
             l.line_net_cents::float8,
             (l.quantity - l.returned_quantity) * l.unit_cost_cents,
             l.quantity - l.returned_quantity
      from wholesale_lines l
      join wholesale_sales s on s.id = l.sale_id
      left join product_variants v on v.id = l.variant_id
      left join products p on p.id = v.product_id
      left join categories c on c.id = p.category_id
      left join categories top on top.id = c.parent_id
      where s.sale_date >= ${first}::date and s.sale_date < ${after}::date
    )
    select category, month, round(sum(sales))::bigint as sales, round(sum(cost))::bigint as cost, sum(units)::bigint as units
    from lines group by 1, 2 order by 1, 2`)
  return r.map((x) => ({ category: x.category, month: x.month, salesCents: Number(x.sales), costCents: Number(x.cost), units: Number(x.units) }))
}

/* ----------------------------------------------------------- spending -- */

export type Spending = { group: 'Stock' | 'Expenses'; category: string; month: string; cents: number }

/** Stock bought by product category (with its share of shipping and fees), and expenses by category. */
export async function spending(months: string[]): Promise<Spending[]> {
  const { first, after } = range(months)
  const [stock, exp] = await Promise.all([
    rows<{ category: string; month: string; v: number }>(sql`
      select coalesce(top.name->>'en', c.name->>'en', 'Other') as category,
             substr(pu.invoice_date::text, 1, 7) as month,
             round(sum(l.line_net_cents + case when pu.goods_net_cents > 0
               then (pu.shipping_cents + pu.other_fees_cents)::float8 * l.line_net_cents / pu.goods_net_cents else 0 end))::bigint as v
      from purchase_lines l
      join purchases pu on pu.id = l.purchase_id
      left join product_variants v on v.id = l.variant_id
      left join products p on p.id = v.product_id
      left join categories c on c.id = p.category_id
      left join categories top on top.id = c.parent_id
      where pu.status <> 'CANCELLED' and pu.invoice_date >= ${first}::date and pu.invoice_date < ${after}::date
      group by 1, 2`),
    rows<{ category: string; month: string; v: number }>(sql`
      select c.name as category, substr(e.expense_date::text, 1, 7) as month, sum(e.net_cents)::bigint as v
      from expenses e join expense_categories c on c.id = e.category_id
      where e.expense_date >= ${first}::date and e.expense_date < ${after}::date group by 1, 2`),
  ])
  return [
    ...stock.map((s) => ({ group: 'Stock' as const, category: s.category, month: s.month, cents: Number(s.v) })),
    ...exp.map((s) => ({ group: 'Expenses' as const, category: s.category, month: s.month, cents: Number(s.v) })),
  ]
}

/* ----------------------------------------------------------------- VAT -- */

export type VatMonth = {
  month: string
  /** VAT on sales, less credit notes. */
  outputCents: number
  /** VAT paid on purchases and expenses that can be reclaimed. */
  inputCents: number
  /** EU reverse charge: due and reclaimed at once (net effect nil). */
  reverseChargeCents: number
  /** Output less input: what is owed (negative: to be refunded). */
  payableCents: number
  /** Sales at 0% to EU businesses (for the VIES return). */
  euZeroSalesCents: number
  /** Purchases of goods from EU suppliers, before VAT (acquisitions). */
  euAcquisitionsCents: number
}

export async function vatSummary(months: string[]): Promise<VatMonth[]> {
  const { first, after } = range(months)
  const from = sql`(${first}::date at time zone 'Europe/Nicosia')`
  const to = sql`(${after}::date at time zone 'Europe/Nicosia')`
  const [out, pin, ein, zero] = await Promise.all([
    rows<{ month: string; v: number }>(sql`
      select ${cyMonth(sql`issued_at`)} as month, sum(case when kind = 'CREDIT_NOTE' then -vat_cents else vat_cents end)::bigint as v
      from invoices where issued_at >= ${from} and issued_at < ${to} group by 1`),
    rows<{ month: string; vat: number; rev: number; acq: number }>(sql`
      select substr(invoice_date::text, 1, 7) as month, sum(vat_cents)::bigint as vat, sum(reverse_vat_cents)::bigint as rev,
             sum(case when vat_treatment = 'EU_REVERSE' then goods_net_cents + shipping_cents + other_fees_cents else 0 end)::bigint as acq
      from purchases where status <> 'CANCELLED' and invoice_date >= ${first}::date and invoice_date < ${after}::date group by 1`),
    rows<{ month: string; vat: number; rev: number }>(sql`
      select substr(expense_date::text, 1, 7) as month, sum(vat_cents)::bigint as vat, sum(reverse_vat_cents)::bigint as rev
      from expenses where expense_date >= ${first}::date and expense_date < ${after}::date group by 1`),
    rows<{ month: string; v: number }>(sql`
      select substr(sale_date::text, 1, 7) as month, sum(net_cents)::bigint as v
      from wholesale_sales where vat_treatment = 'EU_ZERO' and sale_date >= ${first}::date and sale_date < ${after}::date group by 1`),
  ])
  const o = toMap(out)
  const p = new Map(pin.map((x) => [x.month, x]))
  const e = new Map(ein.map((x) => [x.month, x]))
  const z = toMap(zero)
  return months.map((month) => {
    const input = Number(p.get(month)?.vat ?? 0) + Number(e.get(month)?.vat ?? 0)
    const reverse = Number(p.get(month)?.rev ?? 0) + Number(e.get(month)?.rev ?? 0)
    const output = o.get(month) ?? 0
    return {
      month,
      outputCents: output,
      inputCents: input,
      reverseChargeCents: reverse,
      payableCents: output - input,
      euZeroSalesCents: z.get(month) ?? 0,
      euAcquisitionsCents: Number(p.get(month)?.acq ?? 0),
    }
  })
}

/* --------------------------------------------------------- stock value -- */

export async function stockValueByMonth(months: string[]) {
  const snaps = await db.select().from(stockValueSnapshots)
  const map = new Map(snaps.map((s) => [s.month, s.valueCents]))
  const now = await stockValue()
  const current = monthOf(new Date())
  return months.map((m) => ({ month: m, valueCents: m === current ? now.valueCents : (map.get(m) ?? null), live: m === current }))
}

/** On the automation clock: once in a new month, keep the value the previous month ended with. */
export async function snapshotStockValue(now = new Date()) {
  const thisMonth = monthOf(now)
  const [y, m] = thisMonth.split('-').map(Number)
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const value = await stockValue()
  const r = await db
    .insert(stockValueSnapshots)
    .values({ month: prev, valueCents: value.valueCents, units: value.units })
    .onConflictDoNothing()
    .returning()
  return r.length > 0
}
