/* ============================================================================
 * POST /api/admin/newsletter/campaigns — send a mailing now, or schedule it.
 *
 * Now: answers once the campaign row exists; the emails go out after the
 * response. Later (`scheduledAt`): the worker sends it when the time comes.
 * One campaign sends at a time. `confirmCount` must match the audience the
 * owner was shown — if it changed in between, they are asked again.
 * ========================================================================== */

import { after } from 'next/server'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { audienceSize, deliverCampaign, NewsletterError, startCampaign } from '@/lib/newsletter'
import { audit } from '@/lib/audit'
import { draftSchema } from '../schema'

const bodySchema = draftSchema.extend({
  confirmCount: z.number().int().min(1),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
})

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? 'That was not valid.' }, { status: 422 })
  }
  const { confirmCount, scheduledAt, ...draft } = parsed.data
  const when = scheduledAt ? new Date(scheduledAt) : null
  if (when && when.getTime() < Date.now() - 60_000) {
    return Response.json({ ok: false, message: 'That time has already passed.' }, { status: 422 })
  }

  const n = await audienceSize(draft.audience)
  if (n !== confirmCount) {
    return Response.json(
      { ok: false, error: 'COUNT_CHANGED', subscribed: n, message: `The list has changed — it now has ${n} people. Check and send again.` },
      { status: 409 },
    )
  }

  try {
    const campaign = await startCampaign(draft, guard.user.id, when)
    await audit({
      actor: guard.user,
      action: campaign.status === 'SCHEDULED' ? 'newsletter.schedule' : 'newsletter.send',
      entity: 'newsletter_campaign',
      entityId: campaign.id,
      diff: { kind: draft.kind, subject: draft.subject, recipients: campaign.recipientCount, scheduledAt: campaign.scheduledAt },
    })
    if (campaign.status === 'SENDING') {
      after(() => deliverCampaign(campaign.id, draft).catch((err) => console.error('[newsletter] delivery failed', err)))
    }
    return Response.json({ ok: true, campaign: { id: campaign.id, recipients: campaign.recipientCount, status: campaign.status } })
  } catch (err) {
    if (err instanceof NewsletterError) {
      return Response.json({ ok: false, error: err.code, message: err.message }, { status: 409 })
    }
    throw err
  }
}
