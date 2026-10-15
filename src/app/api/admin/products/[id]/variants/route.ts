/* Admin: add a variant (one flavour in one pack size) with its opening stock. */

import { revalidatePath } from 'next/cache'
import { AdminError, requireAdminApi } from '@/lib/admin'
import { addVariant } from '@/lib/admin-products'
import { variantSchema } from '@/lib/admin-schemas'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, variantSchema)
  if ('response' in body) return body.response
  try {
    const row = await addVariant(id, { ...body.data, sku: body.data.sku || undefined })
    await audit({ actor: guard.user, action: 'variant.create', entity: 'variant', entityId: row?.id ?? null })
    revalidatePath('/[locale]', 'layout')
    return json({ ok: true, id: row?.id })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[api/admin/products/variants] create failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not add that variant.')
  }
}
