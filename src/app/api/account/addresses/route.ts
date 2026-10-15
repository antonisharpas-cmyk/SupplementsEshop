/* The signed-in customer's address book. */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { addresses } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { addressInputSchema } from '@/lib/validation'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  const body = await readJson(request, addressInputSchema)
  if ('response' in body) return body.response
  const existing = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.userId, user.id))
  if (existing.length >= 10) return fail(409, 'TOO_MANY', 'You can save up to 10 addresses.')
  const makeDefault = body.data.isDefault || existing.length === 0
  const row = await db.transaction(async (tx) => {
    if (makeDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, user.id))
    const [r] = await tx
      .insert(addresses)
      .values({ ...body.data, line2: body.data.line2 || null, label: body.data.label || null, userId: user.id, isDefault: makeDefault })
      .returning({ id: addresses.id })
    return r
  })
  return json({ ok: true, id: row.id })
}
