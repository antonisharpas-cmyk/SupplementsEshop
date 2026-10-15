/* ============================================================================
 * Sending a templated email.
 *
 *   sendTemplate('welcome', { to, locale, vars })
 *
 * Looks up the template (built-in words + the owner's edits), refuses when an
 * optional template has been switched off, renders it in the recipient's
 * language (English when that language has nothing), adds the right footer —
 * an unsubscribe line for marketing — and hands it to email.ts `send`, which
 * logs every attempt.
 *
 * It does not decide WHETHER someone should get an email: consent, cooldowns
 * and "have they bought it since?" are the automation's job
 * (lib/automations.ts). This only sends what it is given, correctly.
 * ========================================================================== */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { emailTemplates } from '@/db/schema'
import { send, siteUrl, type SendResult } from '@/lib/email'
import {
  escapeHtml,
  render,
  templateDef,
  TEMPLATES,
  wordsFor,
  type EmailCategory,
  type Locale,
  type Override,
  type TemplateDef,
  type TemplateKey,
  type Vars,
} from '@/lib/email-templates'

export const asEmailLocale = (v: string | null | undefined): Locale => (v === 'el' || v === 'ru' ? v : 'en')

export type TemplateState = {
  def: TemplateDef
  enabled: boolean
  delayMinutes: number | null
  content: Record<string, Override> | null
  updatedAt: Date | null
}

function stateFrom(def: TemplateDef, row?: typeof emailTemplates.$inferSelect): TemplateState {
  return {
    def,
    /* A required template is on, whatever was stored. */
    enabled: def.required ? true : (row?.enabled ?? def.defaultEnabled),
    delayMinutes: def.timing ? (row?.delayMinutes ?? def.timing.minutes) : null,
    content: row?.content ?? null,
    updatedAt: row?.updatedAt ?? null,
  }
}

export async function templateState(key: TemplateKey): Promise<TemplateState> {
  const def = templateDef(key)
  const [row] = await db.select().from(emailTemplates).where(eq(emailTemplates.key, key)).limit(1)
  return stateFrom(def, row)
}

export async function allTemplateStates(): Promise<TemplateState[]> {
  const rows = await db.select().from(emailTemplates)
  const byKey = new Map(rows.map((r) => [r.key, r]))
  return TEMPLATES.map((def) => stateFrom(def, byKey.get(def.key)))
}

const LOG_CATEGORY: Record<EmailCategory, 'transactional' | 'lifecycle' | 'marketing'> = {
  essential: 'transactional',
  lifecycle: 'lifecycle',
  marketing: 'marketing',
}

const FOOTERS: Record<Locale, { why: string; unsubscribe: string; lifecycle: string }> = {
  en: {
    why: 'You’re receiving this because you agreed to hear from AIONIX.',
    unsubscribe: 'Unsubscribe',
    lifecycle: 'You’re receiving this because of your AIONIX account.',
  },
  el: {
    why: 'Λαμβάνεις αυτό το email επειδή συμφώνησες να λαμβάνεις νέα από το AIONIX.',
    unsubscribe: 'Διαγραφή',
    lifecycle: 'Λαμβάνεις αυτό το email λόγω του λογαριασμού σου στο AIONIX.',
  },
  ru: {
    why: 'Вы получили это письмо, потому что согласились получать новости AIONIX.',
    unsubscribe: 'Отписаться',
    lifecycle: 'Вы получили это письмо в связи с вашим аккаунтом AIONIX.',
  },
}

/** The values every template may use without the caller passing them. */
function standardVars(locale: Locale): Vars {
  return {
    shop_url: siteUrl(`/${locale}`),
    contact_url: siteUrl(`/${locale}/contact`),
    sign_in_url: siteUrl(`/${locale}/sign-in`),
    bag_url: siteUrl(`/${locale}/cart`),
  }
}

export type TemplateSendOptions = {
  to: string
  locale?: string | null
  vars: Vars
  /** Marketing: where the unsubscribe link and header point. Required for
   *  marketing templates — sending one without it is refused. */
  unsubscribe?: { pageUrl: string; oneClickUrl: string }
  replyTo?: string
  relatedId?: string
  /** Render with a given set of words instead of the stored ones (preview/test). */
  wordsOverride?: Record<string, Override>
  /** Ignore "switched off" — for the admin's test send only. */
  ignoreDisabled?: boolean
  subjectPrefix?: string
}

export type TemplateSendResult =
  | { status: 'sent' | 'logged' | 'failed'; subject: string; logId?: string; detail?: string }
  | { status: 'disabled'; subject?: undefined }

/** Render without sending — the admin preview, and tests. */
export async function renderTemplate(
  key: TemplateKey,
  locale: Locale,
  vars: Vars,
  opts: { override?: Record<string, Override> | null; unsubscribeUrl?: string } = {},
) {
  const state = await templateState(key)
  const def = state.def
  const words = wordsFor(def, locale, opts.override === undefined ? state.content : opts.override)
  const f = FOOTERS[def.internal ? 'en' : locale]
  const footer =
    def.category === 'marketing'
      ? {
          text: `${f.why}\n${f.unsubscribe}: ${opts.unsubscribeUrl ?? siteUrl(`/${locale}/newsletter/unsubscribe`)}`,
          html: `<br>${escapeHtml(f.why)} <a href="${escapeHtml(opts.unsubscribeUrl ?? siteUrl(`/${locale}/newsletter/unsubscribe`))}" style="color:#6b6b6b">${escapeHtml(f.unsubscribe)}</a>`,
        }
      : def.category === 'lifecycle'
        ? { text: f.lifecycle, html: `<br>${escapeHtml(f.lifecycle)}` }
        : undefined
  return {
    state,
    rendered: render(def, words, { ...standardVars(locale), ...vars }, { siteBase: siteUrl('/'), footer }),
  }
}

export async function sendTemplate(key: TemplateKey, o: TemplateSendOptions): Promise<TemplateSendResult> {
  const locale = asEmailLocale(o.locale)
  const state = await templateState(key)
  if (!state.enabled && !o.ignoreDisabled) return { status: 'disabled' }
  if (state.def.category === 'marketing' && !o.unsubscribe) {
    throw new Error(`Refusing to send marketing email "${key}" without an unsubscribe link.`)
  }

  const { rendered } = await renderTemplate(key, locale, o.vars, {
    override: o.wordsOverride ?? state.content,
    unsubscribeUrl: o.unsubscribe?.pageUrl,
  })
  const subject = `${o.subjectPrefix ?? ''}${rendered.subject}`
  const result: SendResult = await send({
    to: o.to,
    subject,
    text: rendered.text,
    html: rendered.html,
    replyTo: o.replyTo,
    kind: key,
    category: LOG_CATEGORY[state.def.category],
    relatedId: o.relatedId,
    headers: o.unsubscribe
      ? { 'List-Unsubscribe': `<${o.unsubscribe.oneClickUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
      : undefined,
  })
  return {
    status: result.sent ? 'sent' : result.reason === 'NO_PROVIDER' ? 'logged' : 'failed',
    subject,
    logId: result.logId,
    detail: result.sent ? undefined : result.detail,
  }
}

/* ============================================================ editing == */

export class TemplateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateError'
  }
}

export type TemplatePatch = {
  enabled?: boolean
  delayMinutes?: number
  content?: Record<string, Override>
}

/**
 * Save the owner's changes. Refuses: switching off a required email, a delay
 * outside the template's bounds, and any {{variable}} the template does not
 * offer — so a typo is caught here, not discovered in a customer's inbox.
 */
export async function saveTemplate(key: TemplateKey, patch: TemplatePatch, adminId: string | null) {
  const def = templateDef(key)
  if (patch.enabled === false && def.required) {
    throw new TemplateError(`“${def.name}” is required and cannot be switched off.`)
  }
  if (patch.delayMinutes !== undefined) {
    if (!def.timing) throw new TemplateError('This email has no timing to change.')
    if (patch.delayMinutes < def.timing.min || patch.delayMinutes > def.timing.max) {
      throw new TemplateError(`Choose between ${def.timing.min / 60} and ${def.timing.max / 60} hours.`)
    }
  }
  const { unknownVariables } = await import('@/lib/email-templates')
  if (patch.content) {
    for (const [loc, words] of Object.entries(patch.content)) {
      if (!['en', 'el', 'ru'].includes(loc)) throw new TemplateError(`Unknown language ${loc}.`)
      for (const [field, text] of Object.entries(words ?? {})) {
        if (typeof text !== 'string') continue
        const bad = unknownVariables(text, def.variables)
        if (bad.length) {
          throw new TemplateError(
            `{{${bad[0]}}} is not available in this email (${loc.toUpperCase()} ${field}). Available: ${def.variables.map((v) => `{{${v}}}`).join(' ')}`,
          )
        }
      }
    }
  }
  const current = await templateState(key)
  await db
    .insert(emailTemplates)
    .values({
      key,
      enabled: def.required ? null : (patch.enabled ?? current.enabled),
      delayMinutes: patch.delayMinutes ?? (def.timing ? current.delayMinutes : null),
      content: patch.content ?? current.content,
      updatedBy: adminId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: {
        enabled: def.required ? null : (patch.enabled ?? current.enabled),
        delayMinutes: patch.delayMinutes ?? (def.timing ? current.delayMinutes : null),
        content: patch.content ?? current.content,
        updatedBy: adminId,
        updatedAt: new Date(),
      },
    })
}

/** Back to the built-in words (the on/off switch and timing are kept). */
export async function resetTemplateWords(key: TemplateKey) {
  await db.update(emailTemplates).set({ content: null, updatedAt: new Date() }).where(eq(emailTemplates.key, key))
}
