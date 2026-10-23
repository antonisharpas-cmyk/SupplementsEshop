/* POST payment | unpay | credit | remind on one wholesale sale. */
import { z } from 'zod'
import { requireFinanceApi } from '@/lib/admin'
import { fail, readJson, UUID } from '@/lib/api'
import { creditSale, deletePayment, recordPayment, sendReminder } from '@/lib/wholesale'
import { audit } from '@/lib/audit'
import { run } from '../../../_shared'

const paymentSchema = z.object({
  amountCents: z.number().int().min(1, 'Enter the amount received.'),
  method: z.enum(['bank', 'card', 'cash', 'other']),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(300).nullish(),
})
const creditSchema = z.object({
  lines: z.array(z.object({ lineId: z.string().uuid(), quantity: z.number().int().min(0) })).max(500),
  amountNetCents: z.number().int().min(0).optional(),
  restock: z.boolean(),
  reason: z.string().trim().min(1, 'Say why, for the credit note.').max(200),
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(request: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const { id, action } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  if (action === 'payment') {
    const b = await readJson(request, paymentSchema)
    if ('response' in b) return b.response
    return run(() => recordPayment(id, b.data, g.user.id))
  }
  if (action === 'unpay') {
    const b = await readJson(request, z.object({ paymentId: z.string().uuid() }))
    if ('response' in b) return b.response
    return run(() => deletePayment(b.data.paymentId))
  }
  if (action === 'credit') {
    const b = await readJson(request, creditSchema)
    if ('response' in b) return b.response
    return run(async () => {
      await creditSale(id, b.data, g.user.id)
      await audit({ actor: g.user, action: 'wholesale.credit', entity: 'wholesale_sale', entityId: id, diff: b.data as unknown as Record<string, unknown> })
    })
  }
  if (action === 'remind') {
    return run(async () => {
      const r = await sendReminder(id)
      return { sent: r.sent }
    })
  }
  return fail(404, 'NOT_FOUND')
}
