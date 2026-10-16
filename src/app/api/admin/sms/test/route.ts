/* Admin: send the campaign to one number first, to see it on a real phone. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { fail, json, readJson } from '@/lib/api'
import { phoneSchema } from '@/lib/validation'
import { SmsError, checkMessage, finalMessage } from '@/lib/sms-marketing'
import { sendSms } from '@/lib/sms'
import { clientKey, hit } from '@/lib/rate-limit'
import { textSchema } from '../_shared'

const schema = z.object({ text: textSchema, phone: phoneSchema })

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  if (!hit(`sms-test:${clientKey(request)}`, 10, 600).ok) return fail(429, 'TOO_MANY', 'Too many test messages. Wait a few minutes.')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    checkMessage(body.data.text)
  } catch (err) {
    if (err instanceof SmsError) return fail(422, 'INVALID', err.message)
    throw err
  }
  const r = await sendSms([body.data.phone], finalMessage(body.data.text))
  if (!r.ok) return fail(502, 'SEND_FAILED', r.error)
  return json({ ok: true, logged: Boolean(r.logged), to: body.data.phone })
}
