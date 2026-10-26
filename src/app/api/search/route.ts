/* Search suggestions for the header autocomplete (spec section 6). */
import { searchSuggestions } from '@/lib/catalog'
import { isLocale, type Locale } from '@/config/brand'
import { clientKey, hitAll } from '@/lib/rate-limit'

export async function GET(request: Request) {
  if (!hitAll([[`search:${clientKey(request)}`, 90, 60]]).ok) {
    return Response.json({ ok: false, error: 'TOO_MANY' }, { status: 429, headers: { 'Retry-After': '30' } })
  }
  const url = new URL(request.url)
  const q = (url.searchParams.get('q') ?? '').slice(0, 120)
  const rawLocale = url.searchParams.get('locale') ?? 'en'
  const locale = (isLocale(rawLocale) ? rawLocale : 'en') as Locale

  if (q.trim().length < 2) {
    return Response.json({ items: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const items = await searchSuggestions(q, locale, 6)
    return Response.json(
      { items },
      /* Short public cache: suggestions are identical for everyone and a
         typing customer generates a burst of near-identical requests. */
      { headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' } },
    )
  } catch (err) {
    console.error('[api/search] failed', err)
    return Response.json({ items: [] }, { status: 500 })
  }
}
