/* Admin: change, turn on or off, or delete a promo code. */

import { z } from 'zod'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { deletePromoCode, setPromoCodeActive, updatePromoCode } from '@/lib/admin-promo-codes'
import { promoCodeSchema } from '@/lib/admin-schemas'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.union([
  z.object({ action: z.literal('on') }),
  z.object({ action: z.literal('off') }),
  z.object({ action: z.literal('update'), code: promoCodeSchema }),
])

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    const d = body.data
    if (d.action === 'update') await updatePromoCode(id, d.code)
    else await setPromoCodeActive(id, d.action === 'on')
    await audit({ actor: guard.user, action: `promo_code.${d.action}`, entity: 'promo_code', entityId: id, diff: d })
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  try {
    await deletePromoCode(id)
    await audit({ actor: guard.user, action: 'promo_code.delete', entity: 'promo_code', entityId: id })
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
