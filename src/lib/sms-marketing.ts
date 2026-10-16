/* ============================================================================
 * SMS marketing: who has said yes, and sending a campaign to them.
 *
 *  · Only numbers that opted in (registration, checkout or the account page)
 *    ever receive a campaign. Saying no is kept, so it sticks.
 *  · Every campaign ends with an opt out line pointing at /sms-stop, where
 *    anyone can stop offers to their number in one step.
 *  · The message is the same for everyone in a campaign, so numbers go to
 *    sms.to in batches of up to 1,000 per request.
 * ========================================================================== */

import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { smsCampaigns, smsSubscribers, users } from '@/db/schema'
import { siteUrl } from '@/lib/email'
import { normalisePhone } from '@/lib/validation'
import { SMS_BATCH, SMS_SENDER_ID, sendSms, smsLength } from '@/lib/sms'

export type SmsAudience = 'all' | 'en' | 'el' | 'ru'
export type SmsSource = 'registration' | 'checkout' | 'account' | 'admin'

export class SmsError extends Error {}

/* ------------------------------------------------------------- consent -- */

export async function subscribeSms(args: {
  phone: string
  userId?: string | null
  firstName?: string | null
  locale?: string
  source: SmsSource
}) {
  const phone = normalisePhone(args.phone)
  if (!phone) throw new SmsError('That is not a valid phone number.')
  const now = new Date()
  const locale = args.locale === 'el' || args.locale === 'ru' ? args.locale : 'en'
  await db
    .insert(smsSubscribers)
    .values({
      phone,
      userId: args.userId ?? null,
      firstName: args.firstName ?? null,
      locale,
      status: 'SUBSCRIBED',
      source: args.source,
      consentAt: now,
    })
    .onConflictDoUpdate({
      target: smsSubscribers.phone,
      set: {
        status: 'SUBSCRIBED',
        source: args.source,
        consentAt: now,
        unsubscribedAt: null,
        locale,
        userId: sql`coalesce(${args.userId ?? null}::uuid, ${smsSubscribers.userId})`,
        firstName: sql`coalesce(${args.firstName ?? null}::text, ${smsSubscribers.firstName})`,
        updatedAt: now,
      },
    })
  return phone
}

/** Stop offers to a number. Returns false if it was never subscribed. */
export async function unsubscribeSms(rawPhone: string): Promise<boolean> {
  const phone = normalisePhone(rawPhone)
  if (!phone) throw new SmsError('That is not a valid phone number.')
  const now = new Date()
  const rows = await db
    .update(smsSubscribers)
    .set({ status: 'UNSUBSCRIBED', unsubscribedAt: now, updatedAt: now })
    .where(and(eq(smsSubscribers.phone, phone), eq(smsSubscribers.status, 'SUBSCRIBED')))
    .returning({ id: smsSubscribers.id })
  return rows.length > 0
}

/** The SMS preference for a signed in customer, by their account's phone. */
export async function smsStatusForUser(userId: string): Promise<{ phone: string; subscribed: boolean } | null> {
  const [u] = await db.select({ phone: users.phone }).from(users).where(eq(users.id, userId))
  if (!u?.phone) return null
  const [s] = await db.select({ status: smsSubscribers.status }).from(smsSubscribers).where(eq(smsSubscribers.phone, u.phone))
  return { phone: u.phone, subscribed: s?.status === 'SUBSCRIBED' }
}

/* ------------------------------------------------------------ audience -- */

function audienceWhere(a: SmsAudience) {
  return a === 'all'
    ? eq(smsSubscribers.status, 'SUBSCRIBED')
    : and(eq(smsSubscribers.status, 'SUBSCRIBED'), eq(smsSubscribers.locale, a))
}

export async function audienceCounts(): Promise<Record<SmsAudience, number>> {
  const rows = await db
    .select({ locale: smsSubscribers.locale, n: sql<number>`count(*)::int` })
    .from(smsSubscribers)
    .where(eq(smsSubscribers.status, 'SUBSCRIBED'))
    .groupBy(smsSubscribers.locale)
  const out: Record<SmsAudience, number> = { all: 0, en: 0, el: 0, ru: 0 }
  for (const r of rows) {
    if (r.locale === 'en' || r.locale === 'el' || r.locale === 'ru') out[r.locale] += r.n
    out.all += r.n
  }
  return out
}

export async function audiencePhones(a: SmsAudience): Promise<string[]> {
  const rows = await db.select({ phone: smsSubscribers.phone }).from(smsSubscribers).where(audienceWhere(a)).orderBy(smsSubscribers.createdAt)
  return rows.map((r) => r.phone)
}

export async function listSmsSubscribers(limit = 100) {
  const [rows, [{ subscribed, unsubscribed }]] = await Promise.all([
    db.select().from(smsSubscribers).orderBy(desc(smsSubscribers.updatedAt)).limit(limit),
    db
      .select({
        subscribed: sql<number>`count(*) filter (where ${smsSubscribers.status} = 'SUBSCRIBED')::int`,
        unsubscribed: sql<number>`count(*) filter (where ${smsSubscribers.status} = 'UNSUBSCRIBED')::int`,
      })
      .from(smsSubscribers),
  ])
  return { rows, subscribed, unsubscribed }
}

/* ------------------------------------------------------------ messages -- */

/** The opt out line every campaign ends with. Plain ASCII on purpose, so it
 *  never forces a message into the shorter Unicode SMS size by itself. */
export function optOutLine() {
  const host = siteUrl('/sms-stop').replace(/^https?:\/\//, '')
  return `STOP: ${host}`
}

export function finalMessage(text: string) {
  return `${text.trim()}\n${optOutLine()}`
}

export const SMS_MAX_SEGMENTS = 4

export function checkMessage(text: string) {
  const body = text.trim()
  if (body.length < 5) throw new SmsError('Write the message first.')
  const len = smsLength(finalMessage(body))
  if (len.segments > SMS_MAX_SEGMENTS) {
    throw new SmsError(`That message is ${len.segments} SMS long. Keep it to ${SMS_MAX_SEGMENTS} or fewer.`)
  }
  return len
}

/* ----------------------------------------------------------- campaigns -- */

export async function sendSmsCampaign(args: { text: string; audience: SmsAudience; createdBy: string }) {
  const len = checkMessage(args.text)
  const message = finalMessage(args.text)

  /* A double click, or the same campaign sent twice by two people. */
  const [recent] = await db
    .select({ id: smsCampaigns.id })
    .from(smsCampaigns)
    .where(and(eq(smsCampaigns.message, message), gt(smsCampaigns.createdAt, new Date(Date.now() - 10 * 60_000))))
    .limit(1)
  if (recent) throw new SmsError('This exact message was sent in the last 10 minutes. Change it to send it again.')

  const phones = await audiencePhones(args.audience)
  if (phones.length === 0) throw new SmsError('Nobody in that audience has said yes to SMS offers yet.')

  const [campaign] = await db
    .insert(smsCampaigns)
    .values({
      message,
      audience: args.audience,
      senderId: SMS_SENDER_ID,
      segments: len.segments,
      recipientCount: phones.length,
      status: 'SENDING',
      createdBy: args.createdBy,
    })
    .returning()

  let sent = 0
  let failed = 0
  let logged = false
  const refs: string[] = []
  const errors: string[] = []
  for (let i = 0; i < phones.length; i += SMS_BATCH) {
    const batch = phones.slice(i, i + SMS_BATCH)
    const r = await sendSms(batch, message)
    if (r.ok) {
      sent += batch.length
      if (r.ref) refs.push(r.ref)
      if (r.logged) logged = true
    } else {
      failed += batch.length
      errors.push(r.error)
    }
  }

  const status = logged ? 'LOGGED' : failed === 0 ? 'SENT' : sent === 0 ? 'FAILED' : 'PARTIAL'
  const [done] = await db
    .update(smsCampaigns)
    .set({
      sentCount: sent,
      failedCount: failed,
      status,
      providerRefs: refs.length ? refs : null,
      error: errors.length ? errors.join('\n').slice(0, 2000) : null,
      finishedAt: new Date(),
    })
    .where(eq(smsCampaigns.id, campaign.id))
    .returning()
  return done
}

export async function listSmsCampaigns(limit = 30) {
  return db.select().from(smsCampaigns).orderBy(desc(smsCampaigns.createdAt)).limit(limit)
}
