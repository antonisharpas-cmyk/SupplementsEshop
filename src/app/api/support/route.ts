/* ============================================================================
 * The customer side of Customer Service.
 *
 *   GET  /api/support?after=ISO&open=1   my current conversation (or none)
 *   POST /api/support                    start one with a first message
 *
 * "My" means: the signed-in account's, or the guest cookie's. There is no
 * way to ask for a conversation by id from here.
 * ========================================================================== */

import { z } from 'zod'
import { customerView, startConversation } from '@/lib/support'
import { currentActor, ensureGuestToken, json, supportErrorResponse } from '@/lib/support-http'
import { clientKey, hit } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const afterRaw = url.searchParams.get('after')
  const after = afterRaw && !Number.isNaN(Date.parse(afterRaw)) ? new Date(afterRaw) : undefined
  const limit = hit(`support:poll:${clientKey(request)}`, 90, 60)
  if (!limit.ok) return json({ ok: false, error: 'RATE_LIMITED' }, 429)

  const actor = await currentActor()
  const view = await customerView(actor, { after, markRead: url.searchParams.get('open') === '1' })
  return json({
    ok: true,
    ...view,
    /* Prefill for a signed-in customer; nothing about anyone else. */
    me: actor.user ? { name: `${actor.user.firstName} ${actor.user.lastName}`.trim(), email: actor.user.email } : null,
  })
}

const startSchema = z.object({
  name: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().max(255).optional().nullable(),
  message: z.string().max(4000),
  locale: z.enum(['en', 'el', 'ru']).default('en'),
  pageUrl: z.string().max(1000).optional().nullable(),
  website: z.string().max(500).optional(),
})

export async function POST(request: Request) {
  const ip = clientKey(request)
  const limit = hit(`support:start:${ip}`, 4, 10 * 60)
  if (!limit.ok) return json({ ok: false, error: 'RATE_LIMITED', retryAfter: limit.retryAfterSeconds }, 429)

  const parsed = startSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ ok: false, error: 'INVALID_INPUT' }, 422)
  /* Honeypot filled — a bot. Look successful, create nothing. */
  if (parsed.data.website) return json({ ok: true, conversationId: null })

  try {
    const base = await currentActor()
    /* A new guest must give a name and an email before they are given a
       cookie — a refused attempt leaves nothing behind. */
    if (!base.user && !base.guestToken) {
      if (!parsed.data.name?.trim()) return json({ ok: false, error: 'NAME_REQUIRED', message: 'Tell us your name.' }, 422)
      if (!parsed.data.email?.trim()) {
        return json({ ok: false, error: 'EMAIL_REQUIRED', message: 'Tell us your email, so we can send you a copy.' }, 422)
      }
    }
    const actor = await ensureGuestToken(base)
    /* Signed in: the account's own name and email, whatever the form says. */
    const name = base.user ? `${base.user.firstName} ${base.user.lastName}`.trim() : parsed.data.name
    const email = base.user ? base.user.email : parsed.data.email
    const result = await startConversation(actor, {
      name,
      email,
      message: parsed.data.message,
      locale: parsed.data.locale,
      pageUrl: parsed.data.pageUrl,
    })
    return json({ ok: true, ...result })
  } catch (err) {
    return supportErrorResponse(err, 'api/support')
  }
}
