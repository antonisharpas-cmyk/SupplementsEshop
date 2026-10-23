/* Membership tiers against the real database: earning a tier, renewing it,
   stepping down one tier at the end of the period, staff tiers kept until a
   date, and the emails each step schedules. */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { orders, tierEvents, users } from '@/db/schema'
import { invalidateSettingsCache } from '../settings'
import { customerTier, evaluateTier, setTierManually, clearManualTier, tierDiscountPercent } from '../loyalty'

const DAY = 86_400_000
let userId: string
let mails: { key: string; dedupe: string }[]
const notify = async (key: string, _u: string, dedupe: string) => {
  mails.push({ key, dedupe })
}

beforeEach(async () => {
  await db.execute(sql`truncate table tier_events, order_items, orders, users restart identity cascade`)
  await db.execute(sql`delete from settings where key like 'loyalty_%'`)
  invalidateSettingsCache()
  mails = []
  const [u] = await db
    .insert(users)
    .values({ email: 'ana@example.com', passwordHash: 'x', firstName: 'Ana', lastName: 'K', phone: '+35799000000', emailVerifiedAt: new Date(), locale: 'en' })
    .returning({ id: users.id })
  userId = u.id
})

afterAll(async () => {
  await pool.end()
})

async function paidOrders(n: number, euros: number, paidAt = new Date()) {
  for (let i = 0; i < n; i++) {
    await db.insert(orders).values({
      orderNumber: `SF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      userId,
      email: 'ana@example.com',
      phone: '+35799000000',
      customerName: 'Ana K',
      status: 'PAID',
      paymentMethod: 'card',
      deliveryKind: 'SHIPPING',
      subtotalCents: euros * 100,
      deliveryCents: 300,
      totalCents: euros * 100 + 300,
      paidAt,
      locale: 'en',
    })
  }
}
const me = async () => (await db.select().from(users).where(eq(users.id, userId)))[0]

describe('membership tiers', () => {
  it('starts at Basic with no discount', async () => {
    expect(await evaluateTier(userId, { notify })).toBe('basic')
    expect(await tierDiscountPercent(userId)).toEqual({ tier: 'basic', percent: 0 })
  })

  it('needs the orders AND the spend', async () => {
    await paidOrders(3, 40) // 3 orders, €120 (delivery not counted)
    expect(await evaluateTier(userId, { notify })).toBe('basic')
    await paidOrders(1, 40) // 4 orders, €160
    expect(await evaluateTier(userId, { notify })).toBe('performer')
    expect(mails.map((m) => m.key)).toContain('tier_upgraded')
    expect(await tierDiscountPercent(userId)).toEqual({ tier: 'performer', percent: 5 })
  })

  it('goes straight to the highest tier earned', async () => {
    await paidOrders(8, 120) // 8 orders, €960
    expect(await evaluateTier(userId, { notify })).toBe('champion')
    const u = await me()
    expect(u.tierExpiresAt!.getTime() - Date.now()).toBeGreaterThan(170 * DAY)
  })

  it('moves the end date on with every order', async () => {
    await paidOrders(4, 110)
    await evaluateTier(userId, { notify })
    const first = (await me()).tierExpiresAt!
    const later = new Date(Date.now() + 30 * DAY)
    await paidOrders(1, 20, later)
    await evaluateTier(userId, { notify, now: later })
    expect((await me()).tierExpiresAt!.getTime()).toBeGreaterThan(first.getTime() + 25 * DAY)
    expect((await me()).tier).toBe('elite')
  })

  it('keeps the tier with one order in the period, even below its earning rules', async () => {
    await paidOrders(8, 120) // Champion
    await evaluateTier(userId, { notify })
    /* Five months on, one small order. */
    const fiveMonths = new Date(Date.now() + 150 * DAY)
    await paidOrders(1, 15, fiveMonths)
    await evaluateTier(userId, { notify, now: fiveMonths })
    /* Seven months after earning it, still Champion. */
    expect(await evaluateTier(userId, { notify, now: new Date(Date.now() + 210 * DAY) })).toBe('champion')
    expect(mails.map((m) => m.key)).not.toContain('tier_downgraded')
  })

  it('steps down one tier at the end of the period, not back to Basic', async () => {
    await paidOrders(15, 150) // Pro
    expect(await evaluateTier(userId, { notify })).toBe('pro')
    /* Seven months on with no order since. */
    const later = new Date(Date.now() + 7 * 30 * DAY)
    expect(await evaluateTier(userId, { notify, now: later })).toBe('champion')
    expect(mails.map((m) => m.key)).toContain('tier_downgraded')
    const ev = await db.select().from(tierEvents).where(eq(tierEvents.userId, userId))
    expect(ev.some((e) => e.reason === 'stepped_down' && e.fromTier === 'pro' && e.toTier === 'champion')).toBe(true)
  })

  it('warns before the tier ends when there is no recent order', async () => {
    await paidOrders(2, 80)
    await evaluateTier(userId, { notify })
    const end = (await me()).tierExpiresAt!
    /* Orders fall out of the window, 10 days before the end. */
    await db.update(orders).set({ paidAt: new Date(Date.now() - 200 * DAY) })
    await evaluateTier(userId, { notify, now: new Date(end.getTime() - 10 * DAY) })
    expect(mails.map((m) => m.key)).toContain('tier_expiring')
    expect((await me()).tier).toBe('performer')
  })

  it('sends a last reminder 2 days before the end, then the tier ended email', async () => {
    await paidOrders(2, 80)
    await evaluateTier(userId, { notify })
    const end = (await me()).tierExpiresAt!
    mails = []
    await evaluateTier(userId, { notify, now: new Date(end.getTime() - 1.5 * DAY) })
    expect(mails.map((m) => m.key)).toEqual(['tier_last_call'])
    mails = []
    await evaluateTier(userId, { notify, now: new Date(end.getTime() + DAY) })
    expect(mails.map((m) => m.key)).toContain('tier_downgraded')
  })

  it('sends the near goal email at 80% of the next tier', async () => {
    await paidOrders(2, 80) // Performer; Elite needs 4 and €400
    await evaluateTier(userId, { notify })
    mails = []
    await paidOrders(2, 85) // 4 orders, €330 = 82% of the spend
    await evaluateTier(userId, { notify })
    expect(mails.map((m) => m.key)).toEqual(['tier_near'])
  })

  it('keeps a staff tier until its date, then the rules apply', async () => {
    const until = new Date(Date.now() + 10 * DAY)
    await setTierManually({ userId, tier: 'pro', until, by: userId, note: 'Ambassador' })
    expect(await evaluateTier(userId, { notify })).toBe('pro')
    expect((await customerTier(userId))?.manualUntil).toBeTruthy()
    /* After the date, with no orders: one step down. */
    expect(await evaluateTier(userId, { notify, now: new Date(until.getTime() + DAY) })).toBe('champion')
  })

  it('hands a staff tier back to the rules', async () => {
    await setTierManually({ userId, tier: 'elite', until: new Date(Date.now() + 30 * DAY), by: userId })
    await clearManualTier(userId, userId)
    const u = await me()
    expect(u.tierManualUntil).toBeNull()
    /* No orders behind it: the rules take it one tier down. */
    expect(u.tier).toBe('performer')
  })

  it('does not count cancelled orders', async () => {
    await paidOrders(4, 50)
    await db.update(orders).set({ status: 'CANCELLED' })
    expect(await evaluateTier(userId, { notify })).toBe('basic')
  })
})
