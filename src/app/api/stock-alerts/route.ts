/* ============================================================================
 * POST /api/stock-alerts: "Notify me when it's back" for one flavour and size.
 *
 *   { variantId, email?, locale }   email may be left out when signed in
 *
 * Limited per visitor and per address, so the form cannot be used to sign
 * strangers up in bulk. A hidden field catches simple bots.
 * ========================================================================== */

import { z } from 'zod'
import { emailSchema, localeSchema } from '@/lib/validation'
import { getCurrentUser } from '@/lib/auth/session'
import { clientKey, hit } from '@/lib/rate-limit'
import { requestStockAlert, StockAlertError } from '@/lib/stock-alerts'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const bodySchema = z.object({
  variantId: z.string().uuid(),
  email: emailSchema.optional(),
  locale: localeSchema,
  website: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const ip = clientKey(request)
  const perVisitor = hit(`stockalert:ip:${ip}`, 10, 10 * 60)
  if (!perVisitor.ok) return json({ ok: false, error: 'RATE_LIMITED' }, 429)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return json({ ok: false, error: 'INVALID_INPUT' }, 422)
  if (parsed.data.website) return json({ ok: true })

  const user = await getCurrentUser()
  const email = parsed.data.email ?? user?.email
  if (!email) return json({ ok: false, error: 'INVALID_INPUT' }, 422)

  const perAddress = hit(`stockalert:email:${email.toLowerCase()}`, 10, 60 * 60)
  if (!perAddress.ok) return json({ ok: false, error: 'RATE_LIMITED' }, 429)

  try {
    await requestStockAlert({
      variantId: parsed.data.variantId,
      email,
      /* Linked to the account only when it is the account's own address. */
      userId: user && user.email.toLowerCase() === email.toLowerCase() ? user.id : null,
      locale: parsed.data.locale,
    })
    return json({ ok: true })
  } catch (err) {
    if (err instanceof StockAlertError) return json({ ok: false, error: err.code }, 422)
    console.error('[api/stock-alerts] failed', err)
    return json({ ok: false, error: 'FAILED' }, 500)
  }
}
