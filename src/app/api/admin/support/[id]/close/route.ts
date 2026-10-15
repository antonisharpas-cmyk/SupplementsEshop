/* POST /api/admin/support/:id/close — end the conversation. Idempotent: a
   second close (or the timer getting there first) changes nothing and sends
   no second transcript. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { closeConversation } from '@/lib/support'
import { audit } from '@/lib/audit'
import { json } from '@/lib/support-http'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  const closed = await closeConversation(id, { reason: 'STAFF', staffUserId: guard.user.id })
  if (closed) await audit({ actor: guard.user, action: 'support.close', entity: 'support_conversation', entityId: id })
  return json({ ok: true, closed })
}
