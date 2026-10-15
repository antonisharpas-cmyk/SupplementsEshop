/* Change, make default, or delete one of the customer's own addresses. */

import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { addresses } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { addressInputSchema } from '@/lib/validation'
import { UUID, fail, json, readJson } from '@/lib/api'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, context: Ctx) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, addressInputSchema.partial())
  if ('response' in body) return body.response
  const mine = and(eq(addresses.id, id), eq(addresses.userId, user.id))
  const [exists] = await db.select({ id: addresses.id }).from(addresses).where(mine)
  if (!exists) return fail(404, 'NOT_FOUND')
  const { isDefault, ...rest } = body.data
  await db.transaction(async (tx) => {
    if (isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, user.id))
    await tx
      .update(addresses)
      .set({
        ...rest,
        ...(rest.line2 !== undefined ? { line2: rest.line2 || null } : {}),
        ...(rest.label !== undefined ? { label: rest.label || null } : {}),
        ...(isDefault ? { isDefault: true } : {}),
      })
      .where(mine)
  })
  return json({ ok: true })
}

export async function DELETE(_request: Request, context: Ctx) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const [gone] = await db
    .delete(addresses)
    .where(and(eq(addresses.id, id), eq(addresses.userId, user.id)))
    .returning({ wasDefault: addresses.isDefault })
  if (!gone) return fail(404, 'NOT_FOUND')
  /* Someone has to be the default when any remain. */
  if (gone.wasDefault) {
    const [next] = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.userId, user.id)).limit(1)
    if (next) await db.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id))
  }
  return json({ ok: true })
}
