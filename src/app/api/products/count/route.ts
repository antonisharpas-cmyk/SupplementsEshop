/* ============================================================================
 * GET /api/products/count?ctx=women/leggings&size=M&colour=black…
 *
 * How many products a set of filters would show — the number on the phone
 * drawer's "Show 12 results" button while filters are still being chosen.
 * The same query as the page itself (lib/listing.ts), so the button can never
 * promise a number the page then contradicts.
 *
 *   ctx = "<department>" | "<department>/<subcategory>" | "new" | "sale" | "search"
 * ========================================================================== */

import { isLocale, type Locale } from '@/config/brand'
import { countListing, type ListingContext } from '@/lib/listing'

const SLUG = /^[a-z0-9-]{1,80}$/

export async function GET(request: Request) {
  const url = new URL(request.url)
  const raw = url.searchParams.get('ctx') ?? ''
  const localeRaw = url.searchParams.get('locale') ?? 'en'
  const locale = (isLocale(localeRaw) ? localeRaw : 'en') as Locale

  let ctx: ListingContext
  if (raw === 'new' || raw === 'sale' || raw === 'search') ctx = { kind: raw }
  else {
    const [category, subcategory] = raw.split('/')
    if (!category || !SLUG.test(category) || (subcategory !== undefined && !SLUG.test(subcategory))) {
      return Response.json({ ok: false, error: 'INVALID_CONTEXT' }, { status: 422 })
    }
    ctx = { category, subcategory }
  }

  const total = await countListing(url.searchParams, ctx, locale)
  return Response.json(
    { ok: true, total },
    /* Anonymous, the same for everyone, and cheap to recompute: a short
       shared cache absorbs a flurry of taps. */
    { headers: { 'Cache-Control': 'public, max-age=15' } },
  )
}
