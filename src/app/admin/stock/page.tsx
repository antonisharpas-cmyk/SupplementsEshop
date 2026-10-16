/* ============================================================================
 * Stock: every variant (product × colour × size) as its own line.
 *
 * Opens on "Needs attention" when anything does — sizes of products on sale
 * to customers that are running low or out — so the first screen of the day
 * is the to-do list, not 80 lines of things that are fine.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import {
  catalogueFacets,
  listStockRows,
  parseStockFilters,
  stockViewCounts,
  type StockView,
} from '@/lib/admin-catalog'
import { getSettings } from '@/lib/settings'
import { FilterBar } from '@/components/admin/FilterBar'
import { StockEditor } from '@/components/admin/StockEditor'
import { Empty, PageHead, Pagination, withParams } from '@/components/admin/ui'
import { db } from '@/db'
import { products } from '@/db/schema'
import { desc, eq, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

const VIEWS: { key: StockView; label: string; hint: string }[] = [
  { key: 'attention', label: 'Needs attention', hint: 'Low or out, on products customers can buy' },
  { key: 'all', label: 'All', hint: 'Every size' },
  { key: 'low', label: 'Low stock', hint: 'A few left' },
  { key: 'sold_out', label: 'Sold out', hint: 'None available' },
  { key: 'in_stock', label: 'In stock', hint: 'At least one available' },
]

export default async function AdminStockPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/stock')
  const sp = await searchParams
  const settings = await getSettings(['low_stock_threshold'])
  const low = settings.low_stock_threshold
  const filters = parseStockFilters(sp)

  const counts = await stockViewCounts(filters, low)
  /* No view chosen: start where the work is. */
  const view: StockView = filters.view ?? (counts.attention > 0 ? 'attention' : 'all')
  const [{ rows, total, page, pages }, facets, productName] = await Promise.all([
    listStockRows({ ...filters, view }, low),
    catalogueFacets(),
    filters.product && /^[0-9a-f-]{36}$/i.test(filters.product)
      ? db
          .select({ name: products.name })
          .from(products)
          .where(eq(products.id, filters.product))
          .then((r) => r[0]?.name.en ?? null)
      : Promise.resolve(null),
  ])

  /* A product with no size yet has nothing to count. Say so here, rather
     than leaving it missing from the list. */
  const noSizes = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(sql`not exists (select 1 from product_variants v where v.product_id = ${products.id})`)
    .orderBy(desc(products.createdAt))
    .limit(20)

  return (
    <>
      <PageHead
        title="Stock"
        sub={
          <>
            Click a number, type what is on the shelf, press <kbd className="font-mono">Enter</kbd>. It saves
            and moves to the next line. Low means {low} or fewer available.
          </>
        }
      />

      {noSizes.length > 0 && (
        <div className="mb-6 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 text-sm">
          <p className="font-medium text-heading">
            {noSizes.length === 1 ? 'This product has' : 'These products have'} no size yet, so there is no stock to count:
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {noSizes.map((p) => (
              <li key={p.id}>
                <Link href={`/admin/products/${p.id}#variants`} className="btn btn-primary btn-sm">
                  Add size and stock: {p.name.en ?? Object.values(p.name)[0]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div role="tablist" aria-label="Quick views" className="mb-5 flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const active = v.key === view
          const n = counts[v.key]
          return (
            <Link
              key={v.key}
              role="tab"
              aria-selected={active}
              title={v.hint}
              href={withParams('/admin/stock', sp, { view: v.key, page: null })}
              className={`inline-flex items-center gap-2 border px-3.5 py-2.5 text-sm transition-colors ${
                active ? 'border-ink bg-accent text-paper' : 'border-line bg-paper hover:border-ink'
              }`}
            >
              {v.label}
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  active
                    ? 'bg-paper/20'
                    : v.key === 'attention' && n > 0
                      ? 'bg-sale/10 text-sale'
                      : 'bg-paper-2 text-muted'
                }`}
              >
                {n}
              </span>
            </Link>
          )
        })}
      </div>

      {productName && (
        <p className="mb-4 flex items-center gap-3 text-sm">
          <span>
            Showing <strong>{productName}</strong> only.
          </span>
          <Link href={withParams('/admin/stock', sp, { product: null, page: null })} className="text-muted underline hover:text-ink">
            Show every product
          </Link>
        </p>
      )}

      <FilterBar
        searchPlaceholder="Search product, SKU, flavour or size, e.g. “chocolate”, “1kg”, “whey”"
        keep={['view', 'product']}
        menus={[
          { param: 'dept', label: 'Range', options: facets.departments.map((d) => ({ value: d.slug, label: d.name })) },
          {
            param: 'cat',
            label: 'Category',
            options: facets.categories.map((c) => ({ value: c.id, label: c.name, group: c.department })),
          },
          {
            param: 'colour',
            label: 'Flavour',
            options: facets.colours.map((c) => ({ value: c.name, label: c.name, swatch: c.hex })),
          },
          { param: 'size', label: 'Size', options: facets.sizes.map((s) => ({ value: s, label: s })) },
        ]}
        sorts={[
          { value: 'attention', label: 'Sold out, then low, first' },
          { value: 'available-asc', label: 'Available, fewest first' },
          { value: 'available-desc', label: 'Available, most first' },
          { value: 'product', label: 'Product' },
          { value: 'category', label: 'Category' },
          { value: 'colour', label: 'Flavour' },
          { value: 'size', label: 'Size' },
        ]}
      />

      {rows.length === 0 ? (
        <Empty>
          {view === 'attention'
            ? 'Nothing needs attention. Every size customers can buy has more than a few left.'
            : view === 'sold_out'
              ? 'No sizes are sold out.'
              : view === 'low'
                ? 'Nothing is running low.'
                : 'No sizes match these filters.'}
        </Empty>
      ) : (
        <StockEditor
          /* A new list (other view, filter or page) starts fresh rather than
             carrying the last list's "Saved ✓" marks. */
          key={JSON.stringify({ ...filters, view })}
          lines={rows}
          lowStockThreshold={low}
        />
      )}

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun={['size', 'sizes']}
        href={(p) => withParams('/admin/stock', sp, { page: p, view })}
      />

      <p className="mt-6 text-xs text-muted">
        <strong className="font-medium">Held</strong> units are in live customer bags and come back by themselves if
        the customer does not check out. You cannot set the shelf count below what is held.
      </p>
    </>
  )
}
