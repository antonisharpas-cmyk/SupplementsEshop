/* POST: stock out without a sale, free goods in, or a stock count. Any staff. */
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { MANUAL_KINDS, recordManualMovement } from '@/lib/stock'
import { audit } from '@/lib/audit'
import { db } from '@/db'
import { stockMovements } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { run } from '../_shared'

const schema = z.object({
  variantId: z.string().uuid('Choose the product.'),
  kind: z.enum(MANUAL_KINDS),
  quantity: z.number().int().min(0).max(1_000_000),
  note: z.string().max(1000).nullish(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
})

export async function POST(request: Request) {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  const b = await readJson(request, schema)
  if ('response' in b) return b.response
  return run(async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' }).format(new Date())
    const at = b.data.occurredOn && b.data.occurredOn !== today ? new Date(`${b.data.occurredOn}T12:00:00Z`) : undefined
    await recordManualMovement({ ...b.data, occurredAt: at, by: g.user.id })
    const [m] = await db
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(and(eq(stockMovements.variantId, b.data.variantId), eq(stockMovements.createdBy, g.user.id)))
      .orderBy(desc(stockMovements.createdAt))
      .limit(1)
    await audit({ actor: g.user, action: `stock.${b.data.kind.toLowerCase()}`, entity: 'variant', entityId: b.data.variantId, diff: { quantity: b.data.quantity, note: b.data.note } })
    return { id: m?.id }
  })
}
