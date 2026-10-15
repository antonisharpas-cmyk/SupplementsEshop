/* ============================================================================
 * Admin: save the shop settings.
 *
 * Validated here as well as in the form, because the form is just a browser and
 * anything can POST. The bounds are the ones that would otherwise break the
 * shop quietly: a cart hold of zero would release stock before checkout could
 * finish; a VAT rate over 100% would make the tax exceed the price.
 * ========================================================================== */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { setSetting } from '@/lib/settings'

const bodySchema = z
  .object({
    free_delivery_threshold_cents: z.number().int().min(0).max(100_000_000),
    /* 1–60 minutes. Below a minute the stock is released while the customer is
       still typing their address. */
    reservation_ttl_seconds: z.number().int().min(60).max(3600),
    vat_rate_bp: z.number().int().min(0).max(10_000),
    low_stock_threshold: z.number().int().min(0).max(1000),
    max_qty_per_line: z.number().int().min(1).max(1000),
    estimated_delivery_min_days: z.number().int().min(0).max(365),
    estimated_delivery_max_days: z.number().int().min(0).max(365),
    homepage_promotions_enabled: z.boolean(),
    order_number_prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/),
    /* Empty = the shop's public contact address. */
    support_email: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(255)]),
    support_idle_minutes: z.number().int().min(2).max(240),
  })
  .refine((v) => v.estimated_delivery_max_days >= v.estimated_delivery_min_days, {
    message: 'The longest delivery estimate cannot be shorter than the quickest.',
    path: ['estimated_delivery_max_days'],
  })

export async function PATCH(request: Request) {
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
      {
        ok: false,
        error: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'Those settings were not valid.',
      },
      { status: 422 },
    )
  }

  try {
    /* setSetting clears the read cache, so the next page render sees these. */
    for (const [key, value] of Object.entries(parsed.data)) {
      await setSetting(key as keyof typeof parsed.data, value as never)
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[api/admin/settings] failed', err)
    return Response.json({ ok: false, error: 'SETTINGS_SAVE_FAILED' }, { status: 500 })
  }
}
