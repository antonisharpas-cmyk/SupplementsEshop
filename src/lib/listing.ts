/* ============================================================================
 * One listing page, from address bar to products — used by every listing
 * (department, subcategory, new arrivals, sale, search) and by the live
 * "Show 12 results" count, so all of them read the URL the same way and
 * run the same query.
 * ========================================================================== */

import type { Locale } from '@/config/brand'
import { countProducts, listProducts } from '@/lib/catalog'
import { parseListingParams, type ListingFilters } from '@/lib/listing-filters'
import type { ProductQuery } from '@/lib/validation'

/** Where the listing is. `sale` pages only ever show reduced products. */
export type ListingContext = {
  category?: string
  subcategory?: string
  kind?: 'new' | 'sale' | 'search'
}

export const PER_PAGE = 24

export function toProductQuery(f: ListingFilters, ctx: ListingContext, locale: Locale): ProductQuery {
  return {
    category: ctx.category,
    subcategory: ctx.subcategory,
    q: f.q,
    sizes: f.sizes.length ? f.sizes : undefined,
    colours: f.colours.length ? f.colours : undefined,
    /* A subcategory page has nothing to narrow by category; a department
       page cannot be narrowed to another department. */
    categories: f.categories.length && !ctx.subcategory ? f.categories : undefined,
    department: ctx.category ? undefined : f.department,
    minPrice: f.minPrice !== undefined ? f.minPrice * 100 : undefined,
    maxPrice: f.maxPrice !== undefined ? f.maxPrice * 100 : undefined,
    onSale: ctx.kind === 'sale' || f.onSale || undefined,
    inStockOnly: f.inStock || undefined,
    sort: f.sort,
    page: f.page,
    perPage: PER_PAGE,
    locale,
  }
}

type Params = Record<string, string | string[] | undefined> | URLSearchParams

export async function loadListing(params: Params, ctx: ListingContext, locale: Locale) {
  const filters = parseListingParams(params)
  /* Filters that cannot apply here are dropped, so they neither show as
     chips nor survive into the next URL. */
  if (ctx.subcategory) filters.categories = []
  if (ctx.category) filters.department = undefined
  if (ctx.kind === 'sale') filters.onSale = false
  const listing = await listProducts(toProductQuery(filters, ctx, locale))
  return { filters, listing }
}

export async function countListing(params: Params, ctx: ListingContext, locale: Locale) {
  const filters = parseListingParams(params)
  return countProducts(toProductQuery({ ...filters, page: 1 }, ctx, locale))
}
