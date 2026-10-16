/* Admin: send an SMS campaign to everyone in the chosen audience who said yes. */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { SmsError, sendSmsCampaign } from '@/lib/sms-marketing'
import { audienceSchema, textSchema } from '../_shared'

export const maxDuration = 300

const schema = z.object({ text: textSchema, audience: audienceSchema })

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    const c = await sendSmsCampaign({ ...body.data, createdBy: guard.user.id })
    await audit({
      actor: { id: guard.user.id, email: guard.user.email },
      action: 'sms.campaign',
      entity: 'sms_campaign',
      entityId: c.id,
      diff: { audience: c.audience, recipients: c.recipientCount, sent: c.sentCount, failed: c.failedCount },
    })
    revalidatePath('/admin/emails/sms')
    return json({ ok: true, campaign: { id: c.id, status: c.status, sent: c.sentCount, failed: c.failedCount, recipients: c.recipientCount } })
  } catch (err) {
    if (err instanceof SmsError) return fail(422, 'INVALID', err.message)
    throw err
  }
}
