/* Admin: rename, show or hide, move up or down, or delete a category. */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { deleteCategory, moveCategory, updateCategory } from '@/lib/admin-categories'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { categoryNameSchema as nameSchema } from '@/lib/admin-schemas'

const schema = z.object({
  name: nameSchema.optional(),
  isActive: z.boolean().optional(),
  move: z.enum(['up', 'down']).optional(),
})

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    if (body.data.move) await moveCategory(id, body.data.move)
    if (body.data.name || body.data.isActive !== undefined) await updateCategory(id, body.data)
    await audit({ actor: guard.user, action: 'category.update', entity: 'category', entityId: id, diff: body.data })
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
  try {
    await deleteCategory(id)
    await audit({ actor: guard.user, action: 'category.delete', entity: 'category', entityId: id })
    revalidatePath('/', 'layout')
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
