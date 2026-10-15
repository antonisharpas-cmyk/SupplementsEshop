/* Customer Service: who may start one, the automatic first reply,
   ownership, the inactivity close, and the two emails. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { supportConversations, supportMessages, users } from '@/db/schema'
import type { EmailMessage } from '@/lib/email'

const sent: EmailMessage[] = []
vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>()
  return { ...real, send: vi.fn(async (m: EmailMessage) => (sent.push(m), { sent: true as const })) }
})

const s = await import('../support')

const guestA = { userId: null, guestToken: s.newGuestToken() }
const guestB = { userId: null, guestToken: s.newGuestToken() }
let staffId: string

beforeEach(async () => {
  await db.execute(sql`truncate table support_messages, support_conversations restart identity cascade`)
  await db
    .execute(sql`delete from settings where key in ('support_idle_minutes', 'support_email') or key like 'support_auto_reply%'`)
    .catch(() => {})
  ;(await import('../settings')).invalidateSettingsCache()
  sent.length = 0
  const [staff] = await db
    .insert(users)
    .values({ email: `staff-${Date.now()}@example.com`, passwordHash: 'x', firstName: 'Nikos', lastName: 'Staff', phone: `+3579${Date.now() % 10_000_000}`, role: 'ADMIN' })
    .returning({ id: users.id })
  staffId = staff.id
})

afterAll(async () => {
  await pool.end()
})

/** A guest's first message: a guest always gives a name and an email. */
const G = { name: 'Maria', email: 'maria@example.com', locale: 'en' }
const customerBodies = async () =>
  (await db.select().from(supportMessages).where(eq(supportMessages.sender, 'CUSTOMER'))).map((m) => m.body)

/** Pretend the last message was `minutes` ago. */
const age = (id: string, minutes: number) =>
  db
    .update(supportConversations)
    .set({ lastActivityAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(supportConversations.id, id))

describe('starting', () => {
  it('opening the panel creates nothing', async () => {
    expect((await s.customerView(guestA)).conversation).toBeNull()
    expect(await db.select().from(supportConversations)).toHaveLength(0)
  })

  it('the first message creates one conversation and emails staff once', async () => {
    const { conversationId, created } = await s.startConversation(guestA, { name: 'Maria', email: 'maria@example.com', message: 'Hello', locale: 'en' })
    expect(created).toBe(true)
    /* "Starting" again with one open adds to it. */
    const again = await s.startConversation(guestA, { message: 'Still there?', locale: 'en' })
    expect(again).toEqual({ conversationId, created: false })
    expect(await db.select().from(supportConversations)).toHaveLength(1)

    const staffMail = sent.filter((m) => m.kind === 'support_new')
    expect(staffMail).toHaveLength(1)
    expect(staffMail[0].subject).toBe('New customer support conversation')
    expect(staffMail[0].text).toContain('Maria')
    expect(staffMail[0].text).toContain('maria@example.com')
    expect(staffMail[0].text).toContain('Hello')
    expect(staffMail[0].text).toContain(`/admin/support?c=${conversationId}`)
  })

  it('escapes customer text in the staff email', async () => {
    await s.startConversation(guestA, { ...G, name: '<b>x</b>', message: '<script>alert(1)</script>' })
    const html = sent.find((m) => m.kind === 'support_new')!.html!
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('refuses empty, oversized and badly addressed messages', async () => {
    await expect(s.startConversation(guestA, { message: '   ', locale: 'en' })).rejects.toMatchObject({ code: 'EMPTY' })
    await expect(s.startConversation(guestA, { message: 'x'.repeat(2001), locale: 'en' })).rejects.toMatchObject({ code: 'TOO_LONG' })
    await expect(s.startConversation(guestA, { ...G, message: 'hi', email: 'not-an-email' })).rejects.toMatchObject({ code: 'INVALID_EMAIL' })
  })

  it('a guest must give a name and an email — no account needed', async () => {
    await expect(s.startConversation(guestA, { email: 'maria@example.com', message: 'hi', locale: 'en' })).rejects.toMatchObject({
      code: 'NAME_REQUIRED',
    })
    await expect(s.startConversation(guestA, { name: 'Maria', message: 'hi', locale: 'en' })).rejects.toMatchObject({
      code: 'EMAIL_REQUIRED',
    })
    expect(await db.select().from(supportConversations)).toHaveLength(0)
    const ok = await s.startConversation(guestA, { ...G, message: 'hi' })
    expect(ok.created).toBe(true)
  })

  it('a signed-in customer is not asked — the account is the owner', async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `c-${Date.now()}@example.com`, passwordHash: 'x', firstName: 'Eva', lastName: 'K', phone: `+3579${(Date.now() + 1) % 10_000_000}` })
      .returning({ id: users.id })
    const me = { userId: u.id, guestToken: null }
    const { created } = await s.startConversation(me, { message: 'Where is my order?', locale: 'en' })
    expect(created).toBe(true)
    const [row] = await db.select().from(supportConversations)
    expect(row.userId).toBe(u.id)
    expect((await s.customerView(me)).conversation).not.toBeNull()
    expect((await s.customerView(guestA)).conversation).toBeNull()
    expect((await s.listInbox({ status: 'OPEN' })).rows[0].signedIn).toBe(true)
  })
})

describe('the automatic first reply', () => {
  it('answers the first message at once, marked as automatic', async () => {
    await s.startConversation(guestA, { ...G, message: 'Hello' })
    const view = await s.customerView(guestA)
    expect(view.messages).toHaveLength(2)
    expect(view.messages[0]).toMatchObject({ sender: 'CUSTOMER', body: 'Hello' })
    expect(view.messages[1]).toMatchObject({
      sender: 'STAFF',
      automated: true,
      body: 'Hello! Thank you for contacting AIONIX Customer Service. Someone from our team will reply as soon as possible.',
    })
    /* Staff can tell it from a person's reply, and it is not "read". */
    const list = await s.listInbox({ status: 'OPEN' })
    expect(list.rows[0]).toMatchObject({ lastSender: 'STAFF', lastAutomated: true, unread: 1 })
  })

  it('is sent once — not for later messages', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'one' })
    await s.postCustomerMessage(guestA, conversationId, 'two')
    await s.startConversation(guestA, { ...G, message: 'three' })
    const auto = (await db.select().from(supportMessages)).filter((m) => m.automated)
    expect(auto).toHaveLength(1)
  })

  it('speaks the customer’s language, and falls back to English', async () => {
    await s.startConversation(guestA, { ...G, message: 'Γεια', locale: 'el' })
    const el = (await s.customerView(guestA)).messages.find((m) => m.automated)!
    expect(el.body).toMatch(/Εξυπηρέτηση Πελατών AIONIX/)

    const { setSetting } = await import('../settings')
    await setSetting('support_auto_reply_ru', '')
    await s.startConversation(guestB, { ...G, message: 'Привет', locale: 'ru' })
    const ru = (await s.customerView(guestB)).messages.find((m) => m.automated)!
    expect(ru.body).toMatch(/^Hello! Thank you/)
  })

  it('can be edited and switched off in the admin', async () => {
    const { setSetting } = await import('../settings')
    await setSetting('support_auto_reply_en', 'Thanks — we will be right with you.')
    await s.startConversation(guestA, { ...G, message: 'hi' })
    expect((await s.customerView(guestA)).messages.at(-1)?.body).toBe('Thanks — we will be right with you.')

    await setSetting('support_auto_reply_enabled', false)
    await s.startConversation(guestB, { ...G, message: 'hi' })
    const view = await s.customerView(guestB)
    expect(view.messages).toHaveLength(1)
    expect(view.messages[0].sender).toBe('CUSTOMER')
  })
})

describe('ownership', () => {
  it('nobody else can read or write a conversation, even knowing its id', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'private' })
    expect((await s.customerView(guestB)).conversation).toBeNull()
    await expect(s.postCustomerMessage(guestB, conversationId, 'hijack')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(s.postCustomerMessage({ userId: null, guestToken: null }, conversationId, 'hijack')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await customerBodies()).toEqual(['private'])
  })

  it('stores only a hash of the guest token', async () => {
    await s.startConversation(guestA, { ...G, message: 'hi' })
    const [row] = await db.select().from(supportConversations)
    expect(row.guestTokenHash).toBe(s.hashGuestToken(guestA.guestToken))
    expect(row.guestTokenHash).not.toBe(guestA.guestToken)
  })

  it('never tells the customer which staff member replied', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'hi' })
    await s.staffReply(conversationId, staffId, 'Hello from us')
    const view = await s.customerView(guestA)
    expect(view.messages.at(-1)).toMatchObject({ sender: 'STAFF', body: 'Hello from us' })
    expect(JSON.stringify(view)).not.toContain(staffId)
    expect(JSON.stringify(view)).not.toContain('Nikos')
  })
})

describe('closing after inactivity', () => {
  it('closes after 10 quiet minutes and emails the transcript once', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    await s.staffReply(conversationId, staffId, 'Hello!')
    await age(conversationId, 9)
    expect(await s.sweepIdleConversations()).toBe(0)
    await age(conversationId, 11)
    expect(await s.sweepIdleConversations()).toBe(1)
    expect(await s.sweepIdleConversations()).toBe(0)

    const [row] = await db.select().from(supportConversations)
    expect(row).toMatchObject({ status: 'CLOSED', closedReason: 'INACTIVITY' })
    const transcripts = sent.filter((m) => m.kind === 'support_transcript')
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0].to).toBe('maria@example.com')
    expect(transcripts[0].subject).toBe('Your AIONIX Customer Service conversation')
    expect(transcripts[0].text).toContain('You ·')
    expect(transcripts[0].text).toContain('AIONIX Customer Service ·')
    expect(transcripts[0].text).not.toContain('Nikos')
    expect(transcripts[0].text).toContain('Hello!')
    /* The customer is told why it ended, and can start again. */
    const view = await s.customerView(guestA)
    expect(view.conversation).toMatchObject({ status: 'CLOSED', closedReason: 'INACTIVITY' })
    expect(view.messages.length).toBeGreaterThan(0)
    expect((await s.startConversation(guestA, { ...G, message: 'Me again' })).created).toBe(true)
  })

  it('a staff reply resets the timer too', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    await age(conversationId, 9)
    await s.staffReply(conversationId, staffId, 'Looking into it')
    await age(conversationId, 0)
    expect(await s.sweepIdleConversations()).toBe(0)
    const [row] = await db.select().from(supportConversations)
    expect(row.status).toBe('OPEN')
  })

  it('escapes customer text in the transcript email', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: '<img src=x onerror=alert(1)>' })
    await s.closeConversation(conversationId, { reason: 'STAFF', staffUserId: staffId })
    const html = sent.find((m) => m.kind === 'support_transcript')!.html!
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('measures from the last message, not from when it opened', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    await db.update(supportConversations).set({ openedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(supportConversations.id, conversationId))
    await age(conversationId, 8)
    await s.postCustomerMessage(guestA, conversationId, 'Another question') /* resets the clock */
    await age(conversationId, 0)
    expect(await s.sweepIdleConversations()).toBe(0)
    const [row] = await db.select().from(supportConversations)
    expect(row.status).toBe('OPEN')
  })

  it('a message after the limit does not revive it', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    await age(conversationId, 12)
    await expect(s.postCustomerMessage(guestA, conversationId, 'hello?')).rejects.toMatchObject({ code: 'CLOSED' })
    const view = await s.customerView(guestA)
    expect(view.conversation?.status).toBe('CLOSED')
  })

  it('follows the setting', async () => {
    await db.execute(sql`insert into settings (key, value) values ('support_idle_minutes', '30'::jsonb) on conflict (key) do update set value = excluded.value`)
    const { invalidateSettingsCache } = await import('../settings')
    invalidateSettingsCache()
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    await age(conversationId, 20)
    expect(await s.sweepIdleConversations()).toBe(0)
    await db.execute(sql`delete from settings where key = 'support_idle_minutes'`)
    invalidateSettingsCache()
  })
})

describe('closing by staff', () => {
  it('closes once, keeps everything, and the customer can start again', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'Hi' })
    expect(await s.closeConversation(conversationId, { reason: 'STAFF', staffUserId: staffId })).toBe(true)
    expect(await s.closeConversation(conversationId, { reason: 'STAFF', staffUserId: staffId })).toBe(false)
    expect(await s.sweepIdleConversations()).toBe(0)
    expect(sent.filter((m) => m.kind === 'support_transcript')).toHaveLength(1)

    await expect(s.staffReply(conversationId, staffId, 'late')).rejects.toMatchObject({ code: 'CLOSED' })
    const view = await s.customerView(guestA)
    expect(view.conversation).toMatchObject({ status: 'CLOSED', closedReason: 'STAFF' })

    const next = await s.startConversation(guestA, { ...G, message: 'New question' })
    expect(next.created).toBe(true)
    expect(await db.select().from(supportConversations)).toHaveLength(2)
    expect(await customerBodies()).toEqual(['Hi', 'New question'])
  })

  it('sends no transcript when there is no address to send it to', async () => {
    const [u] = await db
      .insert(users)
      .values({ email: `n-${Date.now()}@example.com`, passwordHash: 'x', firstName: 'N', lastName: 'N', phone: `+3579${(Date.now() + 2) % 10_000_000}` })
      .returning({ id: users.id })
    const { conversationId } = await s.startConversation({ userId: u.id, guestToken: null }, { message: 'Hi', locale: 'en' })
    await s.closeConversation(conversationId, { reason: 'STAFF', staffUserId: staffId })
    expect(sent.filter((m) => m.kind === 'support_transcript')).toHaveLength(0)
  })

  it('counts unread customer messages for the inbox', async () => {
    const { conversationId } = await s.startConversation(guestA, { ...G, message: 'one' })
    await s.postCustomerMessage(guestA, conversationId, 'two')
    expect((await s.inboxCounts()).unread).toBe(1)
    const list = await s.listInbox({ status: 'OPEN' })
    expect(list.rows[0]).toMatchObject({ unread: 2, lastMessage: 'two', signedIn: false })
    /* The All view has open and closed together. */
    expect((await s.listInbox({ status: 'ALL' })).rows).toHaveLength(1)
    expect((await s.listInbox({ status: 'CLOSED' })).rows).toHaveLength(0)
    await s.staffThread(conversationId, { markRead: true })
    expect((await s.inboxCounts()).unread).toBe(0)
  })
})
