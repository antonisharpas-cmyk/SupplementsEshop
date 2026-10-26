/* PATCH /api/admin/support/settings — the automatic first reply in the chat:
   on/off and its words in each language. Plain text only: it is shown to the
   customer as text (React escapes it) and never as HTML. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { setSetting } from '@/lib/settings'
import { MESSAGE_MAX } from '@/lib/support'

const text = z.string().trim().max(MESSAGE_MAX)

const schema = z
  .object({
    support_auto_reply_enabled: z.boolean().optional(),
    support_auto_reply_en: text.optional(),
    support_auto_reply_el: text.optional(),
    support_auto_reply_ru: text.optional(),
  })
  .strict()
  .refine((v) => v.support_auto_reply_enabled !== true || v.support_auto_reply_en === undefined || v.support_auto_reply_en.length > 0, {
    message: 'Write the English reply — it is used whenever a language has none.',
    path: ['support_auto_reply_en'],
  })

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
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
