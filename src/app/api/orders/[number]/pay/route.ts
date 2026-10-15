/* Start (or restart) the card payment for an unpaid order: from the order
   page's "Pay now", after the customer left Stripe's page without paying. */

import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { OrderError, getOrderByToken, getOrderForUser, startCardPayment } from '@/lib/orders'
import { stripeEnabled } from '@/lib/stripe'
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
  if (!stripeEnabled()) return fail(409, 'CARD_UNAVAILABLE', 'Card payment is not available right now.')
  try {
    const url = await startCardPayment(order.id)
    return json({ ok: true, url })
  } catch (err) {
    if (err instanceof OrderError) return fail(409, 'NOT_PAYABLE', err.message)
    console.error('[api/orders/pay] failed', err)
    return fail(500, 'PAYMENT_START_FAILED', 'Could not open the payment page. Try again in a moment.')
  }
}
