/* ============================================================================
 * Products: find one fast.
 *
 * Search and every filter run on the server (lib/admin-catalog.ts); the filter
 * bar only rewrites the address. Each row is one product and the whole row is
 * the link to its editor — no hunting for a small "Edit".
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import {
  catalogueFacets,
  listAdminProductRows,
  parseProductFilters,
} from '@/lib/admin-catalog'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { FilterBar } from '@/components/admin/FilterBar'
import { Empty, PageHead, Pagination, StatusBadge, StockCount, Thumb, btn, withParams } from '@/components/admin/ui'
import { CATALOGUE_TABS, SectionTabs } from '@/components/admin/SectionTabs'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/products')
  const sp = await searchParams
  const filters = parseProductFilters(sp)
  const settings = await getSettings(['low_stock_threshold'])
  const low = settings.low_stock_threshold
  const [{ rows, total, page, pages }, facets] = await Promise.all([
    listAdminProductRows(filters, low),
    catalogueFacets(),
  ])
  const filtered = Object.keys(sp).some((k) => k !== 'sort' && k !== 'page' && sp[k])

  return (
    <>
      <PageHead
        title="Products"
        sub={
          filtered
            ? `${total} match${total === 1 ? '' : 'es'}`
            : `${total} product${total === 1 ? '' : 's'} · click a row to edit it`
        }
        action={
          <Link href="/admin/products/new" className={btn.primary}>
            Add product
          </Link>
        }
      />
      <SectionTabs label="Catalogue" tabs={CATALOGUE_TABS} />
      {sp.deleted && (
        <p role="status" className="mb-6 border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">
          Product deleted.
        </p>
      )}

      <FilterBar
        searchPlaceholder="Search name, SKU, category or ID"
        price
        menus={[
          { param: 'dept', label: 'Range', options: facets.departments.map((d) => ({ value: d.slug, label: d.name })) },
          {
            param: 'cat',
            label: 'Category',
            options: facets.categories.map((c) => ({ value: c.id, label: c.name, group: c.department })),
          },
          {
            param: 'status',
            label: 'Status',
            options: [
              { value: 'available', label: 'Available' },
              { value: 'sold_out', label: 'Marked sold out' },
              { value: 'hidden', label: 'Hidden' },
            ],
          },
          {
            param: 'stock',
            label: 'Stock',
            options: [
              { value: 'in_stock', label: 'In stock' },
              { value: 'low', label: 'Some sizes low or out' },
              { value: 'sold_out', label: 'No stock at all' },
            ],
          },
          {
            param: 'sale',
            label: 'Sale',
            options: [
              { value: 'on_sale', label: 'On sale' },
              { value: 'full_price', label: 'Full price' },
            ],
          },
        ]}
        sorts={[
          { value: 'newest', label: 'Newest first' },
          { value: 'name', label: 'Name A–Z' },
          { value: 'price-asc', label: 'Price, low to high' },
          { value: 'price-desc', label: 'Price, high to low' },
          { value: 'stock-asc', label: 'Least stock first' },
        ]}
      />

      {rows.length === 0 ? (
        <Empty>
          {filtered ? (
            <>
              Nothing matches these filters.{' '}
              <Link href="/admin/products" className="underline hover:text-ink">
                Clear all filters
              </Link>
            </>
          ) : (
            'No products yet, run the seed to load the catalogue.'
          )}
        </Empty>
      ) : (
        <div className="border border-line bg-paper">
          <div
            aria-hidden
            className="hidden grid-cols-[3rem_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_6.5rem_8rem] gap-4 border-b border-line px-4 py-3 label text-muted lg:grid"
          >
            <span />
            <span>Product</span>
            <span>Category</span>
            <span>SKU</span>
            <span className="text-right">Price</span>
            <span className="text-right">Available</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-[var(--color-line)]">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/products/${row.id}`}
                  className={`grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper-2 focus-visible:bg-paper-2 lg:grid-cols-[3rem_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_7rem_6.5rem_8rem] ${
                    row.status === 'hidden' ? 'text-muted' : ''
                  }`}
                >
                  <span className="row-span-3 lg:row-span-1">
                    <Thumb src={row.image} alt="" />
                  </span>

                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{row.name}</span>
                    <span className="block truncate text-xs text-muted lg:hidden">
                      {row.department} · {row.category}
                    </span>
                  </span>

                  <span className="hidden truncate text-sm text-muted lg:block">
                    {row.department && <span className="text-xs">{row.department} · </span>}
                    {row.category}
                  </span>

                  <span className="hidden truncate font-mono text-xs text-muted lg:block">
                    {row.firstSku ?? '—'}
                    {row.skuCount > 1 && <span className="ml-1 font-sans">+{row.skuCount - 1}</span>}
                  </span>

                  <span className="text-right text-sm tabular-nums lg:order-none">
                    {row.finalCents < row.priceCents ? (
                      <>
                        <span className="text-sale">{formatMoney(row.finalCents, 'en')}</span>
                        <span className="block text-xs text-muted line-through">{formatMoney(row.priceCents, 'en')}</span>
                        {row.promotionName ? (
                          <span title="Managed in Catalogue, Promotions" className="block truncate text-xs text-sale">
                            {row.promotionName}
                          </span>
                        ) : (
                          <span className="block text-xs text-muted">sale price</span>
                        )}
                      </>
                    ) : (
                      formatMoney(row.priceCents, 'en')
                    )}
                  </span>

                  <span className="col-start-2 text-sm lg:col-start-auto lg:text-right">
                    <span className="mr-2 text-xs text-muted lg:hidden">Available</span>
                    <StockCount available={row.available} low={low} />
                    {row.available > 0 && row.sizesOut > 0 && (
                      <span className="block text-xs text-muted">
                        {row.sizesOut} size{row.sizesOut === 1 ? '' : 's'} out
                      </span>
                    )}
                  </span>

                  <span className="col-start-2 lg:col-start-auto">
                    <StatusBadge status={row.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Pagination
        page={page}
        pages={pages}
        total={total}
        noun={['product', 'products']}
        href={(p) => withParams('/admin/products', sp, { page: p })}
      />
    </>
  )
}
