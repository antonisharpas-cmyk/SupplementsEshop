/* ============================================================================
 * Card payments through Stripe Checkout, with Stripe itself scripted.
 *
 * What must hold:
 *  · only test keys are used: a live key switches card payment off;
 *  · a card order is created unpaid and sends the customer to Stripe;
 *  · a successful payment (webhook or return page) marks the order PAID,
 *    records the card and issues the invoice, once;
 *  · a declined card keeps the order open with the reason, and paying again
 *    clears it;
 *  · a payment page left to expire cancels the order and returns the stock;
 *  · events from the other Stripe mode are ignored.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '@/db'
import {
  cartItems,
  carts,
  categories,
  deliveryOptions,
  emailJobs,
  inventory,
  inventoryReservations,
  invoices,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  promoCodeUsage,
  webhookEvents,
} from '@/db/schema'

/* ---------------------------------------------------- scripted Stripe --- */
type Session = { id: string; url: string; metadata: Record<string, string>; client_reference_id: string; payment_status: string; payment_intent: unknown }
const sessions = new Map<string, Session>()
let created: Record<string, unknown>[] = []
let n = 0
const fake = {
  checkout: {
    sessions: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        created.push(args)
        const id = `cs_test_${++n}`
        const s: Session = {
          id,
          url: `https://checkout.stripe.com/c/pay/${id}`,
          metadata: args.metadata as Record<string, string>,
          client_reference_id: args.client_reference_id as string,
          payment_status: 'unpaid',
          payment_intent: null,
        }
        sessions.set(id, s)
        return s
      }),
      retrieve: vi.fn(async (id: string) => sessions.get(id)),
      expire: vi.fn(async () => ({})),
    },
  },
  refunds: { create: vi.fn(async () => ({})) },
}
function pay(sessionId: string) {
  const s = sessions.get(sessionId)!
  s.payment_status = 'paid'
  s.payment_intent = {
    id: `pi_test_${sessionId}`,
    latest_charge: { payment_method_details: { card: { brand: 'visa', last4: '4242' } } },
  }
}

vi.mock('@/lib/stripe', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/stripe')>()
  return { ...real, stripe: () => fake }
})

const { placeOrder, handleStripeEvent, syncCheckoutSession, startCardPayment } = await import('../orders')
const { addToCart } = await import('../cart')
const { stripeMode } = await import('../stripe')

let variant: string
let shipping: string
const address = { recipientName: 'Test Person', phone: '+35799123456', line1: 'Test Street 1', city: 'Larnaca', postalCode: '6017', country: 'CY' }
const input = () => ({
  email: 'card@orders.test',
  phone: '+35799123456',
  firstName: 'Card',
  lastName: 'Buyer',
  deliveryOptionId: shipping,
  shippingAddress: address,
  paymentMethod: 'card' as const,
  locale: 'en' as const,
})
async function cart() {
  const [c] = await db.insert(carts).values({ anonymousToken: `t-${Math.random()}` }).returning({ id: carts.id })
  return c.id
}
async function onHand() {
  const [r] = await db.select({ onHand: inventory.onHand }).from(inventory).where(eq(inventory.variantId, variant))
  return r.onHand
}
async function cardOrder() {
  const c = await cart()
  await addToCart(c, variant, 2)
  const r = await placeOrder({ cartId: c, userId: null, input: input() })
  const sessionId = [...sessions.keys()].at(-1)!
  return { ...r, sessionId }
}
const state = async (orderId: string) => {
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId))
  const [p] = await db.select().from(payments).where(eq(payments.orderId, orderId))
  return { o, p }
}

beforeEach(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_scripted'
  delete process.env.STRIPE_ALLOW_LIVE
  sessions.clear()
  created = []
  await db.delete(webhookEvents)
  await db.delete(emailJobs)
  await db.delete(promoCodeUsage)
  await db.delete(invoices)
  await db.delete(payments)
  await db.delete(orderItems)
  await db.delete(orders)
  await db.delete(inventoryReservations)
  await db.delete(cartItems)
  await db.delete(carts)
  await db.delete(inventory)
  await db.delete(productVariants)
  await db.delete(products)
  await db.delete(categories)
  await db.delete(deliveryOptions)
  const [cat] = await db.insert(categories).values({ slug: 'protein', name: { en: 'Protein' } }).returning({ id: categories.id })
  const [p] = await db.insert(products).values({ categoryId: cat.id, slug: 'whey', name: { en: 'Whey' }, priceCents: 4000, isActive: true }).returning({ id: products.id })
  const [v] = await db.insert(productVariants).values({ productId: p.id, sku: 'W-1', size: '1kg' }).returning({ id: productVariants.id })
  variant = v.id
  await db.insert(inventory).values({ variantId: variant, onHand: 10, reserved: 0 })
  const [s] = await db.insert(deliveryOptions).values({ kind: 'SHIPPING', name: { en: 'Home' }, priceCents: 500, position: 0 }).returning({ id: deliveryOptions.id })
  shipping = s.id
})

afterAll(async () => {
  await pool.end()
})

describe('test mode only', () => {
  it('uses test keys, refuses live keys unless explicitly allowed', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    expect(stripeMode()).toBe('test')
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    expect(stripeMode()).toBe('off')
    process.env.STRIPE_SECRET_KEY = 'pk_test_abc'
    expect(stripeMode()).toBe('off')
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    process.env.STRIPE_ALLOW_LIVE = 'yes'
    expect(stripeMode()).toBe('live')
  })

  it('a live key means no card payment at checkout', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    const c = await cart()
    await addToCart(c, variant, 1)
    await expect(placeOrder({ cartId: c, userId: null, input: input() })).rejects.toMatchObject({ code: 'CARD_UNAVAILABLE' })
  })
})

describe('card payment', () => {
  it('creates the order unpaid and sends the customer to Stripe for the exact total', async () => {
    const r = await cardOrder()
    expect(r.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//)
    const { o, p } = await state(r.orderId)
    expect(o.status).toBe('PAYMENT_PENDING')
    expect(p).toMatchObject({ provider: 'stripe', status: 'PENDING', amountCents: o.totalCents, providerSessionId: r.sessionId })
    const items = created[0].line_items as { price_data: { unit_amount: number; currency: string } }[]
    expect(items[0].price_data).toMatchObject({ unit_amount: o.totalCents, currency: 'eur' })
    expect(String(created[0].success_url)).toContain('session_id={CHECKOUT_SESSION_ID}')
    expect(String(created[0].cancel_url)).toContain('payment=cancelled')
    expect(await onHand()).toBe(8)
  })

  it('a successful payment marks the order paid, keeps the card and issues one invoice', async () => {
    const r = await cardOrder()
    /* Nothing is emailed while the card order is unpaid. */
    expect((await db.select().from(emailJobs).where(eq(emailJobs.email, 'card@orders.test'))).map((j) => j.automation)).toEqual([])
    pay(r.sessionId)
    await handleStripeEvent({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: r.sessionId } } })
    /* The return page asks Stripe too, and a replayed event changes nothing. */
    expect(await syncCheckoutSession(r.sessionId)).toBe('paid')
    expect(await handleStripeEvent({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: r.sessionId } } })).toBe('duplicate')
    const { o, p } = await state(r.orderId)
    expect(o.status).toBe('PAID')
    expect(o.paidAt).not.toBeNull()
    expect(p).toMatchObject({ status: 'SUCCEEDED', providerPaymentId: `pi_test_${r.sessionId}`, cardBrand: 'visa', cardLast4: '4242' })
    const docs = await db.select().from(invoices).where(eq(invoices.orderId, r.orderId))
    expect(docs).toHaveLength(1)
    /* Once paid: one email, the payment confirmation (with the items). */
    const jobs = (await db.select().from(emailJobs).where(eq(emailJobs.email, 'card@orders.test'))).map((j) => j.automation)
    expect(jobs).toEqual(['payment_confirmed'])
  })

  it('a declined card keeps the order open with the reason; paying again clears it', async () => {
    const r = await cardOrder()
    await handleStripeEvent({
      id: 'evt_2',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_x', metadata: { orderId: r.orderId }, last_payment_error: { decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.' } } },
    })
    let s = await state(r.orderId)
    expect(s.o.status).toBe('PAYMENT_PENDING')
    expect(s.p).toMatchObject({ status: 'PENDING', failureCode: 'insufficient_funds', failureMessage: 'Your card has insufficient funds.' })

    const url = await startCardPayment(r.orderId)
    expect(url).toContain('checkout.stripe.com')
    s = await state(r.orderId)
    expect(s.p.failureMessage).toBeNull()
    const second = [...sessions.keys()].at(-1)!
    pay(second)
    await syncCheckoutSession(second)
    s = await state(r.orderId)
    expect(s.o.status).toBe('PAID')
  })

  it('a payment page left to expire cancels the order and returns the stock', async () => {
    const r = await cardOrder()
    expect(await onHand()).toBe(8)
    await handleStripeEvent({
      id: 'evt_3',
      type: 'checkout.session.expired',
      data: { object: { id: r.sessionId, metadata: { orderId: r.orderId }, client_reference_id: r.orderId } },
    })
    const { o } = await state(r.orderId)
    expect(o.status).toBe('CANCELLED')
    expect(await onHand()).toBe(10)
    /* Never paid, never told: no "received" and no "cancelled" email. */
    expect(await db.select().from(emailJobs).where(eq(emailJobs.email, 'card@orders.test'))).toHaveLength(0)
  })

  it('an unpaid return from Stripe does not mark anything paid', async () => {
    const r = await cardOrder()
    expect(await syncCheckoutSession(r.sessionId)).toBe('unpaid')
    expect((await state(r.orderId)).o.status).toBe('PAYMENT_PENDING')
  })

  it('a bank refusal after leaving Stripe marks the attempt failed, the order stays payable', async () => {
    const r = await cardOrder()
    await handleStripeEvent({
      id: 'evt_4',
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: r.sessionId, metadata: { orderId: r.orderId } } },
    })
    const { o, p } = await state(r.orderId)
    expect(o.status).toBe('PAYMENT_PENDING')
    expect(p.status).toBe('FAILED')
    await startCardPayment(r.orderId)
    expect((await state(r.orderId)).p.status).toBe('PENDING')
  })
})

