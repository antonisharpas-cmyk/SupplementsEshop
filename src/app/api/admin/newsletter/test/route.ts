/* POST /api/admin/newsletter/test — the draft, to the configured test address
   only (Marketing & Emails → Settings), never to one typed in the request. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { NewsletterError, sendTestCampaign } from '@/lib/newsletter'
import { draftSchema } from '../schema'

const schema = draftSchema.extend({ previewLocale: z.enum(['en', 'el', 'ru']).default('en') })

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? 'That was not valid.' }, { status: 422 })
  }
  const { previewLocale, ...draft } = parsed.data
  try {
    const { to, result } = await sendTestCampaign(draft, previewLocale)
    return Response.json({
      ok: true,
      to,
      delivered: result.sent,
      note: result.sent ? undefined : 'No email service is configured, so it was written to the server log instead.',
    })
  } catch (err) {
    if (err instanceof NewsletterError) return Response.json({ ok: false, error: err.code, message: err.message }, { status: 409 })
    throw err
  }
}
