/* Admin: change, pause or resume, end now, or delete a promotion. */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { deletePromotion, endPromotion, setPromotionActive, updatePromotion } from '@/lib/admin-promotions'
import { promotionSchema } from '@/lib/admin-schemas'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.union([
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('end') }),
  z.object({ action: z.literal('update'), promotion: promotionSchema }),
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
    if (d.action === 'pause') await setPromotionActive(id, false)
    else if (d.action === 'resume') await setPromotionActive(id, true)
    else if (d.action === 'end') await endPromotion(id)
    else await updatePromotion(id, d.promotion)
    await audit({ actor: guard.user, action: `promotion.${d.action}`, entity: 'promotion', entityId: id, diff: d })
    revalidatePath('/', 'layout')
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
  await deletePromotion(id)
  await audit({ actor: guard.user, action: 'promotion.delete', entity: 'promotion', entityId: id })
  revalidatePath('/', 'layout')
  return json({ ok: true })
}
