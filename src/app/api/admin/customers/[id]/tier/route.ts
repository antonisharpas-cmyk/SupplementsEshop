/* Admin: a customer's membership tier.
     { action: 'set', tier, until: 'YYYY-MM-DD', note? }  fixed until that date
     { action: 'auto' }                                     back to the rules now
     { action: 'recheck' }                                  apply the rules now */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { clearManualTier, evaluateTier, setTierManually, TIER_KEYS, type TierKey } from '@/lib/loyalty'
import { audit } from '@/lib/audit'
import { UUID, fail, json, readJson } from '@/lib/api'

const schema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    tier: z.enum(TIER_KEYS as [string, ...string[]]),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an end date.'),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal('auto') }),
  z.object({ action: z.literal('recheck') }),
])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const b = body.data
  try {
    if (b.action === 'set') {
      /* The end of that day, Cyprus time. */
      const until = new Date(`${b.until}T23:59:59+03:00`)
      if (!(until > new Date())) return fail(422, 'DATE', 'The end date must be in the future.')
      await setTierManually({ userId: id, tier: b.tier as TierKey, until, by: guard.user.id, note: b.note })
    } else if (b.action === 'auto') {
      await clearManualTier(id, guard.user.id)
    } else {
      await evaluateTier(id)
    }
  } catch (err) {
    return fail(409, 'REFUSED', err instanceof Error ? err.message : 'That did not work.')
  }
  await audit({ actor: guard.user, action: `customer.tier_${b.action}`, entity: 'user', entityId: id, diff: b as Record<string, unknown> })
  revalidatePath(`/admin/customers/${id}`)
  return json({ ok: true })
}
