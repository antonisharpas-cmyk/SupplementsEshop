/* ============================================================================
 * "Get new arrivals" — the mailing list.
 *
 * The rules, all enforced here rather than by the form:
 *
 *   1. Nobody is on the list without saying yes. The sign-up form has an
 *      unticked consent box; an unticked box is refused by the server.
 *   2. Saying yes is not enough on its own: the address has to be confirmed
 *      by clicking a link sent to it (double opt-in). Until then the person
 *      is PENDING and gets no marketing. Registration is the one exception —
 *      the account's email has just been proven by a one-time code, so a
 *      customer who ticks "email me" there is subscribed straight away.
 *   3. Every marketing email carries an unsubscribe link and the
 *      List-Unsubscribe headers mail clients use for their own button.
 *      Unsubscribing never needs a password or a login.
 *   4. The form's answer never says whether an address is already on the
 *      list — that would let anyone test whose email is.
 *   5. Every yes and no is also written to `marketing_consents`, the
 *      append-only ledger, so "did they agree, and when?" has proof.
 *
 * Links carry signed tokens (HMAC with JWT_SECRET), not ids, so nobody can
 * unsubscribe or confirm someone else by editing a number in a URL.
 * ========================================================================== */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  marketingConsents,
  newsletterCampaigns,
  newsletterSubscribers,
} from '@/db/schema'
import { escapeHtml, htmlLayout, send, siteUrl } from '@/lib/email'
import { categoryPath, listProducts, listProductsByIds, t as tField } from '@/lib/catalog'
import { sendTemplate } from '@/lib/mailer'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { BRAND } from '@/config/brand'

export type Locale = 'en' | 'el' | 'ru'
const LOCALES: Locale[] = ['en', 'el', 'ru']
export const asLocale = (value: string | null | undefined): Locale =>
  LOCALES.includes(value as Locale) ? (value as Locale) : 'en'

/** A confirmation link is good for a week. Unsubscribe links never expire —
 *  a two-year-old email must still let someone leave. */
const CONFIRM_TTL_SECONDS = 7 * 24 * 60 * 60
/** Do not send the same address a second confirmation within two minutes. */
const RESEND_CONFIRMATION_AFTER_MS = 2 * 60 * 1000

export class NewsletterError extends Error {
  constructor(
    message: string,
    readonly code: 'CONSENT_REQUIRED' | 'INVALID_TOKEN' | 'ALREADY_SENDING' | 'NO_RECIPIENTS' | 'NO_TEST_ADDRESS',
  ) {
    super(message)
    this.name = 'NewsletterError'
  }
}

/* ============================================================== tokens == */

function secret(): string {
  const value = process.env.JWT_SECRET
  if (value && value.length >= 16) return value
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set (16+ characters) to sign newsletter links.')
  }
  return 'development-only-newsletter-secret'
}

type TokenBody = { s: string; k: 'c' | 'u'; i: number; e?: number }

function sign(body: TokenBody): string {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  const mac = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${mac}`
}

export function readToken(token: string | null | undefined, kind: 'c' | 'u'): TokenBody | null {
  if (!token || token.length > 400) return null
  const [payload, mac] = token.split('.')
  if (!payload || !mac) return null
  const expected = createHmac('sha256', secret()).update(payload).digest()
  let given: Buffer
  try {
    given = Buffer.from(mac, 'base64url')
  } catch {
    return null
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as TokenBody
    if (body.k !== kind || typeof body.s !== 'string') return null
    if (body.e && body.e * 1000 < Date.now()) return null
    return body
  } catch {
    return null
  }
}

const now = () => Math.floor(Date.now() / 1000)
export const confirmToken = (id: string) => sign({ s: id, k: 'c', i: now(), e: now() + CONFIRM_TTL_SECONDS })
export const unsubscribeToken = (id: string) => sign({ s: id, k: 'u', i: now() })

export const confirmUrl = (id: string, locale: Locale) =>
  siteUrl(`/${locale}/newsletter/confirm?token=${encodeURIComponent(confirmToken(id))}`)
export const unsubscribeUrl = (id: string, locale: Locale) =>
  siteUrl(`/${locale}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken(id))}`)
/** What mail clients POST to for their own one-click "Unsubscribe" button. */
export const oneClickUrl = (id: string) =>
  siteUrl(`/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken(id))}`)

/* =========================================================== subscribe == */

export type SubscribeInput = {
  email: string
  firstName?: string | null
  locale: Locale
  consent: boolean
  source: string
  userId?: string | null
  ipHash?: string | null
}

/**
 * The public sign-up. Always ends the same way for the caller — "check your
 * inbox" — whether the address is new, pending, unsubscribed or already on
 * the list. What differs is only what happens behind it.
 */
export async function subscribe(input: SubscribeInput): Promise<{ id: string; emailed: boolean }> {
  if (input.consent !== true) {
    throw new NewsletterError('Consent is required to join the list.', 'CONSENT_REQUIRED')
  }
  const email = input.email.trim().toLowerCase()
  const firstName = input.firstName?.trim().slice(0, 80) || null

  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(sql`lower(${newsletterSubscribers.email}) = ${email}`)
    .limit(1)

  let id: string
  let lastSent: Date | null = null
  if (!existing) {
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        email,
        firstName,
        locale: input.locale,
        status: 'PENDING',
        source: input.source.slice(0, 40),
        userId: input.userId ?? null,
        consentAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: newsletterSubscribers.id })
    if (!row) return subscribe(input) /* lost a race with a second click — read it back */
    id = row.id
  } else {
    id = existing.id
    lastSent = existing.lastConfirmationSentAt
    await db
      .update(newsletterSubscribers)
      .set({
        /* Already subscribed stays subscribed; anything else waits for the link. */
        status: existing.status === 'SUBSCRIBED' ? 'SUBSCRIBED' : 'PENDING',
        firstName: firstName ?? existing.firstName,
        locale: input.locale,
        consentAt: new Date(),
        userId: existing.userId ?? input.userId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(newsletterSubscribers.id, id))
  }

  await db.insert(marketingConsents).values({
    email,
    userId: input.userId ?? null,
    granted: true,
    source: input.source.slice(0, 40),
    ipHash: input.ipHash ?? null,
  })

  /* A double-click or a bored visitor must not fill someone's inbox. */
  if (lastSent && Date.now() - lastSent.getTime() < RESEND_CONFIRMATION_AFTER_MS) {
    return { id, emailed: false }
  }
  await db
    .update(newsletterSubscribers)
    .set({ lastConfirmationSentAt: new Date() })
    .where(eq(newsletterSubscribers.id, id))
  await sendTemplate('newsletter_confirm', {
    to: email,
    locale: input.locale,
    vars: { customer_name: firstName ?? '', confirm_url: confirmUrl(id, input.locale) },
    relatedId: id,
  })
  return { id, emailed: true }
}

/**
 * From registration, where the address has just been proven by a one-time
 * code. Only ever called when the customer ticked the box.
 */
export async function subscribeVerified(input: {
  email: string
  firstName?: string | null
  locale: Locale
  userId: string
  source: string
  /** Registration sends its own account welcome instead. */
  sendWelcome?: boolean
}): Promise<void> {
  const email = input.email.trim().toLowerCase()
  const at = new Date()
  const [existing] = await db
    .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status, confirmedAt: newsletterSubscribers.confirmedAt })
    .from(newsletterSubscribers)
    .where(sql`lower(${newsletterSubscribers.email}) = ${email}`)
    .limit(1)

  let id: string
  if (existing) {
    if (existing.status === 'SUBSCRIBED') return
    id = existing.id
    await db
      .update(newsletterSubscribers)
      .set({
        status: 'SUBSCRIBED',
        userId: input.userId,
        locale: input.locale,
        firstName: input.firstName ?? undefined,
        consentAt: at,
        confirmedAt: existing.confirmedAt ?? at,
        unsubscribedAt: null,
        updatedAt: at,
      })
      .where(eq(newsletterSubscribers.id, id))
  } else {
    const [row] = await db
      .insert(newsletterSubscribers)
      .values({
        email,
        firstName: input.firstName ?? null,
        locale: input.locale,
        status: 'SUBSCRIBED',
        source: input.source,
        userId: input.userId,
        consentAt: at,
        confirmedAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: newsletterSubscribers.id })
    if (!row) return
    id = row.id
  }
  if (input.sendWelcome !== false) await sendWelcome(id)
}

/** The link in the confirmation email. Returns false for a bad or old link. */
export async function confirmSubscription(token: string | null | undefined): Promise<{ ok: boolean; locale: Locale }> {
  const body = readToken(token, 'c')
  if (!body) return { ok: false, locale: 'en' }
  const [sub] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, body.s)).limit(1)
  if (!sub) return { ok: false, locale: 'en' }
  const locale = asLocale(sub.locale)

  /* An old confirmation link must not undo a later "unsubscribe". */
  if (sub.status === 'UNSUBSCRIBED' && sub.unsubscribedAt && sub.unsubscribedAt.getTime() / 1000 >= body.i) {
    return { ok: false, locale }
  }
  if (sub.status === 'SUBSCRIBED') return { ok: true, locale }

  const [updated] = await db
    .update(newsletterSubscribers)
    .set({
      status: 'SUBSCRIBED',
      confirmedAt: new Date(),
      consentAt: sub.consentAt ?? new Date(),
      unsubscribedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(newsletterSubscribers.id, sub.id), sql`${newsletterSubscribers.status} <> 'SUBSCRIBED'`))
    .returning({ id: newsletterSubscribers.id })
  /* Only the click that actually made the change sends the welcome. */
  if (updated) await sendWelcome(sub.id)
  return { ok: true, locale }
}

/** Unsubscribe by signed link. Idempotent — the second click is a no-op. */
export async function unsubscribe(token: string | null | undefined): Promise<{ ok: boolean; locale: Locale }> {
  const body = readToken(token, 'u')
  if (!body) return { ok: false, locale: 'en' }
  const [sub] = await db
    .update(newsletterSubscribers)
    .set({ status: 'UNSUBSCRIBED', unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(newsletterSubscribers.id, body.s), sql`${newsletterSubscribers.status} <> 'UNSUBSCRIBED'`))
    .returning({ email: newsletterSubscribers.email, userId: newsletterSubscribers.userId, locale: newsletterSubscribers.locale })
  if (sub) {
    await db.insert(marketingConsents).values({ email: sub.email, userId: sub.userId, granted: false, source: 'unsubscribe' })
    return { ok: true, locale: asLocale(sub.locale) }
  }
  const [existing] = await db
    .select({ locale: newsletterSubscribers.locale })
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.id, body.s))
    .limit(1)
  return { ok: Boolean(existing), locale: asLocale(existing?.locale) }
}

/* =============================================================== admin == */

export async function newsletterStats() {
  const [rows, last30] = await Promise.all([
    db
      .select({ status: newsletterSubscribers.status, n: count() })
      .from(newsletterSubscribers)
      .groupBy(newsletterSubscribers.status),
    db
      .select({ n: count() })
      .from(newsletterSubscribers)
      .where(
        and(
          eq(newsletterSubscribers.status, 'SUBSCRIBED'),
          gt(newsletterSubscribers.confirmedAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      ),
  ])
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
  return {
    subscribed: by.SUBSCRIBED ?? 0,
    pending: by.PENDING ?? 0,
    unsubscribed: by.UNSUBSCRIBED ?? 0,
    newLast30Days: Number(last30[0]?.n ?? 0),
  }
}

export const SUBSCRIBERS_PER_PAGE = 50

export async function listSubscribers(opts: { status?: string; q?: string; page?: number }) {
  const where = []
  if (opts.status === 'SUBSCRIBED' || opts.status === 'PENDING' || opts.status === 'UNSUBSCRIBED') {
    where.push(eq(newsletterSubscribers.status, opts.status))
  }
  const q = opts.q?.trim().toLowerCase().slice(0, 120)
  if (q) {
    const pat = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(sql`(lower(${newsletterSubscribers.email}) like ${pat} or lower(coalesce(${newsletterSubscribers.firstName}, '')) like ${pat})`)
  }
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const cond = where.length ? and(...where) : undefined
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(newsletterSubscribers)
      .where(cond)
      .orderBy(desc(newsletterSubscribers.updatedAt))
      .limit(SUBSCRIBERS_PER_PAGE)
      .offset((page - 1) * SUBSCRIBERS_PER_PAGE),
    db.select({ n: count() }).from(newsletterSubscribers).where(cond),
  ])
  const n = Number(total[0]?.n ?? 0)
  return { rows, total: n, page, pages: Math.max(1, Math.ceil(n / SUBSCRIBERS_PER_PAGE)) }
}

export async function listCampaigns(limit = 20) {
  return db.select().from(newsletterCampaigns).orderBy(desc(newsletterCampaigns.createdAt)).limit(limit)
}

/* ========================================================= campaigns == */

export type CampaignKind = 'new_arrivals' | 'promotion'

/**
 * What the owner writes for a mailing. Products: up to six chosen by hand,
 * or those of one category, or — neither — the newest (new arrivals) or the
 * newest reduced (promotion), taken from the live shop at the moment it
 * sends, so an email never advertises something hidden or sold out.
 */
export type CampaignDraft = {
  kind: CampaignKind
  subject: string
  message: string
  productIds?: string[]
  categoryId?: string | null
  /** Only subscribers who chose this language; 'all' = everyone, each in theirs. */
  audience?: 'all' | Locale
  /** The button: its words, and where it goes. */
  ctaLabel?: string
  ctaTarget?: 'new' | 'sale' | 'category' | 'shop'
  /** Shown as its own panel. Both optional. */
  promoCode?: string
  promoExpires?: string
}

/** Everyone who may receive marketing right now: confirmed, consented,
 *  not unsubscribed — and in the chosen language, when one is chosen. */
async function recipients(audience: CampaignDraft['audience'] = 'all', exec: Pick<typeof db, 'select'> = db) {
  return exec
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      firstName: newsletterSubscribers.firstName,
      locale: newsletterSubscribers.locale,
    })
    .from(newsletterSubscribers)
    .where(
      and(
        eq(newsletterSubscribers.status, 'SUBSCRIBED'),
        isNotNull(newsletterSubscribers.confirmedAt),
        isNotNull(newsletterSubscribers.consentAt),
        audience && audience !== 'all' ? eq(newsletterSubscribers.locale, audience) : undefined,
      ),
    )
    .orderBy(newsletterSubscribers.createdAt)
}

export async function audienceSize(audience: CampaignDraft['audience'] = 'all') {
  return (await recipients(audience)).length
}

/** How many people each audience choice reaches — for the composer. */
export async function audienceSizes(): Promise<Record<'all' | Locale, number>> {
  const rows = await recipients('all')
  const out = { all: rows.length, en: 0, el: 0, ru: 0 }
  for (const r of rows) out[asLocale(r.locale)] += 1
  return out
}

/** Products the owner can hand-pick for a mailing: live ones, newest first. */
export async function campaignPickerProducts(limit = 300) {
  const res = await db.execute<{ id: string; name: string; image: string | null; sold_out: boolean }>(sql`
    select p.id, coalesce(p.name->>'en', '') as name,
           (select i.url from product_images i where i.product_id = p.id order by i.position limit 1) as image,
           not exists (
             select 1 from product_variants v join inventory inv on inv.variant_id = v.id
             where v.product_id = p.id and inv.on_hand - inv.reserved > 0
           ) as sold_out
    from products p
    where p.is_active
    order by p.created_at desc
    limit ${limit}`)
  return res.rows.map((r) => ({ id: r.id, name: r.name, image: r.image, soldOut: Boolean(r.sold_out) }))
}

/** A preview to the configured test address only — never one typed in. */
export async function sendTestCampaign(draft: CampaignDraft, locale: Locale = 'en') {
  const { email_test_address } = await getSettings(['email_test_address'])
  if (!email_test_address) {
    throw new NewsletterError('Set a test email address in Marketing & Emails → Settings first.', 'NO_TEST_ADDRESS')
  }
  const products = await campaignProducts(draft, locale)
  const mail = emails.campaign(locale, draft, products, null, '#unsubscribe-preview')
  const result = await send({
    to: email_test_address,
    ...mail,
    subject: `[Test] ${mail.subject}`,
    kind: `newsletter_test_${draft.kind}`,
    category: 'marketing',
  })
  return { to: email_test_address, result }
}

/**
 * Create a mailing: to send now (the caller runs `deliverCampaign` after the
 * response) or at `scheduledAt` (the worker picks it up). Only one campaign
 * sends at a time — a double-click, or two admins pressing Send together,
 * gets a refusal, not two mailings.
 */
export async function startCampaign(draft: CampaignDraft, adminId: string | null, scheduledAt?: Date | null) {
  const later = scheduledAt && scheduledAt.getTime() > Date.now() + 60_000 ? scheduledAt : null
  return db.transaction(async (tx) => {
    /* Serialise starts: whoever takes the lock first wins. */
    await tx.execute(sql`select pg_advisory_xact_lock(4242001)`)
    if (!later) {
      const [running] = await tx
        .select({ id: newsletterCampaigns.id })
        .from(newsletterCampaigns)
        .where(
          and(
            eq(newsletterCampaigns.status, 'SENDING'),
            gt(newsletterCampaigns.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
          ),
        )
        .limit(1)
      if (running) throw new NewsletterError('A mailing is already being sent. Wait for it to finish.', 'ALREADY_SENDING')
    }

    const n = (await recipients(draft.audience, tx)).length
    if (n === 0) throw new NewsletterError('Nobody in this audience has confirmed a subscription yet.', 'NO_RECIPIENTS')

    const [campaign] = await tx
      .insert(newsletterCampaigns)
      .values({
        kind: draft.kind,
        subject: draft.subject,
        createdBy: adminId,
        recipientCount: n,
        status: later ? 'SCHEDULED' : 'SENDING',
        content: draft as unknown as Record<string, unknown>,
        scheduledAt: later,
        startedAt: later ? null : new Date(),
      })
      .returning()
    return campaign
  })
}

export async function cancelCampaign(id: string): Promise<boolean> {
  const [row] = await db
    .update(newsletterCampaigns)
    .set({ status: 'CANCELLED', finishedAt: new Date() })
    .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.status, 'SCHEDULED')))
    .returning({ id: newsletterCampaigns.id })
  return Boolean(row)
}

/** Scheduled campaigns whose time has come. Claimed with one UPDATE, so a
 *  campaign is delivered once however many workers look. */
export async function runDueCampaigns(now = new Date()): Promise<number> {
  const due = await db
    .update(newsletterCampaigns)
    .set({ status: 'SENDING', startedAt: now })
    .where(and(eq(newsletterCampaigns.status, 'SCHEDULED'), sql`${newsletterCampaigns.scheduledAt} <= ${now}`))
    .returning()
  for (const c of due) {
    await deliverCampaign(c.id, (c.content ?? { kind: c.kind, subject: c.subject, message: '' }) as unknown as CampaignDraft)
  }
  return due.length
}

export async function deliverCampaign(campaignId: string, draft: CampaignDraft) {
  let sent = 0
  let failed = 0
  let skipped = 0
  const { recentMarketing } = await import('@/lib/automations')
  try {
    const list = await recipients(draft.audience)
    const productsByLocale = new Map<Locale, CampaignProduct[]>()
    for (const r of list) {
      /* Frequency protection: someone who had a marketing email (a bag
         reminder, another campaign) moments ago is left out of this one. */
      if (await recentMarketing(r.email)) {
        skipped += 1
        continue
      }
      const locale = asLocale(r.locale)
      if (!productsByLocale.has(locale)) productsByLocale.set(locale, await campaignProducts(draft, locale))
      const mail = emails.campaign(locale, draft, productsByLocale.get(locale)!, r.firstName, unsubscribeUrl(r.id, locale))
      const result = await send({
        to: r.email,
        ...mail,
        kind: `newsletter_${draft.kind}`,
        category: 'marketing',
        relatedId: campaignId,
        headers: {
          'List-Unsubscribe': `<${oneClickUrl(r.id)}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      })
      if (result.sent || result.reason === 'NO_PROVIDER') sent += 1
      else failed += 1
      if ((sent + failed) % 25 === 0) {
        await db
          .update(newsletterCampaigns)
          .set({ sentCount: sent, failedCount: failed, skippedCount: skipped })
          .where(eq(newsletterCampaigns.id, campaignId))
      }
    }
  } finally {
    await db
      .update(newsletterCampaigns)
      .set({ sentCount: sent, failedCount: failed, skippedCount: skipped, status: 'SENT', finishedAt: new Date() })
      .where(eq(newsletterCampaigns.id, campaignId))
  }
}

async function sendWelcome(id: string) {
  const [sub] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id)).limit(1)
  if (!sub || sub.status !== 'SUBSCRIBED') return
  const locale = asLocale(sub.locale)
  await sendTemplate('newsletter_welcome', {
    to: sub.email,
    locale,
    vars: { customer_name: sub.firstName ?? '', shop_url: siteUrl(`/${locale}/new`) },
    relatedId: id,
    unsubscribe: { pageUrl: unsubscribeUrl(id, locale), oneClickUrl: oneClickUrl(id) },
  })
}

/* ============================================================== emails == */

type CampaignProduct = { name: string; price: string; wasPrice: string | null; url: string; image: string | null }

async function campaignProducts(draft: CampaignDraft, locale: Locale): Promise<CampaignProduct[]> {
  let items: Awaited<ReturnType<typeof listProducts>>['items']
  if (draft.productIds?.length) {
    items = await listProductsByIds(draft.productIds.slice(0, 6))
    items = items.filter((p) => !p.soldOut)
  } else {
    const path = draft.categoryId ? (await categoryPath(draft.categoryId))?.split('/') : undefined
    items = (
      await listProducts({
        sort: 'newest',
        page: 1,
        perPage: 6,
        locale,
        category: path?.[0],
        subcategory: path?.[1],
        leaf: path?.[2],
        onSale: draft.kind === 'promotion' && !draft.categoryId ? true : undefined,
        inStockOnly: true,
      })
    ).items
  }
  return items.map((p) => ({
    name: tField(p.name, locale),
    price: formatMoney(p.finalCents, locale),
    wasPrice: p.finalCents < p.listCents ? formatMoney(p.listCents, locale) : null,
    url: siteUrl(`/${locale}/products/${p.slug}`),
    image: p.images[0]?.url ? siteUrl(p.images[0].url) : null,
  }))
}


/* Campaign words around what the owner wrote. The automated emails' words
   live in email-templates.ts; a campaign's are typed fresh each time. */
const COPY = {
  en: {
    hi: (n: string | null) => (n ? `Hi ${n},` : 'Hi,'),
    shopNew: 'See what’s new',
    shopSale: 'Shop the offers',
    shop: 'Shop now',
    code: 'Use code',
    until: 'Valid until',
    why: 'You’re receiving this because you subscribed to new-arrival emails.',
    unsubscribe: 'Unsubscribe',
  },
  el: {
    hi: (n: string | null) => (n ? `Γεια σου ${n},` : 'Γεια σου,'),
    shopNew: 'Δες τι νέο υπάρχει',
    shopSale: 'Δες τις προσφορές',
    shop: 'Αγόρασε τώρα',
    code: 'Κωδικός',
    until: 'Ισχύει έως',
    why: 'Λαμβάνεις αυτό το email επειδή εγγράφηκες για ενημερώσεις νέων αφίξεων.',
    unsubscribe: 'Διαγραφή',
  },
  ru: {
    hi: (n: string | null) => (n ? `Здравствуйте, ${n}!` : 'Здравствуйте!'),
    shopNew: 'Смотреть новинки',
    shopSale: 'Смотреть предложения',
    shop: 'За покупками',
    code: 'Промокод',
    until: 'Действует до',
    why: 'Вы получили это письмо, потому что подписались на новости о новинках.',
    unsubscribe: 'Отписаться',
  },
} satisfies Record<Locale, unknown>

const buttonHtml = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.theme.accent};color:${BRAND.theme.accentInk};font-weight:700;text-decoration:none;padding:13px 22px;font-size:13px;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(label)}</a></p>`

const unsubscribeFooter = (locale: Locale, url: string) =>
  `<br>${escapeHtml(COPY[locale].why)} <a href="${escapeHtml(url)}" style="color:#6b6b6b">${escapeHtml(COPY[locale].unsubscribe)}</a>`

const paragraphs = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')

export const emails = {
  /** New arrivals or a promotion. The owner's words are escaped like any
   *  other text; products come from the live catalogue at send time. */
  campaign(locale: Locale, draft: CampaignDraft, products: CampaignProduct[], firstName: string | null, unsubscribe: string) {
    const c = COPY[locale]
    const target = draft.ctaTarget ?? (draft.kind === 'promotion' ? 'sale' : 'new')
    const shop = siteUrl(`/${locale}${target === 'new' ? '/new' : target === 'sale' ? '/sale' : ''}`)
    const label = draft.ctaLabel?.trim() || (target === 'sale' ? c.shopSale : target === 'new' ? c.shopNew : c.shop)
    const grid = products.map(
      (p) =>
        `<td style="width:50%;padding:6px;vertical-align:top"><a href="${escapeHtml(p.url)}" style="color:#111;text-decoration:none">${
          p.image ? `<img src="${escapeHtml(p.image)}" alt="" width="240" style="display:block;width:100%;height:auto;background:#f2f2f0">` : ''
        }<span style="display:block;margin-top:8px;font-size:14px">${escapeHtml(p.name)}</span><span style="font-size:13px">${escapeHtml(p.price)}${
          p.wasPrice ? ` <s style="color:#6b6b6b">${escapeHtml(p.wasPrice)}</s>` : ''
        }</span></a></td>`,
    )
    const rows: string[] = []
    for (let i = 0; i < grid.length; i += 2) rows.push(`<tr>${grid[i]}${grid[i + 1] ?? '<td></td>'}</tr>`)
    const promo = draft.promoCode?.trim()
    const promoHtml = promo
      ? `<div style="margin:6px 0 18px;padding:14px 16px;border:1px dashed #111;text-align:center"><span style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b">${escapeHtml(c.code)}</span><br><strong style="font-size:20px;letter-spacing:.14em">${escapeHtml(promo)}</strong>${
          draft.promoExpires ? `<br><span style="font-size:12px;color:#6b6b6b">${escapeHtml(c.until)} ${escapeHtml(draft.promoExpires)}</span>` : ''
        }</div>`
      : ''
    return {
      subject: draft.subject,
      text:
        `${c.hi(firstName)}\n\n${draft.message}\n\n` +
        (promo ? `${c.code}: ${promo}${draft.promoExpires ? ` (${c.until} ${draft.promoExpires})` : ''}\n\n` : '') +
        products.map((p) => `${p.name}, ${p.price}${p.wasPrice ? ` (was ${p.wasPrice})` : ''}\n${p.url}`).join('\n\n') +
        `\n\n${label}: ${shop}\n\n—\n${c.why}\n${c.unsubscribe}: ${unsubscribe}`,
      html: htmlLayout(
        `<p style="margin:0 0 14px">${escapeHtml(c.hi(firstName))}</p>${paragraphs(draft.message)}${promoHtml}${
          rows.length ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:10px 0">${rows.join('')}</table>` : ''
        }${buttonHtml(shop, label)}`,
        unsubscribeFooter(locale, unsubscribe),
      ),
    }
  },
}
