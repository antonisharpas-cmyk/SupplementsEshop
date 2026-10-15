/* POST /api/admin/newsletter/campaigns/:id/cancel — call off a scheduled
   mailing. One that has started sending cannot be recalled. */

import { requireAdminApi } from '@/lib/admin'
import { cancelCampaign } from '@/lib/newsletter'
import { audit } from '@/lib/audit'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  const ok = await cancelCampaign(id)
  if (ok) await audit({ actor: guard.user, action: 'newsletter.cancel', entity: 'newsletter_campaign', entityId: id })
  return Response.json({ ok, message: ok ? undefined : 'Only a scheduled mailing that has not started can be cancelled.' }, { status: ok ? 200 : 409 })
}
