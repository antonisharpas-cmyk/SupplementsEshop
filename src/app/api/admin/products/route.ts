/* Admin: create a product. It starts Hidden, so the owner can add photos,
   flavours and stock before anyone sees it. */

import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { createProduct } from '@/lib/admin-products'
import { createProductSchema } from '@/lib/admin-schemas'
import { fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, createProductSchema)
  if ('response' in body) return body.response
  try {
    const row = await createProduct({ ...body.data, slug: body.data.slug || undefined })
    await audit({ actor: guard.user, action: 'product.create', entity: 'product', entityId: row.id, diff: { slug: row.slug } })
    revalidatePath('/admin/products')
    return json({ ok: true, id: row.id, slug: row.slug })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[api/admin/products] create failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not create the product.')
  }
}
