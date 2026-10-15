/* Marketing & Emails → one automated email: switch, timing, words in each
   language, preview and a test send. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardAdmin } from '@/lib/admin'
import { templateState } from '@/lib/mailer'
import { TEMPLATE_KEYS, VARIABLES, type TemplateKey } from '@/lib/email-templates'
import { getSettings } from '@/lib/settings'
import { TemplateEditor } from '@/components/admin/TemplateEditor'

export const dynamic = 'force-dynamic'

export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!(TEMPLATE_KEYS as string[]).includes(key)) notFound()
  await guardAdmin(`/admin/emails/${key}`)
  const [state, settings] = await Promise.all([templateState(key as TemplateKey), getSettings(['email_test_address'])])
  const def = state.def

  return (
    <>
      <p className="mb-4 text-sm">
        <Link href="/admin/emails" className="text-muted underline hover:text-ink">
          ← Automated emails
        </Link>
      </p>
      <TemplateEditor
        def={{
          key: def.key,
          name: def.name,
          category: def.category,
          required: def.required,
          internal: Boolean(def.internal),
          trigger: def.trigger,
          note: def.note ?? null,
          timing: def.timing ?? null,
          hasCta: Boolean(def.ctaUrl),
          words: def.words,
        }}
        variables={def.variables.map((v) => ({
          name: v,
          label: VARIABLES[v]?.label ?? v,
          block: Boolean(VARIABLES[v]?.block),
        }))}
        initial={{
          enabled: state.enabled,
          delayMinutes: state.delayMinutes,
          content: state.content ?? {},
          updatedAt: state.updatedAt?.toISOString() ?? null,
        }}
        testAddress={settings.email_test_address}
      />
    </>
  )
}
