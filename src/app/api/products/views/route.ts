/* ============================================================================
 * Records that someone looked at a product — feeds the "Most viewed" sort and
 * the "Recently viewed" strip.
 *
 * A POST from the browser rather than a write during server rendering: a
 * product page is cached and pre-rendered, so counting a render would count
 * build steps and crawler fetches instead of people.
 *
 * Nothing here trusts the body beyond a product id, and the response carries no
 * data — it is a write endpoint, not a read one.
 * ========================================================================== */

import { z } from 'zod'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { recordProductView } from '@/lib/views'

const bodySchema = z.object({ productId: z.string().uuid() })

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return new Response(null, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return new Response(null, { status: 422 })

  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])

  /* Browsing sets no new cookie: an anonymous view with no existing token
     still counts towards popularity, it is just not tied to anyone. */
  await recordProductView(parsed.data.productId, {
    userId: user?.id ?? null,
    anonymousToken: token,
  })

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
