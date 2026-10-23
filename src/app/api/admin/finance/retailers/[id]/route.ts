/* PUT: change a retailer. GET: their price list. */
import { requireFinanceApi } from '@/lib/admin'
import { fail, json, readJson, UUID } from '@/lib/api'
import { priceList, saveRetailer } from '@/lib/wholesale'
import { run } from '../../_shared'
import { retailerSchema } from '../../_schemas'

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const b = await readJson(request, retailerSchema)
  if ('response' in b) return b.response
  return run(async () => ({ retailer: await saveRetailer(b.data, id) }))
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  return json({ ok: true, prices: await priceList(id) })
}
