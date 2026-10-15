/* POST /api/admin/emails/templates/:key/preview — the email as it would look,
   with sample values, in one language, using the words being edited (unsaved)
   or the stored ones. Nothing is sent. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { sampleVars, templateDef, TEMPLATE_KEYS, type TemplateKey } from '@/lib/email-templates'
import { renderTemplate } from '@/lib/mailer'

const words = z.object({ subject: z.string().max(200).optional(), body: z.string().max(6000).optional(), cta: z.string().max(60).optional() })
const schema = z.object({
  locale: z.enum(['en', 'el', 'ru']).default('en'),
  content: z.object({ en: words.optional(), el: words.optional(), ru: words.optional() }).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ key: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { key } = await context.params
  if (!(TEMPLATE_KEYS as string[]).includes(key)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return Response.json({ ok: false, message: 'That was not valid.' }, { status: 422 })
  const def = templateDef(key as TemplateKey)
  const { rendered } = await renderTemplate(key as TemplateKey, parsed.data.locale, sampleVars(def), {
    override: parsed.data.content,
  })
  return Response.json({ ok: true, ...rendered })
}
