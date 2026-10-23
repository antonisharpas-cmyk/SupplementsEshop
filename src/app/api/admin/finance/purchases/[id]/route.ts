/* PUT: change a draft purchase. DELETE: delete a draft. */
import { requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { deletePurchase, receivePurchase, savePurchase } from '@/lib/purchases'
import { audit } from '@/lib/audit'
import { run } from '../../_shared'
import { purchaseSchema } from '../../_schemas'

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const b = await readJson(request, purchaseSchema)
  if ('response' in b) return b.response
  return run(async () => {
    await savePurchase(b.data, g.user.id, id)
    if (b.data.receive) await receivePurchase(id, g.user.id)
    await audit({ actor: g.user, action: 'purchase.update', entity: 'purchase', entityId: id })
    return { id }
  })
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  return run(async () => {
    await deletePurchase(id)
    await audit({ actor: g.user, action: 'purchase.delete', entity: 'purchase', entityId: id })
  })
}
