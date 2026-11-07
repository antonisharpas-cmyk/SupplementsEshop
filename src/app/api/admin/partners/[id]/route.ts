/* Admin: one partner.
 *
 *   { action: 'set', isPartner, ratePercent }     mark as partner, commission
 *   { action: 'codes', codeIds: [uuid, …] }       the promo codes that earn for them
 *   { action: 'payout', amountCents, paidOn, note? }   record a payment to them
 *   { action: 'delete_payout', payoutId }         undo a payment recorded by mistake
 */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { UUID, fail, json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { deletePayout, PartnerError, recordPayout, setPartner, setPartnerCodes } from '@/lib/partners'

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), isPartner: z.boolean(), ratePercent: z.number().min(0).max(50) }),
  z.object({ action: z.literal('codes'), codeIds: z.array(z.string().uuid()).max(100) }),
  z.object({
    action: z.literal('payout'),
    amountCents: z.number().int().min(1).max(100_000_000),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().max(300).optional().nullable(),
  }),
  z.object({ action: z.literal('delete_payout'), payoutId: z.string().uuid() }),
])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const d = body.data
  try {
    if (d.action === 'set') await setPartner(id, d)
    else if (d.action === 'codes') await setPartnerCodes(id, d.codeIds)
    else if (d.action === 'payout') await recordPayout(id, d, guard.user.id)
    else await deletePayout(id, d.payoutId)
  } catch (err) {
    if (err instanceof PartnerError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[api/admin/partners] failed', err)
    return fail(500, 'FAILED', 'That did not work.')
  }
  await audit({ actor: guard.user, action: `partner.${d.action}`, entity: 'user', entityId: id, diff: d })
  return json({ ok: true })
}
