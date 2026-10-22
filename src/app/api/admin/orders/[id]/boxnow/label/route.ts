/* GET /api/admin/orders/{id}/boxnow/label?shipment={shipmentId}
   The parcel label as a PDF, fetched from BOX NOW for staff to print. */

import { requireAdminApi } from '@/lib/admin'
import { OrderError } from '@/lib/orders'
import { shipmentLabel, shipmentsForOrder } from '@/lib/shipments'
import { UUID, fail } from '@/lib/api'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  const shipmentId = new URL(request.url).searchParams.get('shipment') ?? ''
  if (!UUID.test(id) || !UUID.test(shipmentId)) return fail(404, 'NOT_FOUND')
  if (!(await shipmentsForOrder(id)).some((s) => s.id === shipmentId)) return fail(404, 'NOT_FOUND')
  try {
    const { pdf, name } = await shipmentLabel(shipmentId)
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof OrderError) return fail(409, 'REFUSED', err.message)
    console.error('[api/admin/boxnow/label] failed', err)
    return fail(500, 'FAILED', 'Could not get the label from BOX NOW.')
  }
}
