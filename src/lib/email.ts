/* ============================================================================
 * Transactional email — spec section 42.
 *
 * Provider-agnostic on purpose: the shop will likely change provider at least
 * once, and the OTP flow must not be coupled to a vendor SDK. `send()` is the
 * only thing the rest of the codebase calls.
 *
 * Providers: EMAIL_PROVIDER="gmail" sends through Google Workspace (Gmail
 * SMTP with an app password); "resend" through Resend's API.
 *
 * With no provider credentials set, mail is written to the log instead. That keeps
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

const PROVIDER = (process.env.EMAIL_PROVIDER ?? 'resend').trim().toLowerCase()
const API_KEY = process.env.EMAIL_API_KEY
const GMAIL_USER = process.env.GMAIL_USER?.trim()
/* Google shows app passwords in groups of four ("abcd efgh ijkl mnop"). */
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '')
const FROM =
  process.env.EMAIL_FROM ??
  (PROVIDER === 'gmail' && GMAIL_USER ? `${BRAND.name} <${GMAIL_USER}>` : `${BRAND.name} <no-reply@example.com>`)

/** True when a real provider is configured and mail actually leaves. */
export const emailEnabled = PROVIDER === 'gmail' ? Boolean(GMAIL_USER && GMAIL_APP_PASSWORD) : Boolean(API_KEY)
/** For the admin: which service sends the shop's email. */
export const emailProviderName = PROVIDER === 'gmail' ? 'Google Workspace (Gmail)' : PROVIDER === 'resend' ? 'Resend' : PROVIDER

/* ------------------------------------------------------------------ send --- */

export async function send(message: EmailMessage): Promise<SendResult> {
  let result: SendResult
  if (!emailEnabled) {
    /* Not an error in development — it is the documented fallback. */
    console.info(
      `\n──── email (not sent: no email provider is configured) ────\n` +
        `to:      ${message.to}\n` +
        `subject: ${message.subject}\n\n${message.text}\n` +
        `─────────────────────────────────────────────────\n`,
    )
    result = { sent: false, reason: 'NO_PROVIDER' }
  } else {
    try {
      result =
        PROVIDER === 'gmail'
          ? await sendViaGmail(message)
          : PROVIDER === 'resend'
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
      body: !emailEnabled && !kind.startsWith('auth') ? message.text : null,
      relatedId: message.relatedId ?? null,
    }).returning({ id: emailLog.id })
    return row?.id
  } catch {
    /* no database, or it is down — the email outcome stands regardless */
    return undefined
  }
}

/* Google Workspace: Gmail's SMTP server with an app password (Google account,
   Security, 2 Step Verification, App passwords). One pooled connection is
   reused across sends, so a newsletter does not log in once per email.
   Workspace allows about 2,000 messages a day per user. */
let gmailTransport: import('nodemailer').Transporter | null = null

async function gmail() {
  if (!gmailTransport) {
    const nodemailer = (await import('nodemailer')).default
    gmailTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
  }
  return gmailTransport
}

async function sendViaGmail(message: EmailMessage): Promise<SendResult> {
  try {
    const info = await (await gmail()).sendMail({
      from: FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo,
      headers: message.headers,
    })
    return { sent: true, providerId: info.messageId }
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    console.error('[email] gmail rejected the message', detail)
    return { sent: false, reason: 'PROVIDER_ERROR', detail }
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
