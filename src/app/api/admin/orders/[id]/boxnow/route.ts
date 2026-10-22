/* ============================================================================
 * Admin: the order's BOX NOW parcel.
 *
 *   { action: 'create', compartmentSize: 1 | 2 | 3 }  create the shipment
 *   { action: 'refresh', shipmentId }                 read its state now
 *   { action: 'cancel', shipmentId }                  before it is handed over
 *
 * Every refusal comes back with BOX NOW's own reason (P402 …), so staff know
 * what to fix. Nothing is recorded unless BOX NOW accepted it.
 * ========================================================================== */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { OrderError } from '@/lib/orders'
import { BoxNowError } from '@/lib/boxnow'
import { cancelShipment, createBoxNowShipment, refreshShipment, shipmentsForOrder } from '@/lib/shipments'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), compartmentSize: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2) }),
  z.object({ action: z.literal('refresh'), shipmentId: z.string().regex(UUID) }),
  z.object({ action: z.literal('cancel'), shipmentId: z.string().regex(UUID) }),
])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const b = body.data

  /* A shipment id must belong to this order. */
  if (b.action !== 'create' && !(await shipmentsForOrder(id)).some((s) => s.id === b.shipmentId)) {
    return fail(404, 'NOT_FOUND', 'That shipment is not on this order.')
  }
  try {
    if (b.action === 'create') await createBoxNowShipment(id, { compartmentSize: b.compartmentSize, by: guard.user.id })
    else if (b.action === 'refresh') await refreshShipment(b.shipmentId)
    else await cancelShipment(b.shipmentId)
  } catch (err) {
    if (err instanceof OrderError || err instanceof BoxNowError) return fail(409, 'REFUSED', err.message)
    console.error('[api/admin/orders/boxnow] failed', b.action, err)
    return fail(500, 'FAILED', 'That did not work. Nothing was changed.')
  }
  await audit({ actor: guard.user, action: `order.boxnow_${b.action}`, entity: 'order', entityId: id, diff: b as Record<string, unknown> })
  revalidatePath(`/admin/orders/${id}`)
  return json({ ok: true })
}
