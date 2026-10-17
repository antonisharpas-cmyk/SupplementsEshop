/* ============================================================================
 * Admin: move an order along, or close it.
 *
 *   { action: 'status', status, trackingNumber?, trackingUrl? }
 *   { action: 'cash_received' }
 *   { action: 'cancel', refund?: boolean }   before it has left the shop
 *   { action: 'refund', restock: boolean }   after (a return)
 *   { action: 'note', note }
 * ========================================================================== */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { OrderError, cancelOrder, markCashReceived, refundOrder, setAdminNote, setOrderStatus } from '@/lib/orders'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    status: z.enum(['PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED']),
    trackingNumber: z.string().trim().max(80).optional(),
    trackingUrl: z.string().trim().url('Enter the full tracking link, starting https://').max(500).refine((u) => /^https?:\/\//i.test(u), 'Enter the full tracking link, starting https://').optional().or(z.literal('')),
  }),
  z.object({ action: z.literal('cash_received') }),
  z.object({ action: z.literal('cancel'), refund: z.boolean().default(true), reason: z.string().trim().max(300).optional() }),
  z.object({ action: z.literal('refund'), restock: z.boolean().default(false) }),
  z.object({ action: z.literal('note'), note: z.string().max(2000) }),
])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const b = body.data
  try {
    if (b.action === 'status') {
      await setOrderStatus(id, b.status, { trackingNumber: b.trackingNumber, trackingUrl: b.trackingUrl || undefined })
    } else if (b.action === 'cash_received') {
      await markCashReceived(id)
    } else if (b.action === 'cancel') {
      await cancelOrder(id, { reason: b.reason || `By ${guard.user.email}.`, by: guard.user, refund: b.refund })
    } else if (b.action === 'refund') {
      await refundOrder(id, { restock: b.restock, by: guard.user })
    } else {
      await setAdminNote(id, b.note)
    }
  } catch (err) {
    if (err instanceof OrderError) return fail(409, 'REFUSED', err.message)
    console.error('[api/admin/orders] failed', b.action, err)
    return fail(500, 'FAILED', 'That did not work. Nothing was changed.')
  }
  await audit({ actor: guard.user, action: `order.${b.action}`, entity: 'order', entityId: id, diff: b as Record<string, unknown> })
  revalidatePath('/admin/orders')
  return json({ ok: true })
}
