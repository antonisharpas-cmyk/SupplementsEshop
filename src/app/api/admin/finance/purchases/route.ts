/* POST: a new purchase (draft), optionally received at once. */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { receivePurchase, savePurchase } from '@/lib/purchases'
import { audit } from '@/lib/audit'
import { run } from '../_shared'
import { purchaseSchema } from '../_schemas'


export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, purchaseSchema)
  if ('response' in b) return b.response
  return run(async () => {
    const id = await savePurchase(b.data, g.user.id)
    if (b.data.receive) await receivePurchase(id, g.user.id)
    await audit({ actor: g.user, action: 'purchase.create', entity: 'purchase', entityId: id })
    return { id }
  })
}
