/* ============================================================================
 * Registration, step 1 — spec section 9.
 *
 * Takes the details, checks the phone is free, hashes the password, parks the
 * whole thing on a one-time code and emails the code. An email that already
 * has an account gets the same answer here — and a "you already have an
 * account" email instead of a code — so nobody can use this form to find out
 * who is registered. NO user row is
 * created here: an unverified signup leaves nothing behind but an OTP row that
 * expires in ten minutes.
 *
 * The response never says whether the code was correct, never returns the code,
 * and never echoes the password.
 * ========================================================================== */

import { z } from 'zod'
import { OtpError, OTP_TTL_SECONDS, issueRegistrationOtp } from '@/lib/auth/otp'
import { sendTemplate } from '@/lib/mailer'
import { registerRequestSchema } from '@/lib/validation'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const parsed = registerRequestSchema.safeParse(raw)
  if (!parsed.success) {
    /* Field-level messages, so the form can put each one next to its input. */
    const tree = z.treeifyError(parsed.error)
    return json({ ok: false, error: 'INVALID_INPUT', fields: tree }, 422)
  }

  try {
    const { confirmPassword: _confirm, ...details } = parsed.data
    void _confirm
    const { code, expiresAt, existingAccount } = await issueRegistrationOtp(details)

    /* In development EMAIL_PROVIDER=console prints the code to the terminal —
       that is how you finish a signup without a mail service configured.
       An address that already has an account is told so by email; the
       response below is identical either way. */
    if (existingAccount) {
      await sendTemplate('auth_existing_account', {
        to: parsed.data.email,
        locale: existingAccount.locale,
        vars: { customer_name: existingAccount.firstName },
      })
    } else {
      await sendTemplate('auth_verification', {
        to: parsed.data.email,
        locale: parsed.data.locale,
        vars: { code: code!, minutes: Math.round(OTP_TTL_SECONDS / 60), customer_name: parsed.data.firstName },
      })
    }

    return json({
      ok: true,
      email: parsed.data.email,
      expiresAt,
      ttlSeconds: OTP_TTL_SECONDS,
    })
  } catch (err) {
    if (err instanceof OtpError) {
      /* PHONE_TAKEN / RATE_LIMITED / COOLDOWN — each already carries a
         message a customer can act on. */
      const status = err.code === 'RATE_LIMITED' || err.code === 'COOLDOWN' ? 429 : 409
      return json(
        { ok: false, error: err.code, message: err.message, retryAfter: err.retryAfterSeconds },
        status,
      )
    }
    console.error('[api/auth/register] failed', err)
    return json({ ok: false, error: 'REGISTRATION_FAILED', message: 'Something went wrong.' }, 500)
  }
}
