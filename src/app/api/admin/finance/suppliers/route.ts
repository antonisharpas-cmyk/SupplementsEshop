/* POST: a new supplier. */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { saveSupplier } from '@/lib/purchases'
import { run } from '../_shared'
import { supplierSchema } from '../_schemas'


export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, supplierSchema)
  if ('response' in b) return b.response
  return run(async () => ({ supplier: await saveSupplier(b.data) }))
}
