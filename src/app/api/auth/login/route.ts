/* ============================================================================
 * Sign in.
 *
 * `login()` owns the security: identical message and identical timing whether
 * the address exists or the password is wrong, a lockout after repeated
 * failures, and an opportunistic re-hash when the stored hash predates the
 * current cost. This route only turns its result into a cookie.
 * ========================================================================== */

import { z } from 'zod'
import { AccountError, login } from '@/lib/auth/account'
import { readCartToken, setSessionCookie } from '@/lib/auth/session'
import { mergeGuestCart } from '@/lib/cart'
import { mergeGuestViews } from '@/lib/views'
import { loginSchema } from '@/lib/validation'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return json({ ok: false, error: 'INVALID_INPUT', fields: z.treeifyError(parsed.error) }, 422)
  }

  try {
    const guestToken = await readCartToken()

    const { user, token, expiresAt } = await login(parsed.data.email, parsed.data.password, {
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for'),
    })

    await setSessionCookie(token, expiresAt)

    /* Carry the guest bag and browsing history into the account. */
    if (guestToken) {
      await mergeGuestCart(guestToken, user.id).catch((err) =>
        console.error('[api/auth/login] cart merge failed', err),
      )
      await mergeGuestViews(guestToken, user.id).catch((err) =>
        console.error('[api/auth/login] view merge failed', err),
      )
    }

    return json({ ok: true, user: { firstName: user.firstName, email: user.email } })
  } catch (err) {
    if (err instanceof AccountError) {
      const status = err.code === 'LOCKED_OUT' ? 429 : 401
      return json(
        { ok: false, error: err.code, message: err.message, retryAfter: err.retryAfterSeconds },
        status,
      )
    }
    console.error('[api/auth/login] failed', err)
    return json({ ok: false, error: 'LOGIN_FAILED', message: 'Something went wrong.' }, 500)
  }
}
