/* "Forgot password", step two: the code from the email and a new password. */

import { resetPasswordWithOtp } from '@/lib/auth/account'
import { OtpError } from '@/lib/auth/otp'
import { resetPasswordSchema } from '@/lib/validation'
import { clientKey, hit } from '@/lib/rate-limit'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  if (!hit(`reset-confirm:${clientKey(request)}`, 10, 15 * 60).ok) {
    return fail(429, 'TOO_MANY', 'Too many tries. Wait a few minutes.')
  }
  const body = await readJson(request, resetPasswordSchema)
  if ('response' in body) return body.response
  try {
    await resetPasswordWithOtp(body.data.email, body.data.code, body.data.password)
    return json({ ok: true })
  } catch (err) {
    if (err instanceof OtpError) return fail(400, err.code, err.message, { fields: { code: err.message } })
    console.error('[api/auth/password-reset/confirm] failed', err)
    return fail(500, 'RESET_FAILED', 'Could not change the password.')
  }
}
