/* GET /api/admin/support/:id — one conversation, marked read by staff. */

import { requireAdminApi } from '@/lib/admin'
import { staffThread } from '@/lib/support'
import { json } from '@/lib/support-http'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  const thread = await staffThread(id, { markRead: new URL(request.url).searchParams.get('read') !== '0' })
  if (!thread) return json({ ok: false, error: 'NOT_FOUND' }, 404)
  return json({ ok: true, ...thread })
}
