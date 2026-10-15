/* ============================================================================
 * Transactional email — spec section 42.
 *
 * Provider-agnostic on purpose: the shop will likely change provider at least
 * once, and the OTP flow must not be coupled to a vendor SDK. `send()` is the
 * only thing the rest of the codebase calls.
 *
 * With no EMAIL_API_KEY set, mail is written to the log instead. That keeps
 * registration testable end to end on a laptop with nothing to sign up for —
 * and in development the OTP is printed so you can complete the flow.
 * ========================================================================== */

import { BRAND } from '@/config/brand'

export type EmailMessage = {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
  /** What this is, for the log: 'support_new', 'newsletter_welcome', … */
  kind?: string
  /**
   * Transactional mail (codes, support, orders) goes to anyone it concerns.
   * Lifecycle mail (welcome, back in stock) follows something the customer
   * did. Marketing mail needs consent and an unsubscribe link. The three are
   * typed separately so they can never be confused in the log.
   */
  category?: 'transactional' | 'lifecycle' | 'marketing'
  /** Extra headers — e.g. List-Unsubscribe on marketing mail. */
  headers?: Record<string, string>
  /** An id this email is about (a conversation, a subscriber), for the log. */
  relatedId?: string
}

export type SendResult =
  | { sent: true; providerId?: string; logId?: string }
  | { sent: false; reason: 'NO_PROVIDER' | 'PROVIDER_ERROR'; detail?: string; logId?: string }

const PROVIDER = process.env.EMAIL_PROVIDER ?? 'resend'
const API_KEY = process.env.EMAIL_API_KEY
const FROM = process.env.EMAIL_FROM ?? `${BRAND.name} <no-reply@example.com>`

export const emailEnabled = Boolean(API_KEY)

/* ------------------------------------------------------------------ send --- */

export async function send(message: EmailMessage): Promise<SendResult> {
  let result: SendResult
  if (!API_KEY) {
    /* Not an error in development — it is the documented fallback. */
    console.info(
      `\n──── email (not sent: EMAIL_API_KEY is unset) ────\n` +
        `to:      ${message.to}\n` +
        `subject: ${message.subject}\n\n${message.text}\n` +
        `─────────────────────────────────────────────────\n`,
    )
    result = { sent: false, reason: 'NO_PROVIDER' }
  } else {
    try {
      result =
        PROVIDER === 'resend'
          ? await sendViaResend(message)
          : { sent: false, reason: 'PROVIDER_ERROR', detail: `Unknown provider "${PROVIDER}"` }
    } catch (err) {
      /* A failed email must never fail the request that triggered it. An order
         that is paid for but whose confirmation email bounced is still an order. */
      console.error('[email] send threw:', err instanceof Error ? err.message : err)
      result = { sent: false, reason: 'PROVIDER_ERROR', detail: err instanceof Error ? err.message : undefined }
    }
  }

  const logId = await logEmail(message, result)
  return { ...result, logId }
}

/* Every attempt is written down — best effort: the log must never be the
   reason an email "failed". Imported lazily so this module stays usable
   from places that have no database. */
async function logEmail(message: EmailMessage, result: SendResult): Promise<string | undefined> {
  try {
    const [{ db }, { emailLog }] = await Promise.all([import('@/db'), import('@/db/schema')])
    const kind = message.kind ?? 'other'
    const [row] = await db.insert(emailLog).values({
      kind,
      category: message.category ?? 'transactional',
      toEmail: message.to.slice(0, 255),
      subject: message.subject.slice(0, 300),
      status: result.sent ? 'sent' : result.reason === 'NO_PROVIDER' ? 'logged' : 'failed',
      error: result.sent ? null : (result.detail ?? null),
      /* With no provider (development) the body is the only copy there is,
         so it is kept to be read and tested. Never for sign-in codes, and
         never once a real provider is sending. */
      body: !API_KEY && !kind.startsWith('auth') ? message.text : null,
      relatedId: message.relatedId ?? null,
    }).returning({ id: emailLog.id })
    return row?.id
  } catch {
    /* no database, or it is down — the email outcome stands regardless */
    return undefined
  }
}

async function sendViaResend(message: EmailMessage): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      reply_to: message.replyTo,
      headers: message.headers,
    }),
  })

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error('[email] resend rejected the message', res.status, detail)
    return { sent: false, reason: 'PROVIDER_ERROR', detail }
  }

  const body = (await res.json().catch(() => null)) as { id?: string } | null
  return { sent: true, providerId: body?.id }
}

/* ------------------------------------------------------------ html pieces -- */

/* The words of every email live in lib/email-templates.ts and are sent with
   lib/mailer.ts (sendTemplate). These are re-exported for the few places that
   build a message themselves — the newsletter campaigns. */
export { escapeHtml, htmlLayout } from './email-templates'

/** Absolute links for emails — the site's own base URL, from the environment. */
export function siteUrl(path: string): string {
  const base = (process.env.PUBLIC_SITE_URL ?? 'http://localhost:3100').replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}
