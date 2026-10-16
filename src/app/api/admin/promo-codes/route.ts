/* Admin: create a promo code. */

import { requireAdminApi, AdminError } from '@/lib/admin'
import { createPromoCode } from '@/lib/admin-promo-codes'
import { promoCodeSchema } from '@/lib/admin-schemas'
import { fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, promoCodeSchema)
  if ('response' in body) return body.response
  try {
    const row = await createPromoCode(body.data)
    await audit({ actor: guard.user, action: 'promo_code.create', entity: 'promo_code', entityId: row.id, diff: body.data })
    return json({ ok: true, id: row.id })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
