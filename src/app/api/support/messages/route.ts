/* POST /api/support/messages — the customer adds a message to their own open
   conversation. Anyone else's id is "not found". */

import { z } from 'zod'
import { postCustomerMessage } from '@/lib/support'
import { currentActor, json, supportErrorResponse } from '@/lib/support-http'
import { clientKey, hit } from '@/lib/rate-limit'

const schema = z.object({ conversationId: z.string().uuid(), message: z.string().max(4000) })

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return json({ ok: false, error: 'INVALID_INPUT' }, 422)

  const perConversation = hit(`support:msg:${parsed.data.conversationId}`, 12, 60)
  const perVisitor = hit(`support:msg-ip:${clientKey(request)}`, 40, 10 * 60)
  if (!perConversation.ok || !perVisitor.ok) return json({ ok: false, error: 'RATE_LIMITED' }, 429)

  try {
    const actor = await currentActor()
    const message = await postCustomerMessage(actor, parsed.data.conversationId, parsed.data.message)
    return json({ ok: true, message })
  } catch (err) {
    return supportErrorResponse(err, 'api/support/messages')
  }
}
