/* POST: a sale to a retailer; takes the stock and issues the invoice. */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { createSale } from '@/lib/wholesale'
import { audit } from '@/lib/audit'
import { run } from '../_shared'
import { saleSchema } from '../_schemas'

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, saleSchema)
  if ('response' in b) return b.response
  return run(async () => {
    const id = await createSale(b.data, g.user.id)
    await audit({ actor: g.user, action: 'wholesale.sale', entity: 'wholesale_sale', entityId: id })
    return { id }
  })
}
