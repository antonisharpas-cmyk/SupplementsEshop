/* "Forgot password": send a 6 digit code. The answer is the same whether or
   not the address has an account, so this cannot be used to find customers. */

import { issuePasswordResetOtp, OTP_TTL_SECONDS, OtpError } from '@/lib/auth/otp'
import { sendPasswordResetEmail } from '@/lib/auth/account'
import { requestPasswordResetSchema } from '@/lib/validation'
import { clientKey, hit } from '@/lib/rate-limit'
import { fail, json, readJson } from '@/lib/api'

export async function POST(request: Request) {
  if (!hit(`reset:${clientKey(request)}`, 5, 15 * 60).ok) {
    return fail(429, 'TOO_MANY', 'Too many tries. Wait a few minutes.')
  }
  const body = await readJson(request, requestPasswordResetSchema)
  if ('response' in body) return body.response
  try {
    const issued = await issuePasswordResetOtp(body.data.email)
    if (issued) await sendPasswordResetEmail(body.data.email, issued.code, OTP_TTL_SECONDS)
  } catch (err) {
    if (err instanceof OtpError) return fail(429, err.code, err.message)
    console.error('[api/auth/password-reset] failed', err)
  }
  return json({ ok: true })
}
