/* PUT: change a supplier. */
import { requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { saveSupplier } from '@/lib/purchases'
import { run } from '../../_shared'
import { supplierSchema } from '../../_schemas'

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const b = await readJson(request, supplierSchema)
  if ('response' in b) return b.response
  return run(async () => ({ supplier: await saveSupplier(b.data, id) }))
}
