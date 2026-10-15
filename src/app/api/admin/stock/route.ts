/* ============================================================================
 * Admin: set the physical stock for one size.
 *
 * The rule that matters is in `setOnHand`, not here: stock cannot be set below
 * what live carts are holding. This route's job is to check who is asking,
 * validate the shape, and turn the refusal into something readable.
 * ========================================================================== */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { InventoryError, setOnHand } from '@/lib/inventory'

const bodySchema = z.object({
  variantId: z.string().uuid(),
  /* A shop counting stock types a number; 10,000 of one size is a typo, not a
     delivery. */
  onHand: z.number().int().min(0).max(100_000),
})

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'INVALID_INPUT', message: 'Enter a whole number of zero or more.' },
      { status: 422 },
    )
  }

  try {
    const result = await setOnHand(parsed.data.variantId, parsed.data.onHand)
    return Response.json(
      { ok: true, ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    if (err instanceof InventoryError) {
      /* BELOW_RESERVED is a conflict, not a bad request: the number is fine,
         the world just disagrees with it right now. */
      const status = err.code === 'NO_SUCH_VARIANT' ? 404 : 409
      return Response.json({ ok: false, error: err.code, message: err.message }, { status })
    }
    console.error('[api/admin/stock] failed', err)
    return Response.json({ ok: false, error: 'STOCK_UPDATE_FAILED' }, { status: 500 })
  }
}
