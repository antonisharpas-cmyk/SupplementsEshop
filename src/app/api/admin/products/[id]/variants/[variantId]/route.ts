/* Admin: change or remove one variant. Stock itself is set through
   /api/admin/stock, which guards against going below what bags hold. */

import { revalidatePath } from 'next/cache'
import { AdminError, requireAdminApi } from '@/lib/admin'
import { deleteVariant, updateVariant } from '@/lib/admin-products'
import { variantSchema } from '@/lib/admin-schemas'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string; variantId: string }> }

export async function PATCH(request: Request, context: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id, variantId } = await context.params
  if (!UUID.test(id) || !UUID.test(variantId)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, variantSchema.omit({ onHand: true }))
  if ('response' in body) return body.response
  try {
    await updateVariant(id, variantId, { ...body.data, sku: body.data.sku || undefined })
    await audit({ actor: guard.user, action: 'variant.update', entity: 'variant', entityId: variantId })
    revalidatePath('/[locale]', 'layout')
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[api/admin/products/variants] update failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not save that variant.')
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id, variantId } = await context.params
  if (!UUID.test(id) || !UUID.test(variantId)) return fail(404, 'NOT_FOUND')
  try {
    await deleteVariant(id, variantId)
  } catch (err) {
    if (err instanceof AdminError) return fail(409, 'REFUSED', err.message)
    console.error('[api/admin/products/variants] delete failed', err)
    return fail(500, 'DELETE_FAILED', 'Could not remove that variant.')
  }
  await audit({ actor: guard.user, action: 'variant.delete', entity: 'variant', entityId: variantId })
  revalidatePath('/[locale]', 'layout')
  return json({ ok: true })
}
