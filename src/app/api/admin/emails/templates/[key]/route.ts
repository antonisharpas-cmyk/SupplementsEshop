/* ============================================================================
 * PUT    /api/admin/emails/templates/:key   save the owner's changes
 * DELETE /api/admin/emails/templates/:key   back to the built-in words
 *
 * The words are plain text with {{variables}}; saveTemplate refuses unknown
 * variables and refuses switching off a required email.
 * ========================================================================== */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { audit } from '@/lib/audit'
import { TEMPLATE_KEYS, type TemplateKey } from '@/lib/email-templates'
import { resetTemplateWords, saveTemplate, TemplateError } from '@/lib/mailer'

const words = z.object({
  subject: z.string().max(200).optional(),
  body: z.string().max(6000).optional(),
  cta: z.string().max(60).optional(),
})
const schema = z
  .object({
    enabled: z.boolean().optional(),
    delayMinutes: z.number().int().min(0).max(100_000).optional(),
    content: z.object({ en: words.optional(), el: words.optional(), ru: words.optional() }).optional(),
  })
  .strict()

const keyOk = (k: string): k is TemplateKey => (TEMPLATE_KEYS as string[]).includes(k)

export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { key } = await context.params
  if (!keyOk(key)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? 'That was not valid.' }, { status: 422 })
  }
  try {
    await saveTemplate(key, parsed.data as Parameters<typeof saveTemplate>[1], guard.user.id)
    await audit({ actor: guard.user, action: 'email_template.update', entity: 'email_template', entityId: key, diff: { changed: Object.keys(parsed.data) } })
    return Response.json({ ok: true })
  } catch (err) {
    if (err instanceof TemplateError) return Response.json({ ok: false, message: err.message }, { status: 422 })
    throw err
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ key: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { key } = await context.params
  if (!keyOk(key)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  await resetTemplateWords(key)
  await audit({ actor: guard.user, action: 'email_template.reset', entity: 'email_template', entityId: key })
  return Response.json({ ok: true })
}
