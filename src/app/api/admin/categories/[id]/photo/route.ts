/* Admin: the picture on a category's homepage tile.
   POST multipart "file"  set or replace it
   DELETE                 remove it (the tile shows just the name) */

import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { removeCategoryPhoto, setCategoryPhoto } from '@/lib/admin-categories'
import { UUID, fail, json } from '@/lib/api'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) return fail(422, 'INVALID_INPUT', 'Choose a picture.')
    const file = f as File
    const url = await setCategoryPhoto(id, { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name })
    await audit({ actor: guard.user, action: 'category.photo', entity: 'category', entityId: id })
    revalidatePath('/', 'layout')
    return json({ ok: true, url })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[categories/photo]', err)
    return fail(500, 'FAILED', 'That picture could not be saved.')
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  try {
    await removeCategoryPhoto(id)
    await audit({ actor: guard.user, action: 'category.photo.remove', entity: 'category', entityId: id })
    revalidatePath('/', 'layout')
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
