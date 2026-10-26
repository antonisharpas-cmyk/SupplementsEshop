/* Admin: one photo of a product: remove it, or say which flavour it shows. */

import { revalidatePath } from 'next/cache'
import { AdminError, requireAdminApi } from '@/lib/admin'
import { z } from 'zod'
import { removeProductPhoto, setPhotoVariant } from '@/lib/admin-products'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id, imageId } = await context.params
  if (!UUID.test(id) || !UUID.test(imageId)) return fail(404, 'NOT_FOUND')
  try {
    await removeProductPhoto(id, imageId)
  } catch (err) {
    if (err instanceof AdminError) return fail(404, 'NOT_FOUND', err.message)
    console.error('[api/admin/products/images] delete failed', err)
    return fail(500, 'DELETE_FAILED', 'Could not remove that photo.')
  }
  await audit({ actor: guard.user, action: 'product.photo.remove', entity: 'product', entityId: id })
  revalidatePath('/[locale]', 'layout')
  return json({ ok: true })
}

/* PATCH { variantId }: which flavour and size this photo shows (null for the
   whole product). The shop shows a flavour's own photos when it is chosen. */
const patchSchema = z.object({ variantId: z.string().uuid().nullable() })

export async function PATCH(request: Request, context: { params: Promise<{ id: string; imageId: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id, imageId } = await context.params
  if (!UUID.test(id) || !UUID.test(imageId)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, patchSchema)
  if ('response' in body) return body.response
  try {
    await setPhotoVariant(id, imageId, body.data.variantId)
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
  revalidatePath('/[locale]', 'layout')
  return json({ ok: true })
}
