/* POST /api/support/human — the customer taps "Talk to a person": the AI
   assistant stops in their conversation and the team carries on. Only for
   the customer's own open conversation. */

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { supportConversations } from '@/db/schema'
import { ownedBy } from '@/lib/support'
import { customerHandOver } from '@/lib/support-ai'
import { currentActor, json } from '@/lib/support-http'
import { clientKey, hit } from '@/lib/rate-limit'

const schema = z.object({ conversationId: z.string().uuid() })

export async function POST(request: Request) {
  if (!hit(`support:human:${clientKey(request)}`, 10, 600).ok) return json({ ok: false, error: 'RATE_LIMITED' }, 429)
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ ok: false, error: 'INVALID_INPUT' }, 422)
  const actor = await currentActor()
  if (!actor.userId && !actor.guestToken) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  const [conv] = await db
    .select({ id: supportConversations.id })
    .from(supportConversations)
    .where(and(eq(supportConversations.id, parsed.data.conversationId), ownedBy(actor)))
    .limit(1)
  if (!conv) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  await customerHandOver(conv.id)
  return json({ ok: true })
}
