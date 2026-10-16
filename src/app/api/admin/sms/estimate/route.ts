/* Admin: what an SMS campaign would cost, before sending it. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { fail, json, readJson } from '@/lib/api'
import { SmsError, audiencePhones, checkMessage, finalMessage } from '@/lib/sms-marketing'
import { estimateSms } from '@/lib/sms'
import { audienceSchema, textSchema } from '../_shared'

const schema = z.object({ text: textSchema, audience: audienceSchema })

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    const len = checkMessage(body.data.text)
    const phones = await audiencePhones(body.data.audience)
    const est = await estimateSms(phones, finalMessage(body.data.text))
    if (!est.ok) return fail(502, 'ESTIMATE_FAILED', est.error)
    return json({ ok: true, recipients: phones.length, segments: len.segments, cost: est.cost, detail: est.detail })
  } catch (err) {
    if (err instanceof SmsError) return fail(422, 'INVALID', err.message)
    throw err
  }
}
