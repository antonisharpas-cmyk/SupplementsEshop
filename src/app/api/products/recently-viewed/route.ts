/* ============================================================================
 * The viewer's recently viewed products — spec section 8.
 *
 * Read over the API rather than rendered on the server, so a product page stays
 * cacheable: reading the viewer's cookies inside the page would make every
 * product page render per-visitor for the sake of a four-item strip.
 * ========================================================================== */

import { cookies } from 'next/headers'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { getProductCardsByIds, getRecentlyViewed } from '@/lib/views'
import { z } from 'zod'
import { isLocale, type Locale } from '@/config/brand'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const exclude = url.searchParams.get('exclude') ?? undefined

  const jar = await cookies()
  const rawLocale = url.searchParams.get('locale') ?? jar.get('sf_locale')?.value ?? 'en'
  const locale = (isLocale(rawLocale) ? rawLocale : 'en') as Locale

  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])

  try {
    const items = await getRecentlyViewed(
      { userId: user?.id ?? null, anonymousToken: token },
      { locale, excludeProductId: exclude, limit: 4 },
    )
    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/products/recently-viewed] failed', err)
    /* An empty strip is the right failure: the page must not break for it. */
    return Response.json({ ok: true, items: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}

/* ------------------------------------------------------------------- POST -- */

/* The browsing case: the DEVICE remembers what it has looked at and asks for
   those cards. No cookie is issued for this, and the ids are only ever read —
   nothing is written, and an id that is not a product is simply dropped. */

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).max(24),
  exclude: z.string().uuid().optional(),
  locale: z.string().optional(),
})

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ ok: false, items: [] }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return Response.json({ ok: false, items: [] }, { status: 422 })

  const jar = await cookies()
  const rawLocale = parsed.data.locale ?? jar.get('sf_locale')?.value ?? 'en'
  const locale = (isLocale(rawLocale) ? rawLocale : 'en') as Locale

  try {
    const ids = parsed.data.ids.filter((id) => id !== parsed.data.exclude)
    const items = await getProductCardsByIds(ids, locale, 4)
    return Response.json({ ok: true, items }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/products/recently-viewed] POST failed', err)
    return Response.json({ ok: true, items: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
