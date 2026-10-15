/* ============================================================================
 * Automated emails, against the real database: triggers, timing, the checks
 * made at send time, consent and unsubscribe, frequency protection, duplicate
 * prevention, the order lifecycle, the event log, test sends and the rule that
 * required emails keep working whatever is switched off.
 *
 * No email service is configured in tests, so `send` writes each email to
 * `email_log` (status "logged") — which is exactly what these tests read.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import {
  categories,
  emailJobs,
  emailLog,
  inventory,
  newsletterSubscribers,
  orderItems,
  orders,
  productVariants,
  products,
  stockAlerts,
  users,
} from '@/db/schema'
import { addToCart, clearCart, getOrCreateCart } from '../cart'
import { setOnHand } from '../inventory'
import { invalidateSettingsCache, setSetting } from '../settings'
import { renderTemplate, saveTemplate, sendTemplate, TemplateError } from '../mailer'
import {
  bagChanged,
  customerActivity,
  emailActivity,
  orderCreated,
  orderEvent,
  orderStatusChanged,
  processDueJobs,
  scheduleWelcome,
} from '../automations'

vi.spyOn(console, 'info').mockImplementation(() => {})

const HOUR = 3_600_000
const later = (h: number) => new Date(Date.now() + h * HOUR)

let productId: string
let variantId: string
let userId: string
const EMAIL = 'maria@example.com'

beforeEach(async () => {
  await db.execute(sql`truncate table email_jobs, email_log, email_templates, stock_alerts, newsletter_subscribers,
    order_items, orders, cart_items, inventory_reservations, carts, inventory, product_images, product_variants,
    products, categories, users restart identity cascade`)
  await db.execute(sql`delete from settings where key in ('marketing_cooldown_hours', 'email_test_address')`)
  invalidateSettingsCache()

  const [cat] = await db.insert(categories).values({ slug: 'women', name: { en: 'Women' } }).returning({ id: categories.id })
  const [p] = await db
    .insert(products)
    .values({
      categoryId: cat.id,
      slug: 'sculpt-legging',
      name: { en: 'Sculpt Legging', el: 'Κολάν Sculpt', ru: 'Леггинсы Sculpt' },
      priceCents: 5500,
      isActive: true,
    })
    .returning({ id: products.id })
  productId = p.id
  const [v] = await db
    .insert(productVariants)
    .values({ productId, sku: 'SL-BLK-M', size: 'M', colorHex: '#000000', colorName: { en: 'Black' } })
    .returning({ id: productVariants.id })
  variantId = v.id
  await db.insert(inventory).values({ variantId, onHand: 10, reserved: 0 })

  const [u] = await db
    .insert(users)
    .values({
      email: EMAIL,
      passwordHash: 'x',
      firstName: 'Maria',
      lastName: 'P',
      phone: '+35799111222',
      emailVerifiedAt: new Date(),
      locale: 'en',
    })
    .returning({ id: users.id })
  userId = u.id
})

afterAll(async () => {
  await pool.end()
})

const subscribe = (email = EMAIL, locale = 'en') =>
  db.insert(newsletterSubscribers).values({
    email,
    locale,
    status: 'SUBSCRIBED',
    source: 'footer',
    consentAt: new Date(),
    confirmedAt: new Date(),
  })

const jobs = (automation?: string) =>
  db
    .select()
    .from(emailJobs)
    .where(automation ? eq(emailJobs.automation, automation) : undefined)
const logs = (kind?: string) =>
  db
    .select()
    .from(emailLog)
    .where(kind ? eq(emailLog.kind, kind) : undefined)

async function bagWithItem() {
  const cartId = await getOrCreateCart({ userId })
  await addToCart(cartId, variantId, 1)
  return cartId
}

async function makeOrder(status: 'PENDING' | 'PAID' = 'PENDING') {
  const [o] = await db
    .insert(orders)
    .values({
      orderNumber: `SF-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      userId,
      email: EMAIL,
      phone: '+35799111222',
      customerName: 'Maria P',
      status,
      deliveryKind: 'SHIPPING',
      subtotalCents: 5500,
      totalCents: 5500,
      locale: 'en',
    })
    .returning()
  await db.insert(orderItems).values({
    orderId: o.id,
    variantId,
    productId,
    productName: 'Sculpt Legging',
    sku: 'SL-BLK-M',
    quantity: 1,
    unitPriceCents: 5500,
    lineTotalCents: 5500,
  })
  return o
}

/* ========================================================================== */

describe('welcome', () => {
  it('is scheduled once after verification and sent in the customer’s language', async () => {
    await db.update(users).set({ locale: 'el' }).where(eq(users.id, userId))
    await scheduleWelcome(userId)
    await scheduleWelcome(userId) /* a second trigger is a no-op */
    expect(await jobs('welcome')).toHaveLength(1)

    const tally = await processDueJobs(later(0.01))
    expect(tally.sent).toBe(1)
    const [mail] = await logs('welcome')
    expect(mail.subject).toBe('Καλώς ήρθες στο AIONIX')
    expect(mail.category).toBe('lifecycle')
    expect(mail.body).toContain('Maria')
  })

  it('switched off: not sent, and the log says why', async () => {
    await saveTemplate('welcome', { enabled: false }, null)
    await scheduleWelcome(userId)
    expect((await processDueJobs(later(0.01))).skipped).toBe(1)
    expect(await logs('welcome')).toHaveLength(0)
    const [job] = await jobs('welcome')
    expect(job.status).toBe('SKIPPED')
    expect(job.outcome).toMatch(/Switched off/)
  })
})

describe('abandoned bag', () => {
  it('is scheduled about four hours after the last change, with the reason recorded', async () => {
    const before = Date.now()
    await bagWithItem()
    const [job] = await jobs('abandoned_bag')
    expect(job.status).toBe('SCHEDULED')
    const delay = job.scheduledAt.getTime() - before
    expect(delay).toBeGreaterThan(3.9 * HOUR)
    expect(delay).toBeLessThan(4.1 * HOUR)
    expect(job.reason).toMatch(/1 item in the bag/)
  })

  it('a further change moves the one reminder rather than adding another', async () => {
    const cartId = await bagWithItem()
    const [first] = await jobs('abandoned_bag')
    await new Promise((r) => setTimeout(r, 20))
    await addToCart(cartId, variantId, 2)
    const all = await jobs('abandoned_bag')
    expect(all).toHaveLength(1)
    expect(all[0].scheduledAt.getTime()).toBeGreaterThan(first.scheduledAt.getTime())
  })

  it('is not sent before its time', async () => {
    await subscribe()
    await bagWithItem()
    expect((await processDueJobs(later(3))).sent).toBe(0)
    expect((await jobs('abandoned_bag'))[0].status).toBe('SCHEDULED')
  })

  it('is sent after four hours to a subscriber: the product, quantity, price and the way back', async () => {
    await subscribe()
    await bagWithItem()
    expect((await processDueJobs(later(4.1))).sent).toBe(1)
    const [mail] = await logs('abandoned_bag')
    expect(mail.subject).toBe('You left something behind')
    expect(mail.category).toBe('marketing')
    expect(mail.body).toContain('Sculpt Legging')
    expect(mail.body).toContain('× 1')
    expect(mail.body).toMatch(/€\s?55[.,]00|55[.,]00\s?€/)
    expect(mail.body).toContain('Return to my bag')
    expect(mail.body).toContain('/en/cart')
    expect(mail.body).toMatch(/Unsubscribe: .*\/newsletter\/unsubscribe/)
  })

  it('is not sent without marketing consent', async () => {
    await bagWithItem()
    expect((await processDueJobs(later(4.1))).skipped).toBe(1)
    expect(await logs('abandoned_bag')).toHaveLength(0)
    expect((await jobs('abandoned_bag'))[0].outcome).toMatch(/No marketing consent/)
  })

  it('is not sent after they unsubscribe', async () => {
    await subscribe()
    await bagWithItem()
    await db.update(newsletterSubscribers).set({ status: 'UNSUBSCRIBED', unsubscribedAt: new Date() })
    await processDueJobs(later(4.1))
    expect(await logs('abandoned_bag')).toHaveLength(0)
  })

  it('is cancelled by a purchase', async () => {
    await subscribe()
    await bagWithItem()
    const order = await makeOrder()
    await orderCreated(order.id)
    const [job] = await jobs('abandoned_bag')
    expect(job.status).toBe('CANCELLED')
    expect(job.outcome).toContain(order.orderNumber)
    await processDueJobs(later(4.1))
    expect(await logs('abandoned_bag')).toHaveLength(0)
  })

  it('is skipped when they bought it some other way before it was due', async () => {
    await subscribe()
    await bagWithItem()
    await makeOrder() /* no orderCreated hook — the send-time check still catches it */
    await processDueJobs(later(4.1))
    expect(await logs('abandoned_bag')).toHaveLength(0)
    expect((await jobs('abandoned_bag'))[0].outcome).toMatch(/Ordered/)
  })

  it('is cancelled when the bag is emptied', async () => {
    await subscribe()
    const cartId = await bagWithItem()
    await clearCart(cartId)
    expect((await jobs('abandoned_bag'))[0].status).toBe('CANCELLED')
  })

  it('is skipped when nothing in the bag can be bought any more', async () => {
    await subscribe()
    await bagWithItem()
    await db.update(products).set({ availability: 'SOLD_OUT' }).where(eq(products.id, productId))
    await processDueJobs(later(4.1))
    expect(await logs('abandoned_bag')).toHaveLength(0)
    expect((await jobs('abandoned_bag'))[0].outcome).toMatch(/available/)
  })

  it('never goes to a guest bag — there is no one to write to', async () => {
    const guestCart = await getOrCreateCart({ anonymousToken: 'guest-token-123' })
    await addToCart(guestCart, variantId, 1)
    await bagChanged(guestCart)
    expect(await jobs('abandoned_bag')).toHaveLength(0)
  })

  it('does not repeat within a week', async () => {
    await subscribe()
    const cartId = await bagWithItem()
    await processDueJobs(later(4.1))
    await setSetting('marketing_cooldown_hours', 0) /* isolate the repeat rule from the frequency limit */
    await addToCart(cartId, variantId, 2)
    await processDueJobs(later(8.5))
    expect(await logs('abandoned_bag')).toHaveLength(1)
    const skipped = (await jobs('abandoned_bag')).find((j) => j.status === 'SKIPPED')
    expect(skipped?.outcome).toMatch(/already went out/)
  })

  it('the follow-up is its own switch, and only follows a sent first reminder', async () => {
    await subscribe()
    await setSetting('marketing_cooldown_hours', 0)
    await bagWithItem()
    await processDueJobs(later(4.1))
    expect(await jobs('abandoned_bag_followup')).toHaveLength(0) /* off by default */

    await db.execute(sql`truncate table email_jobs, email_log`)
    await saveTemplate('abandoned_bag_followup', { enabled: true }, null)
    const cartId = await getOrCreateCart({ userId })
    await addToCart(cartId, variantId, 3)
    await processDueJobs(later(4.1))
    const [follow] = await jobs('abandoned_bag_followup')
    expect(follow.status).toBe('SCHEDULED')
    await processDueJobs(later(25))
    const [mail] = await logs('abandoned_bag_followup')
    expect(mail.subject).toBe('Still thinking about it?')
  })
})

describe('frequency protection', () => {
  it('holds a marketing email back when another went out recently', async () => {
    await subscribe()
    await sendTemplate('abandoned_bag', {
      to: EMAIL,
      vars: { customer_name: 'Maria', bag_items: [], bag_url: '/en/cart' },
      unsubscribe: { pageUrl: 'u', oneClickUrl: 'o' },
    })
    await bagWithItem()
    await processDueJobs(later(4.1))
    expect(await logs('abandoned_bag')).toHaveLength(1) /* only the one sent by hand above */
    expect((await jobs('abandoned_bag'))[0].outcome).toMatch(/Frequency limit/)
  })

  it('never holds back essential email', async () => {
    await subscribe()
    await sendTemplate('abandoned_bag', {
      to: EMAIL,
      vars: { customer_name: 'Maria', bag_items: [], bag_url: '/en/cart' },
      unsubscribe: { pageUrl: 'u', oneClickUrl: 'o' },
    })
    const order = await makeOrder()
    await orderCreated(order.id)
    await processDueJobs(later(0.01))
    expect(await logs('order_received')).toHaveLength(1)
  })
})

describe('order lifecycle', () => {
  it('sends each step once, in order, with the order’s details', async () => {
    const order = await makeOrder()
    await orderCreated(order.id)
    await orderCreated(order.id) /* duplicate trigger */
    await processDueJobs(later(0.01))
    await orderStatusChanged(order.id, 'PAID')
    await processDueJobs(later(0.02))
    await orderStatusChanged(order.id, 'PROCESSING')
    await orderStatusChanged(order.id, 'PROCESSING') /* duplicate */
    await processDueJobs(later(0.03))

    expect((await logs('order_received')).length).toBe(1)
    expect((await logs('payment_confirmed')).length).toBe(1)
    expect((await logs('order_preparing')).length).toBe(1)
    const [received] = await logs('order_received')
    expect(received.subject).toBe(`Order ${order.orderNumber} received`)
    expect(received.body).toContain('Sculpt Legging')
    expect(received.category).toBe('transactional')
  })

  it('does not send "confirmed" right after "payment confirmed" — they say the same', async () => {
    const order = await makeOrder('PAID')
    await orderStatusChanged(order.id, 'PAID')
    await processDueJobs(later(0.01))
    await orderEvent(order.id, 'order_confirmed', 'Store confirmed it.')
    await processDueJobs(later(0.02))
    expect(await logs('order_confirmed')).toHaveLength(0)
    expect((await jobs('order_confirmed'))[0].outcome).toMatch(/already confirmed/)
  })

  it('includes tracking only when there is a real number', async () => {
    const a = await makeOrder('PAID')
    await orderStatusChanged(a.id, 'SHIPPED')
    const b = await makeOrder('PAID')
    await orderStatusChanged(b.id, 'SHIPPED', { trackingNumber: 'CY123456789' })
    await processDueJobs(later(0.01))
    const shipped = await logs('order_shipped')
    const forA = shipped.find((m) => m.subject.includes(a.orderNumber))!
    const forB = shipped.find((m) => m.subject.includes(b.orderNumber))!
    expect(forA.body).not.toMatch(/tracking/i)
    expect(forB.body).toContain('CY123456789')
  })

  it('delivered schedules the review request only when that email is switched on', async () => {
    const a = await makeOrder('PAID')
    await orderStatusChanged(a.id, 'DELIVERED')
    await processDueJobs(later(0.01))
    expect(await jobs('review_request')).toHaveLength(0)

    await saveTemplate('review_request', { enabled: true, delayMinutes: 3 * 24 * 60 }, null)
    const b = await makeOrder('PAID')
    await orderStatusChanged(b.id, 'DELIVERED')
    await processDueJobs(later(0.02))
    const [review] = await jobs('review_request')
    expect(review.status).toBe('SCHEDULED')
    expect(review.scheduledAt.getTime() - Date.now()).toBeGreaterThan(2.9 * 24 * HOUR)
    await processDueJobs(later(24 * 3 + 1))
    expect((await logs('review_request'))[0].subject).toBe('How did you like your AIONIX order?')
  })
})

describe('back in stock', () => {
  it('tells whoever asked, once, when the size comes back — and only while it is there', async () => {
    await setOnHand(variantId, 0)
    await db.insert(stockAlerts).values({ variantId, email: 'eva@example.com', locale: 'en' })
    await setOnHand(variantId, 3)
    await setOnHand(variantId, 5) /* already available: no second trigger */
    const [job] = await jobs('back_in_stock')
    expect(job.status).toBe('SCHEDULED')
    await processDueJobs(later(0.01))
    const [mail] = await logs('back_in_stock')
    expect(mail.subject).toMatch(/It’s back/)
    expect(mail.body).toContain('Sculpt Legging')
    expect(mail.body).toContain('Black · M')
    const [alert] = await db.select().from(stockAlerts)
    expect(alert.notifiedAt).not.toBeNull()
  })
})

describe('the admin controls', () => {
  it('a required email cannot be switched off — and keeps sending if someone tries', async () => {
    await expect(saveTemplate('auth_verification', { enabled: false }, null)).rejects.toBeInstanceOf(TemplateError)
    await db.execute(sql`insert into email_templates (key, enabled) values ('order_received', false)`)
    const order = await makeOrder()
    await orderCreated(order.id)
    await processDueJobs(later(0.01))
    expect(await logs('order_received')).toHaveLength(1)
  })

  it('refuses a variable the email does not have, and timing out of range', async () => {
    await expect(saveTemplate('welcome', { content: { en: { body: 'Hi {{order_total}}' } } }, null)).rejects.toThrow(/order_total/)
    await expect(saveTemplate('abandoned_bag', { delayMinutes: 5 }, null)).rejects.toThrow(/between/)
  })

  it('edited words are used, per language, with English for what is not written', async () => {
    await saveTemplate('welcome', { content: { el: { subject: 'Γεια σου {{customer_name}}!' } } }, null)
    const el = await renderTemplate('welcome', 'el', { customer_name: 'Μαρία' })
    expect(el.rendered.subject).toBe('Γεια σου Μαρία!')
    const ru = await renderTemplate('welcome', 'ru', { customer_name: 'Мария' })
    expect(ru.rendered.subject).not.toContain('Γεια')
  })

  it('refuses to send marketing without an unsubscribe link', async () => {
    await expect(sendTemplate('abandoned_bag', { to: EMAIL, vars: {} })).rejects.toThrow(/unsubscribe/)
  })

  it('the activity list shows scheduled and sent, with the reason', async () => {
    await subscribe()
    await bagWithItem()
    await scheduleWelcome(userId)
    await processDueJobs(later(0.01))
    const all = await emailActivity({})
    const bag = all.rows.find((r) => r.kind === 'abandoned_bag')!
    expect(bag.status).toBe('scheduled')
    expect(bag.detail).toMatch(/1 item in the bag/)
    const welcome = all.rows.find((r) => r.kind === 'welcome')!
    expect(welcome.status).toBe('sent')
    expect(welcome.recipient).toBe(EMAIL)
    expect((await emailActivity({ status: 'scheduled' })).rows.every((r) => r.status === 'scheduled')).toBe(true)

    const numbers = await customerActivity()
    expect(numbers.scheduled).toBe(1)
    expect(numbers.subscribers).toBe(1)
    expect(numbers.newCustomers).toBe(1)
  })

  it('two workers never send the same job twice', async () => {
    await scheduleWelcome(userId)
    const t = later(0.01)
    const [a, b] = await Promise.all([processDueJobs(t), processDueJobs(t)])
    expect(a.sent + b.sent).toBe(1)
    expect(await logs('welcome')).toHaveLength(1)
    expect(await db.select().from(emailJobs).where(and(eq(emailJobs.automation, 'welcome'), eq(emailJobs.status, 'SENT')))).toHaveLength(1)
  })
})
