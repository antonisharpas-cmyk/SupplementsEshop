/* Admin: start a new promotion. */

import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { createPromotion } from '@/lib/admin-promotions'
import { promotionSchema } from '@/lib/admin-schemas'
import { fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, promotionSchema)
  if ('response' in body) return body.response
  try {
    const row = await createPromotion(body.data)
    await audit({ actor: guard.user, action: 'promotion.create', entity: 'promotion', entityId: row.id, diff: body.data })
    revalidatePath('/', 'layout')
    return json({ ok: true, id: row.id })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
