/* Account: turn SMS offers on or off for the account's phone number. */

import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/session'
import { fail, json, readJson } from '@/lib/api'
import { smsStatusForUser, subscribeSms, unsubscribeSms } from '@/lib/sms-marketing'

const schema = z.object({ subscribed: z.boolean(), locale: z.enum(['en', 'el', 'ru']).optional() })

export async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return fail(401, 'SIGNED_OUT', 'Sign in first.')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const status = await smsStatusForUser(user.id)
  if (!status) return fail(409, 'NO_PHONE', 'Add a phone number to your profile first.')
  if (body.data.subscribed) {
    await subscribeSms({ phone: status.phone, userId: user.id, firstName: user.firstName, locale: body.data.locale, source: 'account' })
  } else {
    await unsubscribeSms(status.phone)
  }
  return json({ ok: true, subscribed: body.data.subscribed })
}
