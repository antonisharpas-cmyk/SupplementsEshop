/* A customer cancels their own order, while the shop has not started on it:
   a cash order not yet confirmed, or a card order not yet paid. */

import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { OrderError, cancelOrder, getOrderByToken, getOrderForUser } from '@/lib/orders'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request, context: { params: Promise<{ number: string }> }) {
  const { number } = await context.params
  const body = await readJson(request, z.object({ token: z.string().max(64).optional() }))
  if ('response' in body) return body.response
  const user = await getCurrentUser()
  const order =
    (user ? await getOrderForUser(number, user.id) : null) ??
    (body.data.token ? await getOrderByToken(number, body.data.token) : null)
  if (!order) return fail(404, 'NOT_FOUND', 'That order was not found.')
  if (order.status !== 'PENDING' && order.status !== 'PAYMENT_PENDING') {
    return fail(409, 'TOO_LATE', 'This order is already being prepared. Contact us and we will help.')
  }
  try {
    await cancelOrder(order.id, { reason: 'Cancelled by the customer.', by: null })
    return json({ ok: true })
  } catch (err) {
    if (err instanceof OrderError) return fail(409, 'REFUSED', err.message)
    console.error('[api/orders/cancel] failed', err)
    return fail(500, 'CANCEL_FAILED', 'Could not cancel it. Contact us and we will help.')
  }
}
