/* Admin: remove one photo from a product. */

import { revalidatePath } from 'next/cache'
import { AdminError, requireAdminApi } from '@/lib/admin'
import { removeProductPhoto } from '@/lib/admin-products'
import { UUID, fail, json } from '@/lib/api'
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
