/* Admin: add a category (a range, a group inside a range, or a section
   inside a group). */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi, AdminError } from '@/lib/admin'
import { createCategory } from '@/lib/admin-categories'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { categoryNameSchema as nameSchema } from '@/lib/admin-schemas'

const schema = z.object({
  parentId: z.string().regex(UUID).nullable(),
  name: nameSchema,
})

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    const row = await createCategory(body.data)
    await audit({ actor: guard.user, action: 'category.create', entity: 'category', entityId: row.id, diff: { slug: row.slug, parentId: row.parentId } })
    revalidatePath('/', 'layout')
    return json({ ok: true, category: { id: row.id, slug: row.slug, parentId: row.parentId, name: row.name } })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
