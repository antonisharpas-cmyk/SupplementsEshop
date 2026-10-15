/* POST /api/admin/support/:id/messages — a staff reply. The customer sees it
   from "Customer Service"; which staff member wrote it stays internal. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { staffReply } from '@/lib/support'
import { json, supportErrorResponse } from '@/lib/support-http'

const schema = z.object({ message: z.string().max(4000) })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return json({ ok: false, error: 'INVALID_INPUT' }, 422)
  try {
    const message = await staffReply(id, guard.user.id, parsed.data.message)
    return json({ ok: true, message })
  } catch (err) {
    return supportErrorResponse(err, 'api/admin/support/messages')
  }
}
