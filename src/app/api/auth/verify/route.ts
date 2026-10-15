/* ============================================================================
 * Registration, step 2 — the emailed code.
 *
 * A correct code creates the account, signs the person in, and carries over
 * whatever they did as a guest: the bag they filled and the products they
 * looked at. Losing a full bag at the moment of signing up is the kind of
 * detail that costs an order.
 * ========================================================================== */

import { z } from 'zod'
import { AccountError, completeRegistration } from '@/lib/auth/account'
import { OtpError } from '@/lib/auth/otp'
import { readCartToken, setSessionCookie } from '@/lib/auth/session'
import { mergeGuestCart } from '@/lib/cart'
import { mergeGuestViews } from '@/lib/views'
import { verifyOtpSchema } from '@/lib/validation'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const parsed = verifyOtpSchema.safeParse(raw)
  if (!parsed.success) {
    return json({ ok: false, error: 'INVALID_INPUT', fields: z.treeifyError(parsed.error) }, 422)
  }

  try {
    const guestToken = await readCartToken()

    const { user, token, expiresAt } = await completeRegistration(
      parsed.data.email,
      parsed.data.code,
      {
        userAgent: request.headers.get('user-agent'),
        ip: request.headers.get('x-forwarded-for'),
      },
    )

    await setSessionCookie(token, expiresAt)

    /* Neither of these is worth failing the signup over. */
    if (guestToken) {
      await mergeGuestCart(guestToken, user.id).catch((err) =>
        console.error('[api/auth/verify] cart merge failed', err),
      )
      await mergeGuestViews(guestToken, user.id).catch((err) =>
        console.error('[api/auth/verify] view merge failed', err),
      )
    }

    return json({ ok: true, user: { firstName: user.firstName, email: user.email } })
  } catch (err) {
    if (err instanceof OtpError || err instanceof AccountError) {
      const status =
        err.code === 'TOO_MANY_ATTEMPTS' || err.code === 'RATE_LIMITED' ? 429 : 400
      return json({ ok: false, error: err.code, message: err.message }, status)
    }
    console.error('[api/auth/verify] failed', err)
    return json({ ok: false, error: 'VERIFY_FAILED', message: 'Something went wrong.' }, 500)
  }
}
