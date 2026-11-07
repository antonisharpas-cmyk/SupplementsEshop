/* Admin: how many days after delivery a partner's commission counts as earned. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { invalidateSettingsCache, setSetting } from '@/lib/settings'

const schema = z.object({ returnDays: z.number().int().min(0).max(365) })

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  await setSetting('partner_return_days', body.data.returnDays, guard.user.id)
  invalidateSettingsCache()
  await audit({ actor: guard.user, action: 'partner.return_days', entity: 'setting', entityId: 'partner_return_days', diff: body.data })
  return json({ ok: true })
}
