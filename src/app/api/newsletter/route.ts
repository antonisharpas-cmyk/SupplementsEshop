/* ============================================================================
 * POST /api/newsletter — join the new-arrivals list.
 *
 * Always answers "check your inbox" for a valid request, whatever the address
 * already was — the answer must not reveal who is on the list. Consent must be
 * the literal `true`; anything else is refused. Limited per visitor and per
 * address so the form cannot be used to flood someone's inbox.
 * ========================================================================== */

import { z } from 'zod'
import { emailSchema, localeSchema } from '@/lib/validation'
import { NewsletterError, subscribe } from '@/lib/newsletter'
import { getCurrentUser } from '@/lib/auth/session'
import { clientKey, hit } from '@/lib/rate-limit'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const bodySchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().max(80).optional().nullable(),
  consent: z.literal(true, { message: 'CONSENT_REQUIRED' }),
  locale: localeSchema,
  source: z.enum(['homepage', 'footer', 'newsletter_page', 'help']).default('newsletter_page'),
  /* A field real people never see or fill. Bots fill everything. */
  website: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const ip = clientKey(request)
  const perVisitor = hit(`news:ip:${ip}`, 6, 10 * 60)
  if (!perVisitor.ok) return json({ ok: false, error: 'RATE_LIMITED', retryAfter: perVisitor.retryAfterSeconds }, 429)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((i) => i.path[0] === 'consent')
    const emailBad = parsed.error.issues.some((i) => i.path[0] === 'email')
    return json(
      { ok: false, error: emailBad ? 'INVALID_EMAIL' : consentMissing ? 'CONSENT_REQUIRED' : 'INVALID_INPUT' },
      422,
    )
  }
  /* The honeypot was filled: a bot. Answer like a success, do nothing. */
  if (parsed.data.website) return json({ ok: true })

  const perAddress = hit(`news:email:${parsed.data.email.toLowerCase()}`, 3, 60 * 60)
  if (!perAddress.ok) return json({ ok: false, error: 'RATE_LIMITED', retryAfter: perAddress.retryAfterSeconds }, 429)

  try {
    const user = await getCurrentUser()
    await subscribe({
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      locale: parsed.data.locale,
      consent: parsed.data.consent,
      source: parsed.data.source,
      /* Linked to the account only when it is the account's own address. */
      userId: user && user.email.toLowerCase() === parsed.data.email.toLowerCase() ? user.id : null,
      ipHash: ip,
    })
    return json({ ok: true })
  } catch (err) {
    if (err instanceof NewsletterError) return json({ ok: false, error: err.code }, 422)
    console.error('[api/newsletter] failed', err)
    return json({ ok: false, error: 'FAILED' }, 500)
  }
}
