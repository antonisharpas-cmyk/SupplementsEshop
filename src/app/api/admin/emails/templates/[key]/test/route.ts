/* POST /api/admin/emails/templates/:key/test — send the email, with sample
   values, to the test address set in Marketing & Emails → Settings. Only
   there: the address is never taken from the request. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { sampleVars, templateDef, TEMPLATE_KEYS, type TemplateKey } from '@/lib/email-templates'
import { sendTemplate } from '@/lib/mailer'
import { siteUrl } from '@/lib/email'
import { getSettings } from '@/lib/settings'

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

  const { email_test_address } = await getSettings(['email_test_address'])
  if (!email_test_address) {
    return Response.json(
      { ok: false, error: 'NO_TEST_ADDRESS', message: 'Set a test email address in Marketing & Emails → Settings first.' },
      { status: 409 },
    )
  }
  const def = templateDef(key as TemplateKey)
  const result = await sendTemplate(key as TemplateKey, {
    to: email_test_address,
    locale: parsed.data.locale,
    vars: sampleVars(def),
    wordsOverride: parsed.data.content,
    ignoreDisabled: true,
    subjectPrefix: '[Test] ',
    unsubscribe:
      def.category === 'marketing'
        ? { pageUrl: siteUrl(`/${parsed.data.locale}/newsletter/unsubscribe`), oneClickUrl: siteUrl('/api/newsletter/unsubscribe') }
        : undefined,
  })
  return Response.json({ ok: true, to: email_test_address, status: result.status })
}
