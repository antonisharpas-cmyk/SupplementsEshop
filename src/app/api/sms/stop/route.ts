/* Public: stop SMS offers to a number (the link at the end of every SMS).
   Always answers the same way, so it cannot be used to find out whether a
   number is on the list. */

import { z } from 'zod'
import { fail, json, readJson } from '@/lib/api'
import { phoneSchema } from '@/lib/validation'
import { unsubscribeSms } from '@/lib/sms-marketing'
import { clientKey, hit } from '@/lib/rate-limit'

const schema = z.object({ phone: phoneSchema })

export async function POST(request: Request) {
  if (!hit(`sms-stop:${clientKey(request)}`, 10, 600).ok) return fail(429, 'TOO_MANY', 'Too many tries. Wait a few minutes.')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  await unsubscribeSms(body.data.phone)
  return json({ ok: true })
}
