/* Admin: a product's names, copy, category and address, in three languages. */

import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { updateProductDetails } from '@/lib/admin-products'
import { detailsSchema } from '@/lib/admin-schemas'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, detailsSchema)
  if ('response' in body) return body.response
  try {
    const row = await updateProductDetails(id, { ...body.data, slug: body.data.slug || undefined })
    await audit({ actor: guard.user, action: 'product.details', entity: 'product', entityId: id })
    revalidatePath('/[locale]', 'layout')
    return json({ ok: true, slug: row.slug })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[api/admin/products/details] failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not save the details.')
  }
}
