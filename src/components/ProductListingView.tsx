/* ============================================================================
 * A listing page — department, subcategory, new arrivals, sale, search.
 *
 * The URL holds the filters (lib/listing-filters.ts); the server runs the
 * query (lib/listing.ts → catalog.ts) and renders the products here. The
 * filter controls around them are client components that change the URL —
 * they never filter anything themselves — so what the page shows and what
 * the filters say can never disagree.
 *
 * Desktop: a quiet sidebar of collapsible groups, applied as you choose.
 * Phone:   one "Filter & sort" button and a drawer with a live result count.
 * ========================================================================== */

import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import type { ProductListing } from '@/lib/catalog'
import { listingHref, type ListingFilters } from '@/lib/listing-filters'
import { ProductCard } from './ProductCard'
import { ListingShell, type ListingScope } from './listing/ListingShell'
import { FilterSidebar, MobileFilters, NoResults, Results, ResultsBar } from './listing/ListingControls'

export function ProductListingView({
  locale,
  title,
  intro,
  breadcrumb = [],
  listing,
  filters,
  basePath,
  ctx,
  salePage = false,
}: {
  locale: Locale
  title: string
  intro?: string
  breadcrumb?: { label: string; href: string }[]
  listing: ProductListing
  filters: ListingFilters
  basePath: string
  /** "women", "women/leggings", "new", "sale" or "search" — see /api/products/count. */
  ctx: string
  salePage?: boolean
}) {
  const t = getTranslator(locale)
  const scope: ListingScope = ctx.includes('/')
    ? 'subcategory'
    : ['new', 'sale', 'search'].includes(ctx)
      ? 'all'
      : 'department'
  const page = (n: number) => listingHref(basePath, { ...filters, page: n })

  return (
    <ListingShell
      data={{ locale, basePath, ctx, scope, salePage, filters, facets: listing.facets, total: listing.total }}
    >
      <div className="container-x pb-16 pt-8">
        {breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-3 flex gap-2 text-xs text-muted">
            {breadcrumb.map((crumb) => (
              <span key={crumb.href} className="flex gap-2">
                <Link href={crumb.href} className="hover:underline">
                  {crumb.label}
                </Link>
                <span aria-hidden>/</span>
              </span>
            ))}
            <span className="text-ink">{title}</span>
          </nav>
        )}

        <header className="mb-6 lg:mb-8">
          <h1 className="text-[clamp(1.7rem,4vw,2.6rem)] font-semibold leading-tight tracking-tight">{title}</h1>
          {intro && <p className="mt-1.5 max-w-xl text-sm text-muted">{intro}</p>}
        </header>

        {/* Stays in reach under the header while the grid scrolls. */}
        <div className="sticky top-[101px] z-30 -mx-[var(--spacing-gutter)] mb-5 bg-paper/95 px-[var(--spacing-gutter)] py-2 backdrop-blur lg:hidden">
          <MobileFilters />
        </div>

        <div className="grid gap-10 lg:grid-cols-[14.5rem_minmax(0,1fr)] xl:gap-14">
          <FilterSidebar />

          <div>
            <ResultsBar />
            <Results>
              {listing.items.length === 0 ? (
                <NoResults />
              ) : (
                <>
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-9 md:grid-cols-3 xl:grid-cols-4">
                    {listing.items.map((product, i) => (
                      <li key={product.id}>
                        <ProductCard product={product} locale={locale} priority={i < 4} />
                      </li>
                    ))}
                  </ul>

                  {listing.totalPages > 1 && (
                    <nav
                      aria-label="Pagination"
                      className="mt-14 flex items-center justify-between border-t border-line pt-6"
                    >
                      {listing.page > 1 ? (
                        <Link href={page(listing.page - 1)} className="label hover:underline" rel="prev">
                          ← {t('list.previous')}
                        </Link>
                      ) : (
                        <span className="label text-line-strong">← {t('list.previous')}</span>
                      )}
                      <span className="text-xs text-muted">
                        {t('list.page', { page: listing.page, total: listing.totalPages })}
                      </span>
                      {listing.page < listing.totalPages ? (
                        <Link href={page(listing.page + 1)} className="label hover:underline" rel="next">
                          {t('list.next')} →
                        </Link>
                      ) : (
                        <span className="label text-line-strong">{t('list.next')} →</span>
                      )}
                    </nav>
                  )}
                </>
              )}
            </Results>
          </div>
        </div>
      </div>
    </ListingShell>
  )
}
