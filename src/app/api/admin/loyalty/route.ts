/* PUT /api/admin/loyalty: save the membership tier rules (Admin, Settings).
   Customers' tiers are rechecked against the new rules on the automation
   clock over the next hours; nobody is moved down early because of a change
   (stepping down only ever happens when a tier period ends). */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { setSetting } from '@/lib/settings'
import { normaliseTiers, TIER_KEYS } from '@/lib/loyalty'
import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { audit } from '@/lib/audit'
import { fail, json, readJson } from '@/lib/api'

const tier = z.object({
  key: z.enum(TIER_KEYS as [string, ...string[]]),
  discountPercent: z.number().min(0).max(90),
  minOrders: z.number().int().min(0).max(10_000),
  minSpendCents: z.number().int().min(0).max(100_000_000),
  durationMonths: z.number().int().min(1).max(60),
})

const schema = z.object({
  enabled: z.boolean(),
  windowMonths: z.number().int().min(1).max(36),
  nearGoalPercent: z.number().int().min(1).max(99),
  warningDays: z.number().int().min(1).max(90),
  lastCallDays: z.number().int().min(1).max(30),
  keepMinOrders: z.number().int().min(1).max(100),
  tiers: z.array(tier).length(5),
})

export async function PUT(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const b = body.data
  const tiers = normaliseTiers(b.tiers)
  /* Each tier must ask for at least as much as the one below it. */
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minOrders < tiers[i - 1].minOrders || tiers[i].minSpendCents < tiers[i - 1].minSpendCents) {
      return fail(422, 'ORDER', `${tiers[i].key} must need at least as many orders and as much spend as ${tiers[i - 1].key}.`)
    }
  }
  await setSetting('loyalty_enabled', b.enabled)
  await setSetting('loyalty_tiers', tiers)
  await setSetting('loyalty_window_months', b.windowMonths)
  await setSetting('loyalty_near_goal_percent', b.nearGoalPercent)
  await setSetting('loyalty_warning_days', b.warningDays)
  await setSetting('loyalty_last_call_days', b.lastCallDays)
  await setSetting('loyalty_keep_min_orders', b.keepMinOrders)
  /* Recheck everyone against the new rules on the next ticks. */
  await db.update(users).set({ tierCheckedAt: null }).where(eq(users.role, 'CUSTOMER'))
  await audit({ actor: guard.user, action: 'settings.loyalty', entity: 'settings', entityId: 'loyalty', diff: b as unknown as Record<string, unknown> })
  revalidatePath('/admin/settings')
  return json({ ok: true })
}
