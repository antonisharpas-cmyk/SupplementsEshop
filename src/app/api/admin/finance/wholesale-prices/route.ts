/* PUT { retailerId|null, prices: [{ variantId, unitNetCents|null }] }: fixed
   wholesale prices before VAT; null clears one. */
import { z } from 'zod'
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { setPrice } from '@/lib/wholesale'
import { run } from '../_shared'

const schema = z.object({
  retailerId: z.string().uuid().nullable(),
  prices: z.array(z.object({ variantId: z.string().uuid(), unitNetCents: z.number().int().min(0).max(100_000_000).nullable() })).max(2000),
})

export async function PUT(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, schema)
  if ('response' in b) return b.response
  return run(async () => {
    for (const p of b.data.prices) await setPrice(b.data.retailerId, p.variantId, p.unitNetCents)
    return { saved: b.data.prices.length }
  })
}
