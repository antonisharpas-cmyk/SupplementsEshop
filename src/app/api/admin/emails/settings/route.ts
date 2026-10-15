/* PATCH /api/admin/emails/settings — the test address and the frequency limit. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { setSetting } from '@/lib/settings'

const schema = z
  .object({
    email_test_address: z.union([z.literal(''), z.string().trim().toLowerCase().email().max(255)]).optional(),
    marketing_cooldown_hours: z.number().int().min(0).max(24 * 14).optional(),
  })
  .strict()

export async function PATCH(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? 'That was not valid.' }, { status: 422 })
  }
  for (const [k, v] of Object.entries(parsed.data)) {
    await setSetting(k as keyof typeof parsed.data, v as never, guard.user.id)
  }
  return Response.json({ ok: true })
}
