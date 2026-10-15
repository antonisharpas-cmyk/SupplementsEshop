/* The mailing list: consent, double opt-in, unsubscribing, and never
   mailing anyone who has not confirmed. */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { marketingConsents, newsletterCampaigns, newsletterSubscribers } from '@/db/schema'
import type { EmailMessage } from '@/lib/email'

const sent: EmailMessage[] = []
vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>()
  return { ...real, send: vi.fn(async (m: EmailMessage) => (sent.push(m), { sent: true as const })) }
})

const nl = await import('../newsletter')

const tokenFrom = (text: string, kind: 'confirm' | 'unsubscribe') =>
  decodeURIComponent(new RegExp(`/newsletter/${kind}\\?token=([^\\s"&]+)`).exec(text)?.[1] ?? '')

beforeEach(async () => {
  await db.execute(sql`truncate table newsletter_subscribers, newsletter_campaigns, marketing_consents restart identity cascade`)
  sent.length = 0
})

afterAll(async () => {
  await pool.end()
})

const join = (email = 'ana@example.com', extra: Partial<Parameters<typeof nl.subscribe>[0]> = {}) =>
  nl.subscribe({ email, firstName: 'Ana', locale: 'en', consent: true, source: 'homepage', ...extra })

describe('joining', () => {
  it('refuses without consent', async () => {
    await expect(join('x@example.com', { consent: false })).rejects.toMatchObject({ code: 'CONSENT_REQUIRED' })
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(0)
  })

  it('waits for the confirmation link before anyone is subscribed', async () => {
    await join()
    const [row] = await db.select().from(newsletterSubscribers)
    expect(row.status).toBe('PENDING')
    expect(sent).toHaveLength(1)
    expect(sent[0].kind).toBe('newsletter_confirm')

    const ok = await nl.confirmSubscription(tokenFrom(sent[0].text, 'confirm'))
    expect(ok.ok).toBe(true)
    const [after] = await db.select().from(newsletterSubscribers)
    expect(after.status).toBe('SUBSCRIBED')
    expect(after.confirmedAt).not.toBeNull()
    /* A welcome, marked as marketing, with an unsubscribe link and header. */
    const welcome = sent.find((m) => m.kind === 'newsletter_welcome')!
    expect(welcome.category).toBe('marketing')
    expect(welcome.headers?.['List-Unsubscribe']).toMatch(/\/api\/newsletter\/unsubscribe\?token=/)
    expect(welcome.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(welcome.html).toContain('/newsletter/unsubscribe?token=')
  })

  it('welcomes once, however many times the link is opened', async () => {
    await join()
    const token = tokenFrom(sent[0].text, 'confirm')
    await nl.confirmSubscription(token)
    await nl.confirmSubscription(token)
    expect(sent.filter((m) => m.kind === 'newsletter_welcome')).toHaveLength(1)
  })

  it('never makes a second row for the same address, in any capitalisation', async () => {
    await join('Ana@Example.com')
    await join('ana@example.com')
    expect(await db.select().from(newsletterSubscribers)).toHaveLength(1)
    /* …and does not send a second confirmation within two minutes. */
    expect(sent.filter((m) => m.kind === 'newsletter_confirm')).toHaveLength(1)
  })

  it('rejects a forged or edited link', async () => {
    await join()
    const token = tokenFrom(sent[0].text, 'confirm')
    const [payload, mac] = token.split('.')
    expect((await nl.confirmSubscription(`${payload}.${mac.slice(0, -2)}xx`)).ok).toBe(false)
    const forged = Buffer.from(JSON.stringify({ s: '00000000-0000-0000-0000-000000000000', k: 'c', i: 1 })).toString('base64url')
    expect((await nl.confirmSubscription(`${forged}.${mac}`)).ok).toBe(false)
    /* An unsubscribe token cannot confirm, nor the other way round. */
    const [row] = await db.select().from(newsletterSubscribers)
    expect((await nl.confirmSubscription(nl.unsubscribeToken(row.id))).ok).toBe(false)
  })

  it('escapes what people type into the email', async () => {
    await join('bob@example.com', { firstName: '<img src=x onerror=alert(1)>' })
    expect(sent[0].html).not.toContain('<img src=x')
    expect(sent[0].html).toContain('&lt;img src=x')
  })

  it('records every yes and no in the consent ledger', async () => {
    await join()
    await nl.confirmSubscription(tokenFrom(sent[0].text, 'confirm'))
    const [row] = await db.select().from(newsletterSubscribers)
    await nl.unsubscribe(nl.unsubscribeToken(row.id))
    const ledger = await db.select().from(marketingConsents).orderBy(marketingConsents.createdAt)
    expect(ledger.map((l) => l.granted)).toEqual([true, false])
  })
})

describe('leaving', () => {
  it('unsubscribes by link, idempotently, and an old confirmation link cannot undo it', async () => {
    await join()
    const confirm = tokenFrom(sent[0].text, 'confirm')
    await nl.confirmSubscription(confirm)
    const [row] = await db.select().from(newsletterSubscribers)
    const unsub = nl.unsubscribeToken(row.id)

    expect((await nl.unsubscribe(unsub)).ok).toBe(true)
    expect((await nl.unsubscribe(unsub)).ok).toBe(true)
    await new Promise((r) => setTimeout(r, 1100)) /* tokens carry whole seconds */
    expect((await nl.confirmSubscription(confirm)).ok).toBe(false)
    const [after] = await db.select().from(newsletterSubscribers)
    expect(after.status).toBe('UNSUBSCRIBED')
    expect(after.unsubscribedAt).not.toBeNull()
  })
})

describe('mailings', () => {
  const draft = { kind: 'new_arrivals' as const, subject: 'New in', message: 'Fresh pieces.' }

  it('go only to confirmed subscribers', async () => {
    await join('confirmed@example.com')
    await nl.confirmSubscription(tokenFrom(sent[0].text, 'confirm'))
    await join('pending@example.com')
    await join('left@example.com')
    const [left] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, 'left@example.com'))
    await db.update(newsletterSubscribers).set({ status: 'UNSUBSCRIBED', unsubscribedAt: new Date() }).where(eq(newsletterSubscribers.id, left.id))
    sent.length = 0

    const campaign = await nl.startCampaign(draft, await adminId())
    expect(campaign.recipientCount).toBe(1)
    await nl.deliverCampaign(campaign.id, draft)
    expect(sent.map((m) => m.to)).toEqual(['confirmed@example.com'])
    expect(sent[0].category).toBe('marketing')
    expect(sent[0].headers?.['List-Unsubscribe']).toBeTruthy()
    const [done] = await db.select().from(newsletterCampaigns)
    expect(done).toMatchObject({ status: 'SENT', sentCount: 1, failedCount: 0 })
  })

  it('cannot be started twice at once', async () => {
    await join()
    await nl.confirmSubscription(tokenFrom(sent[0].text, 'confirm'))
    const id = await adminId()
    await nl.startCampaign(draft, id)
    await expect(nl.startCampaign(draft, id)).rejects.toMatchObject({ code: 'ALREADY_SENDING' })
  })

  it('refuses an empty list', async () => {
    await expect(nl.startCampaign(draft, await adminId())).rejects.toMatchObject({ code: 'NO_RECIPIENTS' })
  })
})

/* created_by is a nullable FK; any existing user id, or none, will do. */
async function adminId(): Promise<string | null> {
  const r = await db.execute<{ id: string }>(sql`select id from users limit 1`)
  return r.rows[0]?.id ?? null
}
