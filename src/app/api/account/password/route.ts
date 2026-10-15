/* Change password while signed in. Other devices are signed out; this one
   stays signed in. */

import { cookies } from 'next/headers'
import { getCurrentUser, SESSION_COOKIE } from '@/lib/auth/session'
import { AccountError, changePassword } from '@/lib/auth/account'
import { changePasswordSchema } from '@/lib/validation'
import { clientKey, hit } from '@/lib/rate-limit'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in again.')
  if (!hit(`pw:${user.id}:${clientKey(request)}`, 6, 15 * 60).ok) {
    return fail(429, 'TOO_MANY', 'Too many tries. Wait a few minutes.')
  }
  const body = await readJson(request, changePasswordSchema)
  if ('response' in body) return body.response
  try {
    const keep = (await cookies()).get(SESSION_COOKIE)?.value
    await changePassword(user.id, body.data.currentPassword, body.data.newPassword, keep)
    return json({ ok: true })
  } catch (err) {
    if (err instanceof AccountError) return fail(403, err.code, err.message, { fields: { currentPassword: err.message } })
    console.error('[api/account/password] failed', err)
    return fail(500, 'SAVE_FAILED', 'Could not change your password.')
  }
}
