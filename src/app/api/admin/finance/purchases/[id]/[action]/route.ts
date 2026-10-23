/* POST receive | undo | paid | unpaid. Receiving is open to all staff (they
   unpack the boxes); the rest needs the owner or a manager. */
import { z } from 'zod'
import { requireAdminApi, requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { receivePurchase, setPurchasePaid, undoReceive } from '@/lib/purchases'
import { audit } from '@/lib/audit'
import { run } from '../../../_shared'

const paidSchema = z.object({ on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), method: z.enum(['bank', 'card', 'cash', 'other']) })

export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const g = action === 'receive' ? await requireAdminApi() : await requireFinanceApi()
  if ('response' in g) return g.response
  if (action === 'receive') {
    return run(async () => {
      await receivePurchase(id, g.user.id)
      await audit({ actor: g.user, action: 'purchase.receive', entity: 'purchase', entityId: id })
    })
  }
  if (action === 'undo') {
    return run(async () => {
      await undoReceive(id, g.user.id)
      await audit({ actor: g.user, action: 'purchase.undo_receive', entity: 'purchase', entityId: id })
    })
  }
  if (action === 'paid') {
    const b = await readJson(request, paidSchema)
    if ('response' in b) return b.response
    return run(() => setPurchasePaid(id, b.data))
  }
  if (action === 'unpaid') return run(() => setPurchasePaid(id, null))
  return fail(404, 'NOT_FOUND')
}
