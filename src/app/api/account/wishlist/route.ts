/* Save a product to the wishlist, or take it off. */

import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { setInWishlist } from '@/lib/wishlist'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in to save products.')
  const body = await readJson(request, z.object({ productId: z.string().uuid(), saved: z.boolean() }))
  if ('response' in body) return body.response
  const saved = await setInWishlist(user.id, body.data.productId, body.data.saved)
  return json({ ok: true, saved })
}
