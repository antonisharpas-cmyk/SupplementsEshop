/* ============================================================================
 * Listing filters ⇄ the address bar.
 *
 * The URL is the single source of truth for what a listing shows. The server
 * page parses it with `parseListingParams`; the filter panel in the browser
 * builds the next URL with `listingHref`. Both use this one file, so the two
 * sides can never disagree about what `?size=M&colour=black` means — and a
 * filtered view survives a refresh, the back and forward buttons, and being
 * pasted into a message.
 *
 *   /en/women?size=M,L&colour=black,blue&minPrice=40&maxPrice=100&inStock=1
 *
 * Prices in the address are whole euros ("40", not "4000" cents): people read
 * and share these links. They become cents only in `toProductQuery`.
 *
 * The logic, stated once:
 *   · within a group, OR  — size M or L; black or blue
 *   · between groups, AND — (M or L) and (black or blue) and €40–€100
 *
 * No imports: this runs in the browser as well as on the server.
 * ========================================================================== */

export const SORTS = ['newest', 'price-asc', 'price-desc', 'name-asc', 'popular'] as const
export type ListingSort = (typeof SORTS)[number]

export type ListingFilters = {
  q?: string
  sizes: string[]
  /** Colour keys: "black", "washed-black" — see `colourKey`. */
  colours: string[]
  /** Subcategory slugs within the page's department ("hoodies"), or
   *  "department/slug" on pages that span departments ("men/hoodies"). */
  categories: string[]
  /** Department slug, on pages that span departments. */
  department?: string
  /** Whole euros, inclusive. */
  minPrice?: number
  maxPrice?: number
  onSale: boolean
  inStock: boolean
  sort: ListingSort
  page: number
}

export const EMPTY_FILTERS: ListingFilters = {
  sizes: [],
  colours: [],
  categories: [],
  onSale: false,
  inStock: false,
  sort: 'newest',
  page: 1,
}

const MAX_PRICE_EUROS = 1_000_000

type Params = URLSearchParams | Record<string, string | string[] | undefined>

function read(p: Params, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = p instanceof URLSearchParams ? p.get(key) : p[key]
    const one = Array.isArray(v) ? v.join(',') : v
    if (one !== undefined && one !== null && one !== '') return one
  }
  return undefined
}

function list(raw: string | undefined, ok: RegExp, max = 30): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const v = part.trim()
    if (v && v.length <= 60 && ok.test(v)) seen.add(v)
    if (seen.size >= max) break
  }
  return [...seen]
}

const SIZE_OK = /^[\p{L}\p{N} .\-/]+$/u
const KEY_OK = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/

/** Whole, non-negative euros, or nothing. "12.50" → 12 for a minimum
 *  (round down, so €12.50 is still included) and 13 for a maximum (round up). */
function euros(raw: string | undefined, direction: 'down' | 'up'): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return undefined
  const whole = direction === 'down' ? Math.floor(n) : Math.ceil(n)
  return Math.min(whole, MAX_PRICE_EUROS)
}

const truthy = (v: string | undefined) => v === '1' || v === 'true' || v === 'on'

export function parseListingParams(p: Params): ListingFilters {
  let minPrice = euros(read(p, 'minPrice'), 'down')
  let maxPrice = euros(read(p, 'maxPrice'), 'up')
  /* A minimum above the maximum is someone's typo, not a request for
     nothing: read it the right way round. */
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    ;[minPrice, maxPrice] = [maxPrice, minPrice]
  }
  const sort = read(p, 'sort')
  const page = Number(read(p, 'page'))
  const q = read(p, 'q')?.trim().slice(0, 120)
  const department = read(p, 'department')
  return {
    q: q || undefined,
    sizes: list(read(p, 'size', 'sizes'), SIZE_OK),
    colours: list(read(p, 'colour', 'color')?.toLowerCase(), KEY_OK),
    categories: list(read(p, 'category')?.toLowerCase(), KEY_OK),
    department: department && KEY_OK.test(department) && !department.includes('/') ? department : undefined,
    minPrice,
    maxPrice,
    onSale: truthy(read(p, 'sale', 'onSale')),
    inStock: truthy(read(p, 'inStock', 'inStockOnly')),
    sort: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as ListingSort) : 'newest',
    page: Number.isInteger(page) && page >= 1 && page <= 1000 ? page : 1,
  }
}

/** The canonical query string: fixed key order, defaults left out, so the
 *  same filters always produce the same, shortest URL. */
export function listingSearchParams(f: ListingFilters): URLSearchParams {
  const out = new URLSearchParams()
  if (f.q) out.set('q', f.q)
  if (f.department) out.set('department', f.department)
  if (f.categories.length) out.set('category', f.categories.join(','))
  if (f.sizes.length) out.set('size', f.sizes.join(','))
  if (f.colours.length) out.set('colour', f.colours.join(','))
  if (f.minPrice !== undefined) out.set('minPrice', String(f.minPrice))
  if (f.maxPrice !== undefined) out.set('maxPrice', String(f.maxPrice))
  if (f.onSale) out.set('sale', '1')
  if (f.inStock) out.set('inStock', '1')
  if (f.sort !== 'newest') out.set('sort', f.sort)
  if (f.page > 1) out.set('page', String(f.page))
  return out
}

export function listingHref(basePath: string, f: ListingFilters): string {
  const qs = listingSearchParams(f).toString()
  return qs ? `${basePath}?${qs}` : basePath
}

/** Filters that narrow the results — not sort, page or the search words. */
export function activeFilterCount(f: ListingFilters): number {
  return (
    f.sizes.length +
    f.colours.length +
    f.categories.length +
    (f.department ? 1 : 0) +
    (f.minPrice !== undefined || f.maxPrice !== undefined ? 1 : 0) +
    (f.onSale ? 1 : 0) +
    (f.inStock ? 1 : 0)
  )
}

/** Every narrowing filter removed; the search words and sort are kept. */
export function clearFilters(f: ListingFilters): ListingFilters {
  return { ...EMPTY_FILTERS, q: f.q, sort: f.sort }
}

/** A colour's key, from its English name: "Washed Black" → "washed-black".
 *  The database computes the same thing (see catalog.ts, COLOUR_KEY_SQL). */
export function colourKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value]
}
