/* Admin: a customer's account. Staff never see or set a password; they can
   send the customer a reset code, and switch the account off or on. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { adminTriggerPasswordReset } from '@/lib/auth/account'
import { OrderError, setCustomerActive } from '@/lib/orders'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset_password') }),
  z.object({ action: z.literal('active'), isActive: z.boolean() }),
])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    if (body.data.action === 'reset_password') {
      const sent = await adminTriggerPasswordReset(id)
      if (!sent) return fail(409, 'REFUSED', 'Could not send a code right now. Try again in a few minutes.')
    } else {
      await setCustomerActive(id, body.data.isActive)
    }
  } catch (err) {
    if (err instanceof OrderError) return fail(404, 'NOT_FOUND', err.message)
    console.error('[api/admin/customers] failed', err)
    return fail(500, 'FAILED', 'That did not work.')
  }
  await audit({ actor: guard.user, action: `customer.${body.data.action}`, entity: 'user', entityId: id, diff: body.data })
  return json({ ok: true })
}
