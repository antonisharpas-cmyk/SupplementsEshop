/* ============================================================================
 * Customer Service — live conversations between shoppers and staff.
 *
 * What it is on screen: "AIONIX Customer Service". Real people answer. It is
 * never called a bot, an assistant or AI, and nothing here pretends a person
 * replied when none did.
 *
 * The rules, all enforced in this file:
 *
 *   OWNERSHIP  A conversation belongs to the account that started it, or —
 *              for a guest — to a random token in an http-only cookie, of
 *              which only a SHA-256 hash is stored. Every customer-side read
 *              and write checks it. A conversation id alone opens nothing.
 *   CREATION   Only on an explicit first message. Opening the chat panel
 *              creates nothing. A customer with an open conversation who
 *              "starts" again is added to the one they have.
 *   ACTIVITY   `last_activity_at` moves on every message, from either side,
 *              and on nothing else. After `support_idle_minutes` (Settings,
 *              default 10) without a message the conversation closes itself.
 *              Measured from the last message — not from when it opened.
 *   CLOSING    Staff or inactivity. One UPDATE … WHERE status = 'OPEN'
 *              decides who closed it, so a staff close and the timer racing
 *              each other produce one close and one transcript email.
 *              Nothing is deleted; the customer can start a new one.
 *   EMAIL      Staff are emailed once per new conversation. The customer is
 *              emailed the transcript once, on close, if they gave an address.
 *              Every customer-written value is escaped before it is put into
 *              HTML. Staff names never reach the customer.
 * ========================================================================== */

import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { supportConversations, supportMessages } from '@/db/schema'
import { BRAND } from '@/config/brand'
import { siteUrl } from '@/lib/email'
import { asEmailLocale, sendTemplate } from '@/lib/mailer'
import { getSettings } from '@/lib/settings'

export const MESSAGE_MAX = 2000
export const SUPPORT_COOKIE = 'sf_support'
export const SUPPORT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
/** How long a closed conversation keeps showing in the panel (with its
 *  "start a new one" button) before the panel goes back to empty. */
const SHOW_CLOSED_FOR_MS = 24 * 60 * 60 * 1000

export const SERVICE_NAME = `${BRAND.name} Customer Service`

export class SupportError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'CLOSED' | 'EMPTY' | 'TOO_LONG' | 'INVALID_EMAIL' | 'NAME_REQUIRED' | 'EMAIL_REQUIRED',
  ) {
    super(message)
    this.name = 'SupportError'
  }
}

/** Who is asking, on the customer side. Either may be missing. */
export type SupportActor = { userId: string | null; guestToken: string | null }

export const hashGuestToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newGuestToken = () => randomBytes(32).toString('base64url')

/** Trim, collapse runs of blank lines, strip control characters (keeping
 *  newlines and tabs), and refuse empty or oversized text. Stored as typed —
 *  it is escaped wherever it is displayed. */
export function cleanMessage(body: unknown): string {
  if (typeof body !== 'string') throw new SupportError('Write a message first.', 'EMPTY')
   
  const text = body.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (!text) throw new SupportError('Write a message first.', 'EMPTY')
  if (text.length > MESSAGE_MAX) throw new SupportError(`Keep it under ${MESSAGE_MAX} characters.`, 'TOO_LONG')
  return text
}

async function idleMinutes(): Promise<number> {
  const s = await getSettings(['support_idle_minutes'])
  return s.support_idle_minutes
}

/* ======================================================= customer side == */

function ownedBy(actor: SupportActor) {
  const parts = []
  if (actor.userId) parts.push(eq(supportConversations.userId, actor.userId))
  if (actor.guestToken) parts.push(eq(supportConversations.guestTokenHash, hashGuestToken(actor.guestToken)))
  return parts.length ? or(...parts)! : sql`false`
}

export type CustomerMessage = { id: string; sender: 'CUSTOMER' | 'STAFF'; body: string; createdAt: string; automated?: boolean }
export type CustomerView = {
  conversation: {
    id: string
    status: 'OPEN' | 'CLOSED'
    closedReason: 'STAFF' | 'INACTIVITY' | null
    closedAt: string | null
    email: string | null
    /** The newest customer message staff have read, for "Seen". */
    staffLastReadAt: string | null
  } | null
  messages: CustomerMessage[]
  idleMinutes: number
}

/** What the panel shows: the open conversation, or the one that just closed. */
export async function customerView(actor: SupportActor, opts: { after?: Date; markRead?: boolean } = {}): Promise<CustomerView> {
  const minutes = await idleMinutes()
  if (!actor.userId && !actor.guestToken) return { conversation: null, messages: [], idleMinutes: minutes }

  const [conv] = await db
    .select()
    .from(supportConversations)
    .where(ownedBy(actor))
    .orderBy(sql`(${supportConversations.status} = 'OPEN') desc`, desc(supportConversations.lastActivityAt))
    .limit(1)
  if (!conv) return { conversation: null, messages: [], idleMinutes: minutes }

  let current = conv
  if (conv.status === 'OPEN' && conv.lastActivityAt.getTime() < Date.now() - minutes * 60_000) {
    /* The timer may not have run yet; the rule does not wait for it. */
    await closeConversation(conv.id, { reason: 'INACTIVITY' })
    const [again] = await db.select().from(supportConversations).where(eq(supportConversations.id, conv.id)).limit(1)
    current = again ?? conv
  }
  if (current.status === 'CLOSED' && (current.closedAt?.getTime() ?? 0) < Date.now() - SHOW_CLOSED_FOR_MS) {
    return { conversation: null, messages: [], idleMinutes: minutes }
  }

  const messages = await db
    .select({
      id: supportMessages.id,
      sender: supportMessages.sender,
      body: supportMessages.body,
      automated: supportMessages.automated,
      createdAt: supportMessages.createdAt,
    })
    .from(supportMessages)
    .where(
      and(
        eq(supportMessages.conversationId, current.id),
        opts.after ? gt(supportMessages.createdAt, opts.after) : undefined,
      ),
    )
    .orderBy(asc(supportMessages.createdAt))
    .limit(500)

  if (opts.markRead) {
    await db.update(supportConversations).set({ customerLastReadAt: new Date() }).where(eq(supportConversations.id, current.id))
  }

  return {
    idleMinutes: minutes,
    conversation: {
      id: current.id,
      status: current.status,
      closedReason: current.closedReason,
      closedAt: current.closedAt?.toISOString() ?? null,
      email: current.email,
      staffLastReadAt: current.staffLastReadAt?.toISOString() ?? null,
    },
    /* staffUserId is deliberately not selected: who replied stays internal. */
    messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  }
}

/**
 * The first message. Creates the conversation — unless this customer already
 * has one open, in which case the message simply joins it.
 */
export async function startConversation(
  actor: SupportActor,
  input: { name?: string | null; email?: string | null; message: unknown; locale: string; pageUrl?: string | null },
): Promise<{ conversationId: string; created: boolean }> {
  const body = cleanMessage(input.message)
  if (!actor.userId && !actor.guestToken) throw new SupportError('No conversation owner.', 'NOT_FOUND')

  const email = input.email?.trim().toLowerCase() || null
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255)) {
    throw new SupportError('That email address does not look right.', 'INVALID_EMAIL')
  }

  const [open] = await db
    .select({ id: supportConversations.id })
    .from(supportConversations)
    .where(and(ownedBy(actor), eq(supportConversations.status, 'OPEN')))
    .limit(1)
  if (open) {
    await postCustomerMessage(actor, open.id, body)
    return { conversationId: open.id, created: false }
  }

  /* A guest gives a name and an email — the email is where the transcript
     goes. A signed-in customer's come from the account (the route passes
     them), so they are never asked. No account is needed to ask a question. */
  const name = input.name?.trim().slice(0, 120) || null
  if (!actor.userId) {
    if (!name) throw new SupportError('Tell us your name.', 'NAME_REQUIRED')
    if (!email) throw new SupportError('Tell us your email, so we can send you a copy.', 'EMAIL_REQUIRED')
  }

  const now = new Date()
  const conversationId = await db.transaction(async (tx) => {
    const [conv] = await tx
      .insert(supportConversations)
      .values({
        userId: actor.userId,
        guestTokenHash: actor.guestToken ? hashGuestToken(actor.guestToken) : null,
        name,
        email,
        locale: ['en', 'el', 'ru'].includes(input.locale) ? input.locale : 'en',
        pageUrl: sanitisePageUrl(input.pageUrl),
        status: 'OPEN',
        openedAt: now,
        lastActivityAt: now,
        customerLastReadAt: now,
      })
      .returning({ id: supportConversations.id })
    await tx.insert(supportMessages).values({ conversationId: conv.id, sender: 'CUSTOMER', body, createdAt: now })
    return conv.id
  })

  await autoReply(conversationId, input.locale, now)
  await notifyStaffOnce(conversationId)
  return { conversationId, created: true }
}

/**
 * The automatic first reply ("Hello! Thank you for contacting AIONIX
 * Customer Service…"), right after the first message — words and on/off in
 * Admin → Customer Service. It is marked `automated`, so staff can tell it
 * from a person's reply, and it does not count as staff having read the
 * message. It does not reset the inactivity timer beyond the first message's.
 */
async function autoReply(conversationId: string, locale: string, after: Date) {
  const s = await getSettings([
    'support_auto_reply_enabled',
    'support_auto_reply_en',
    'support_auto_reply_el',
    'support_auto_reply_ru',
  ])
  if (!s.support_auto_reply_enabled) return
  const text =
    (locale === 'el' ? s.support_auto_reply_el : locale === 'ru' ? s.support_auto_reply_ru : '').trim() ||
    s.support_auto_reply_en.trim()
  if (!text) return
  await db.insert(supportMessages).values({
    conversationId,
    sender: 'STAFF',
    staffUserId: null,
    automated: true,
    body: text.slice(0, MESSAGE_MAX),
    /* A moment after the customer's message, so it always reads as the answer. */
    createdAt: new Date(after.getTime() + 1),
  })
}

/** Only a path on this site is kept — never someone else's URL. */
function sanitisePageUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value, 'http://x')
    return url.pathname.startsWith('/') ? `${url.pathname}${url.search}`.slice(0, 500) : null
  } catch {
    return null
  }
}

export async function postCustomerMessage(actor: SupportActor, conversationId: string, message: unknown) {
  const body = cleanMessage(message)
  const [conv] = await db
    .select()
    .from(supportConversations)
    .where(and(eq(supportConversations.id, conversationId), ownedBy(actor)))
    .limit(1)
  /* Not theirs and not existing look the same from outside. */
  if (!conv) throw new SupportError('Conversation not found.', 'NOT_FOUND')
  if (conv.status !== 'OPEN') throw new SupportError('This conversation has ended.', 'CLOSED')

  const minutes = await idleMinutes()
  if (conv.lastActivityAt.getTime() < Date.now() - minutes * 60_000) {
    /* Past the idle limit, a new message does not revive it. */
    await closeConversation(conv.id, { reason: 'INACTIVITY' })
    throw new SupportError('This conversation has ended.', 'CLOSED')
  }
  return appendMessage(conv.id, 'CUSTOMER', body, null)
}

async function appendMessage(conversationId: string, sender: 'CUSTOMER' | 'STAFF', body: string, staffUserId: string | null) {
  return db.transaction(async (tx) => {
    const now = new Date()
    /* Lock the row and re-check it is open, so a message cannot land in a
       conversation that closed a millisecond earlier. */
    const [conv] = await tx
      .select({ status: supportConversations.status })
      .from(supportConversations)
      .where(eq(supportConversations.id, conversationId))
      .for('update')
    if (!conv || conv.status !== 'OPEN') throw new SupportError('This conversation has ended.', 'CLOSED')
    const [msg] = await tx
      .insert(supportMessages)
      .values({ conversationId, sender, body, staffUserId, createdAt: now })
      .returning({ id: supportMessages.id, createdAt: supportMessages.createdAt })
    await tx
      .update(supportConversations)
      .set({
        lastActivityAt: now,
        updatedAt: now,
        /* Writing a message means you have read everything before it. */
        ...(sender === 'STAFF' ? { staffLastReadAt: now } : { customerLastReadAt: now }),
      })
      .where(eq(supportConversations.id, conversationId))
    return { id: msg.id, createdAt: msg.createdAt.toISOString() }
  })
}

/* ========================================================== staff side == */

export type InboxRow = {
  id: string
  name: string | null
  email: string | null
  status: 'OPEN' | 'CLOSED'
  openedAt: string
  lastActivityAt: string
  closedAt: string | null
  closedReason: 'STAFF' | 'INACTIVITY' | null
  lastMessage: string
  lastSender: 'CUSTOMER' | 'STAFF' | null
  lastAutomated: boolean
  unread: number
  signedIn: boolean
}

export const INBOX_PAGE = 50

export async function listInbox(opts: { status: 'OPEN' | 'CLOSED' | 'ALL'; q?: string; page?: number }) {
  await sweepIdleConversations()
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const q = opts.q?.trim().toLowerCase().slice(0, 120)
  const pat = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const res = await db.execute<{
    id: string
    name: string | null
    email: string | null
    status: 'OPEN' | 'CLOSED'
    opened_at: Date
    last_activity_at: Date
    closed_at: Date | null
    closed_reason: 'STAFF' | 'INACTIVITY' | null
    user_id: string | null
    last_body: string | null
    last_sender: 'CUSTOMER' | 'STAFF' | null
    last_automated: boolean | null
    unread: number
    total: number
  }>(sql`
    select c.id, c.name, c.email, c.status, c.opened_at, c.last_activity_at, c.closed_at, c.closed_reason, c.user_id,
           lm.body as last_body, lm.sender as last_sender, lm.automated as last_automated,
           (select count(*)::int from support_messages m
              where m.conversation_id = c.id and m.sender = 'CUSTOMER'
                and m.created_at > coalesce(c.staff_last_read_at, 'epoch'::timestamptz)) as unread,
           count(*) over ()::int as total
    from support_conversations c
    left join lateral (
      select body, sender, automated from support_messages m where m.conversation_id = c.id
      order by m.created_at desc limit 1
    ) lm on true
    where ${opts.status === 'ALL' ? sql`true` : sql`c.status = ${opts.status}`}
      ${pat ? sql`and (lower(coalesce(c.name,'')) like ${pat} or lower(coalesce(c.email,'')) like ${pat}
                  or exists (select 1 from support_messages sm where sm.conversation_id = c.id and lower(sm.body) like ${pat}))` : sql``}
    order by c.last_activity_at desc
    limit ${INBOX_PAGE} offset ${(page - 1) * INBOX_PAGE}
  `)
  const total = Number(res.rows[0]?.total ?? 0)
  const rows: InboxRow[] = res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    status: r.status,
    openedAt: new Date(r.opened_at).toISOString(),
    lastActivityAt: new Date(r.last_activity_at).toISOString(),
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    closedReason: r.closed_reason,
    lastMessage: (r.last_body ?? '').slice(0, 160),
    lastSender: r.last_sender,
    lastAutomated: Boolean(r.last_automated),
    unread: Number(r.unread),
    signedIn: Boolean(r.user_id),
  }))
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / INBOX_PAGE)) }
}

/** For the admin nav badge and the overview. */
export async function inboxCounts(): Promise<{ open: number; unread: number }> {
  const res = await db.execute<{ open: number; unread: number }>(sql`
    select count(*)::int as open,
           count(*) filter (where exists (
             select 1 from support_messages m where m.conversation_id = c.id and m.sender = 'CUSTOMER'
               and m.created_at > coalesce(c.staff_last_read_at, 'epoch'::timestamptz)))::int as unread
    from support_conversations c where c.status = 'OPEN'`)
  return { open: Number(res.rows[0]?.open ?? 0), unread: Number(res.rows[0]?.unread ?? 0) }
}

export async function staffThread(id: string, opts: { markRead?: boolean } = {}) {
  const [conv] = await db.select().from(supportConversations).where(eq(supportConversations.id, id)).limit(1)
  if (!conv) return null
  if (conv.status === 'OPEN' && conv.lastActivityAt.getTime() < Date.now() - (await idleMinutes()) * 60_000) {
    await closeConversation(conv.id, { reason: 'INACTIVITY' })
    return staffThread(id, opts)
  }
  const messages = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.conversationId, id))
    .orderBy(asc(supportMessages.createdAt))
    .limit(1000)
  if (opts.markRead) {
    await db.update(supportConversations).set({ staffLastReadAt: new Date() }).where(eq(supportConversations.id, id))
  }
  return {
    conversation: {
      id: conv.id,
      name: conv.name,
      email: conv.email,
      status: conv.status,
      signedIn: Boolean(conv.userId),
      locale: conv.locale,
      pageUrl: conv.pageUrl,
      openedAt: conv.openedAt.toISOString(),
      lastActivityAt: conv.lastActivityAt.toISOString(),
      closedAt: conv.closedAt?.toISOString() ?? null,
      closedReason: conv.closedReason,
      customerLastReadAt: conv.customerLastReadAt?.toISOString() ?? null,
      transcriptSentAt: conv.transcriptSentAt?.toISOString() ?? null,
    },
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      body: m.body,
      automated: m.automated,
      createdAt: m.createdAt.toISOString(),
    })),
    idleMinutes: await idleMinutes(),
  }
}

export async function staffReply(conversationId: string, staffUserId: string, message: unknown) {
  const body = cleanMessage(message)
  const [conv] = await db
    .select({ status: supportConversations.status })
    .from(supportConversations)
    .where(eq(supportConversations.id, conversationId))
    .limit(1)
  if (!conv) throw new SupportError('Conversation not found.', 'NOT_FOUND')
  return appendMessage(conversationId, 'STAFF', body, staffUserId)
}

/**
 * Close it. Exactly one caller wins the UPDATE; only the winner sends the
 * transcript, and the transcript is marked sent so it can never go twice.
 */
export async function closeConversation(
  id: string,
  by: { reason: 'STAFF'; staffUserId: string } | { reason: 'INACTIVITY' },
): Promise<boolean> {
  const now = new Date()
  const [closed] = await db
    .update(supportConversations)
    .set({
      status: 'CLOSED',
      closedAt: now,
      closedReason: by.reason,
      closedBy: by.reason === 'STAFF' ? by.staffUserId : null,
      updatedAt: now,
    })
    .where(and(eq(supportConversations.id, id), eq(supportConversations.status, 'OPEN')))
    .returning({ id: supportConversations.id })
  if (!closed) return false
  await sendTranscriptOnce(id).catch((err) => console.error('[support] transcript failed', err))
  return true
}

/** Close every conversation quiet for longer than the setting. Run by the
 *  timer in instrumentation.ts, by the cron route, and before inbox reads. */
export async function sweepIdleConversations(now = new Date()): Promise<number> {
  const minutes = await idleMinutes()
  const stale = await db
    .select({ id: supportConversations.id })
    .from(supportConversations)
    .where(
      and(
        eq(supportConversations.status, 'OPEN'),
        lt(supportConversations.lastActivityAt, new Date(now.getTime() - minutes * 60_000)),
      ),
    )
    .limit(200)
  let n = 0
  for (const row of stale) if (await closeConversation(row.id, { reason: 'INACTIVITY' })) n += 1
  return n
}

/* ============================================================== emails == */

const fmt = (d: Date, locale = 'en') =>
  d.toLocaleString(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Nicosia',
  })

async function notifyStaffOnce(conversationId: string) {
  /* The WHERE makes this once-only even if two requests reach here. */
  const [conv] = await db
    .update(supportConversations)
    .set({ notifiedAt: new Date() })
    .where(and(eq(supportConversations.id, conversationId), isNull(supportConversations.notifiedAt)))
    .returning()
  if (!conv) return
  const [first] = await db
    .select({ body: supportMessages.body })
    .from(supportMessages)
    .where(and(eq(supportMessages.conversationId, conversationId), eq(supportMessages.sender, 'CUSTOMER')))
    .orderBy(asc(supportMessages.createdAt))
    .limit(1)

  const settings = await getSettings(['support_email'])
  await sendTemplate('support_new', {
    to: settings.support_email || BRAND.contact.email,
    locale: 'en',
    replyTo: conv.email ?? undefined,
    relatedId: conversationId,
    vars: {
      customer_name: conv.name ?? 'Not given',
      customer_email: `${conv.email ?? 'Not given'}${conv.userId ? ' (signed in)' : ' (guest)'}`,
      started_at: fmt(conv.openedAt),
      page: conv.pageUrl ?? '',
      message: first?.body ?? '',
      admin_url: siteUrl(`/admin/support?c=${conversationId}`),
    },
  })
}

const YOU: Record<'en' | 'el' | 'ru', string> = { en: 'You', el: 'Εσύ', ru: 'Вы' }

async function sendTranscriptOnce(conversationId: string) {
  const [conv] = await db
    .update(supportConversations)
    .set({ transcriptSentAt: new Date() })
    .where(
      and(
        eq(supportConversations.id, conversationId),
        isNull(supportConversations.transcriptSentAt),
        sql`${supportConversations.email} is not null`,
      ),
    )
    .returning()
  if (!conv?.email) return

  const messages = await db
    .select({ sender: supportMessages.sender, body: supportMessages.body, createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.conversationId, conversationId))
    .orderBy(asc(supportMessages.createdAt))
  if (!messages.length) return

  const locale = asEmailLocale(conv.locale)
  await sendTemplate('support_transcript', {
    to: conv.email,
    locale,
    relatedId: conversationId,
    vars: {
      customer_name: conv.name ?? '',
      conversation_date: fmt(conv.openedAt, locale),
      /* Sender labels are "You" and the service name — never a staff member. */
      transcript: messages.map((m) => ({
        from: m.sender === 'CUSTOMER' ? YOU[locale] : SERVICE_NAME,
        at: fmt(m.createdAt, locale),
        text: m.body,
        customer: m.sender === 'CUSTOMER',
      })),
    },
  })
}

/* Exported for tests and the overview. */
export async function conversationCount(status: 'OPEN' | 'CLOSED') {
  const [r] = await db.select({ n: count() }).from(supportConversations).where(eq(supportConversations.status, status))
  return Number(r?.n ?? 0)
}
