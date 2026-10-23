/* PUT: change an expense. DELETE: remove it. */
import { requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { deleteExpense, saveExpense } from '@/lib/expenses'
import { run } from '../../_shared'
import { expenseSchema } from '../../_schemas'

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const b = await readJson(request, expenseSchema)
  if ('response' in b) return b.response
  return run(async () => ({ id: await saveExpense(b.data, g.user.id, id) }))
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  return run(() => deleteExpense(id))
}
