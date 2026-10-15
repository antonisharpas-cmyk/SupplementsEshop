/* "Buy again": a past order's items go back into the bag. */

import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { getCartCount, getOrCreateCart } from '@/lib/cart'
import { getOrderForUser, reorder } from '@/lib/orders'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  const body = await readJson(request, z.object({ orderNumber: z.string().max(20) }))
  if ('response' in body) return body.response
  const order = await getOrderForUser(body.data.orderNumber, user.id)
  if (!order) return fail(404, 'NOT_FOUND', 'That order was not found.')
  const cartId = await getOrCreateCart({ userId: user.id })
  const result = await reorder(order.id, cartId)
  return json({ ok: true, ...result, cartCount: await getCartCount(cartId) })
}
