/* The signed-in customer's own details: name, phone, email language. */

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { AccountError, updateProfile } from '@/lib/auth/account'
import { localeSchema, nameSchema, phoneSchema } from '@/lib/validation'
import { fail, json, readJson } from '@/lib/api'

const schema = z.object({ firstName: nameSchema, lastName: nameSchema, phone: phoneSchema, locale: localeSchema })

export async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    /* Said yes to SMS offers on the old number: the yes moves with the number. */
    const { smsStatusForUser, subscribeSms, unsubscribeSms } = await import('@/lib/sms-marketing')
    const before = await smsStatusForUser(user.id)
    await updateProfile(user.id, { firstName: body.data.firstName, lastName: body.data.lastName, phone: body.data.phone })
    await db.update(users).set({ locale: body.data.locale, updatedAt: new Date() }).where(eq(users.id, user.id))
    if (before?.subscribed && before.phone !== body.data.phone) {
      await unsubscribeSms(before.phone)
      await subscribeSms({ phone: body.data.phone, userId: user.id, firstName: body.data.firstName, locale: body.data.locale, source: 'account' })
    }
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AccountError) return fail(409, err.code, err.message, { fields: { phone: err.message } })
    console.error('[api/account/profile] failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not save your details.')
  }
}
