/* PUT: change a repeating expense. DELETE: stop it (written months stay). */
import { requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { deleteRecurring, saveRecurring, writeRecurring } from '@/lib/expenses'
import { run } from '../../_shared'
import { recurringSchema } from '../../_schemas'

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const b = await readJson(request, recurringSchema)
  if ('response' in b) return b.response
  return run(async () => {
    await saveRecurring(b.data, id)
    return { written: await writeRecurring() }
  })
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  return run(() => deleteRecurring(id))
}
