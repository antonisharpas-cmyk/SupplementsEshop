/* POST: a new retailer. */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { saveRetailer } from '@/lib/wholesale'
import { run } from '../_shared'
import { retailerSchema } from '../_schemas'

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, retailerSchema)
  if ('response' in b) return b.response
  return run(async () => ({ retailer: await saveRetailer(b.data) }))
}
