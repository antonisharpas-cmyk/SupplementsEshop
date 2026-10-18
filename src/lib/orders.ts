/* ============================================================================
 * ORDERS: checkout, payment, and everything that happens to an order after.
 *
 * Placing an order is one transaction: the order and its lines are written as
 * a snapshot (names, prices, discounts copied in), the stock held in the bag
 * becomes a sale, the promo code use is recorded and the bag is emptied. If
 * any step fails, none of it happened.
 *
 * Two ways to pay:
 *   card  The order is created as PAYMENT_PENDING and the customer is sent to
 *         Stripe's page. Stripe tells us it was paid (webhook, or the return
 *         page asking Stripe directly when no webhook is set up), and the order
 *         becomes PAID. An order left unpaid for over an hour is cancelled and
 *         its stock returned, by the automation tick.
 *   cod   Cash on delivery (or on collection). The order is PENDING until the
 *         shop confirms it; the payment is marked received when it is
 *         delivered or collected.
 *
 * Every status change that a customer should hear about goes through
 * lib/automations.ts, which sends the matching email once.
 * ========================================================================== */

import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  addresses,
  cartItems,
  carts,
  deliveryOptions,
  orderItems,
  orders,
  payments,
  productImages,
  productVariants,
  products,
  promoCodeUsage,
  promoCodes,
  users,
  webhookEvents,
} from '@/db/schema'
import type { Locale } from '@/config/brand'
import { BRAND } from '@/config/brand'
import { tField } from '@/i18n/field'
import { addToCart, getCartView } from '@/lib/cart'
import { consumeCartReservations, InventoryError, reserveManyForCart, restock } from '@/lib/inventory'
import { generateOrderNumber } from '@/lib/pricing'
import { getSetting } from '@/lib/settings'
import { creditRefunds, issueInvoice, safely } from '@/lib/invoices'
import { stripe, stripeEnabled, stripeLocale } from '@/lib/stripe'
import { isUniqueViolation } from '@/lib/db-errors'
import { siteUrl } from '@/lib/email'

export type PaymentMethod = 'card' | 'cod'

export type OrderAddress = {
  recipientName: string
  phone: string
  line1: string
  line2?: string | null
  city: string
  postalCode: string
  country: string
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMPTY_CART'
      | 'UNAVAILABLE'
      | 'PROMO_INVALID'
      | 'NO_DELIVERY'
      | 'ADDRESS_REQUIRED'
      | 'CARD_UNAVAILABLE'
      | 'OUT_OF_STOCK'
      | 'PAYMENT_START_FAILED',
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'CheckoutError'
  }
}

export class OrderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OrderError'
  }
}

/** Where a customer can see their order: their account when they have one,
 *  otherwise the private link that carries the order's secret. */
export function orderUrl(o: { orderNumber: string; userId: string | null; accessToken: string | null; locale: string }) {
  return o.userId
    ? `/${o.locale}/account/orders/${o.orderNumber}`
    : `/${o.locale}/order/${o.orderNumber}?t=${o.accessToken ?? ''}`
}

/* ============================================================ checkout == */

export type PlaceOrderInput = {
  email: string
  phone: string
  firstName: string
  lastName: string
  deliveryOptionId: string
  shippingAddress?: OrderAddress
  customerNote?: string
  paymentMethod: PaymentMethod
  saveAddress?: boolean
  locale: Locale
}

export async function placeOrder(args: {
  cartId: string
  userId: string | null
  input: PlaceOrderInput
}): Promise<{ orderId: string; orderNumber: string; redirectUrl: string }> {
  const { cartId, userId, input } = args

  if (input.paymentMethod === 'card' && !stripeEnabled()) {
    throw new CheckoutError('Card payment is not available right now. Choose cash on delivery.', 'CARD_UNAVAILABLE')
  }

  /* Online orders are delivered; "collect in store" is only for orders the
     staff enter themselves (Admin, Orders, New order). */
  const [chosen] = await db
    .select({ kind: deliveryOptions.kind })
    .from(deliveryOptions)
    .where(eq(deliveryOptions.id, input.deliveryOptionId))
    .limit(1)
  if (!chosen || chosen.kind !== 'SHIPPING') {
    throw new CheckoutError('Choose home delivery.', 'NO_DELIVERY')
  }

  /* Cash orders hold stock until the shop deals with them. A few open ones
     per person is normal; dozens is someone tying up the shelves. */
  if (input.paymentMethod === 'cod') {
    const [open] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(orders)
      .where(
        and(
          eq(orders.paymentMethod, 'cod'),
          eq(orders.status, 'PENDING'),
          sql`(lower(${orders.email}) = ${input.email.toLowerCase()} or ${orders.phone} = ${input.phone ?? ''})`,
        ),
      )
    if (open && open.n >= 3) {
      throw new CheckoutError(
        'You already have orders waiting to be confirmed. Please contact us, or wait until the shop confirms them.',
        'UNAVAILABLE',
      )
    }
  }

  const view = await getCartView(cartId, {
    deliveryOptionId: input.deliveryOptionId,
    email: input.email,
    userId,
    locale: input.locale,
  })
  if (view.isEmpty) throw new CheckoutError('Your bag is empty.', 'EMPTY_CART')

  const unavailable = view.lines.filter((l) => !l.isAvailable)
  if (unavailable.length) {
    throw new CheckoutError(
      'Some items in your bag are no longer available in that quantity. Check your bag and try again.',
      'UNAVAILABLE',
      unavailable.map((l) => l.variantId),
    )
  }
  if (view.promoCodeError) {
    throw new CheckoutError(view.promoCodeError.message, 'PROMO_INVALID')
  }

  const [option] = await db
    .select()
    .from(deliveryOptions)
    .where(and(eq(deliveryOptions.id, input.deliveryOptionId), eq(deliveryOptions.isActive, true)))
    .limit(1)
  if (!option || view.totals.deliveryOptionId !== option.id) {
    throw new CheckoutError('Choose how you would like to receive your order.', 'NO_DELIVERY')
  }
  if (option.kind === 'SHIPPING' && !input.shippingAddress) {
    throw new CheckoutError('Enter the delivery address.', 'ADDRESS_REQUIRED')
  }

  /* Hold everything again for the length of the payment. The bag's holds may
     have lapsed while the customer filled in the form. All or nothing. */
  const hold = await reserveManyForCart(
    cartId,
    view.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    { ttlSeconds: 30 * 60 },
  )
  if (!hold.ok) {
    throw new CheckoutError(
      'Someone bought the last of something in your bag a moment ago. Check your bag and try again.',
      'OUT_OF_STOCK',
      hold.failures,
    )
  }

  const prefix = await getSetting('order_number_prefix')
  const { estimated_delivery_min_days: lo, estimated_delivery_max_days: hi } = {
    estimated_delivery_min_days: option.minDays ?? (await getSetting('estimated_delivery_min_days')),
    estimated_delivery_max_days: option.maxDays ?? (await getSetting('estimated_delivery_max_days')),
  }
  const day = 24 * 60 * 60 * 1000
  const now = new Date()
  const accessToken = randomBytes(24).toString('hex')
  const t = view.totals
  const locale = input.locale

  /* Variant snapshots the cart view does not carry. */
  const linesByVariant = new Map(view.lines.map((l) => [l.variantId, l]))
  const priced = new Map(t.lines.map((l) => [l.variantId, l]))

  let created: { id: string; orderNumber: string } | null = null
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    const orderNumber = generateOrderNumber(prefix)
    try {
      created = await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber,
            userId,
            email: input.email.toLowerCase(),
            phone: input.phone,
            customerName: `${input.firstName} ${input.lastName}`.trim(),
            status: input.paymentMethod === 'card' ? 'PAYMENT_PENDING' : 'PENDING',
            deliveryKind: option.kind,
            deliveryOptionId: option.id,
            deliveryOptionName: option.name,
            shippingAddress: option.kind === 'SHIPPING' ? (input.shippingAddress as Record<string, unknown>) : null,
            billingAddress: null,
            subtotalCents: t.listTotalCents,
            promotionDiscountCents: t.promotionDiscountCents,
            promoCodeDiscountCents: t.promoCodeDiscountCents,
            deliveryCents: t.deliveryCents,
            totalCents: t.totalCents,
            vatCents: t.vatCents,
            currency: t.currency,
            promoCodeId: t.promoCode?.id ?? null,
            promoCodeSnapshot: t.promoCode ? { code: t.promoCode.code, discountCents: t.promoCode.discountCents } : null,
            customerNote: input.customerNote?.trim() || null,
            locale,
            paymentMethod: input.paymentMethod,
            accessToken,
            estimatedDeliveryFrom: option.kind === 'SHIPPING' ? new Date(now.getTime() + lo * day) : null,
            estimatedDeliveryTo: option.kind === 'SHIPPING' ? new Date(now.getTime() + hi * day) : null,
          })
          .returning({ id: orders.id, orderNumber: orders.orderNumber })

        await tx.insert(orderItems).values(
          view.lines.map((l) => {
            const p = priced.get(l.variantId)!
            const line = linesByVariant.get(l.variantId)!
            return {
              orderId: order.id,
              variantId: l.variantId,
              productId: l.productId,
              productName: tField(line.productName, locale).slice(0, 300),
              sku: line.sku,
              size: line.size,
              colorName: line.colorName ? tField(line.colorName, locale).slice(0, 80) : null,
              imageUrl: line.imageUrl,
              quantity: l.quantity,
              unitPriceCents: p.listCents,
              unitDiscountCents: p.unitDiscountCents,
              lineTotalCents: p.lineFinalCents,
              appliedPromotionId: p.promotionId,
              appliedPromotionSnapshot: p.promotionSnapshot,
            }
          }),
        )

        await consumeCartReservations(tx, cartId, order.id)

        if (t.promoCode) {
          /* Take one use of the code inside the order, with the code row
             locked: two checkouts at the same moment cannot both have the
             last use, nor both pass the once-per-customer check. */
          const [code] = await tx.select().from(promoCodes).where(eq(promoCodes.id, t.promoCode.id)).for('update')
          if (!code || (code.maxUses !== null && code.timesUsed >= code.maxUses)) {
            throw new CheckoutError('That promo code has just been fully redeemed.', 'PROMO_INVALID')
          }
          if (code.maxUsesPerUser !== null) {
            const [used] = await tx
              .select({ n: sql<number>`count(*)`.mapWith(Number) })
              .from(promoCodeUsage)
              .where(
                and(
                  eq(promoCodeUsage.promoCodeId, code.id),
                  userId
                    ? sql`(lower(${promoCodeUsage.email}) = ${input.email.toLowerCase()} or ${promoCodeUsage.userId} = ${userId})`
                    : sql`lower(${promoCodeUsage.email}) = ${input.email.toLowerCase()}`,
                ),
              )
            if (used && used.n >= code.maxUsesPerUser) {
              throw new CheckoutError('You have already used that promo code.', 'PROMO_INVALID')
            }
          }
          await tx.update(promoCodes).set({ timesUsed: sql`${promoCodes.timesUsed} + 1` }).where(eq(promoCodes.id, code.id))
          await tx.insert(promoCodeUsage).values({
            promoCodeId: t.promoCode.id,
            orderId: order.id,
            userId,
            email: input.email.toLowerCase(),
            discountCents: t.promoCode.discountCents,
          })
        }

        await tx.insert(payments).values({
          orderId: order.id,
          provider: input.paymentMethod === 'card' ? 'stripe' : 'cod',
          status: 'PENDING',
          amountCents: t.totalCents,
          currency: t.currency,
        })

        await tx.delete(cartItems).where(eq(cartItems.cartId, cartId))
        await tx.update(carts).set({ appliedPromoCodeId: null, updatedAt: now }).where(eq(carts.id, cartId))
        return order
      })
    } catch (err) {
      if (isUniqueViolation(err, 'orders_number_unique')) continue
      if (err instanceof InventoryError) {
        throw new CheckoutError('Your bag timed out while you were paying. Check your bag and try again.', 'OUT_OF_STOCK')
      }
      throw err
    }
  }
  if (!created) throw new Error('Could not allocate an order number.')

  /* Not part of the sale: a failure here must not undo the order. */
  if (userId && input.saveAddress && input.shippingAddress && option.kind === 'SHIPPING') {
    await saveAddressIfNew(userId, input.shippingAddress).catch((err) => console.error('[orders] address not saved', err))
  }
  await afterOrderPlaced(created.id)

  const order = { orderNumber: created.orderNumber, userId, accessToken, locale }
  if (input.paymentMethod === 'card') {
    try {
      const url = await startCardPayment(created.id)
      return { orderId: created.id, orderNumber: created.orderNumber, redirectUrl: url }
    } catch (err) {
      console.error('[orders] Stripe session failed', err)
      /* The order exists and holds the stock; its page offers "Pay now" again. */
      return { orderId: created.id, orderNumber: created.orderNumber, redirectUrl: `${orderUrl(order)}${order.userId ? '?' : '&'}payment=failed` }
    }
  }
  return { orderId: created.id, orderNumber: created.orderNumber, redirectUrl: `${orderUrl(order)}${order.userId ? '?' : '&'}placed=1` }
}

async function afterOrderPlaced(orderId: string) {
  try {
    const { orderCreated } = await import('@/lib/automations')
    await orderCreated(orderId)
  } catch (err) {
    console.error('[orders] order emails not scheduled', err)
  }
}

async function notifyStatus(orderId: string, status: string, extra: { trackingNumber?: string; trackingUrl?: string } = {}) {
  try {
    const { orderStatusChanged } = await import('@/lib/automations')
    await orderStatusChanged(orderId, status, extra)
  } catch (err) {
    console.error('[orders] status email not scheduled', err)
  }
}

async function saveAddressIfNew(userId: string, a: OrderAddress) {
  const existing = await db.select().from(addresses).where(eq(addresses.userId, userId))
  const same = existing.find(
    (e) => e.line1.toLowerCase() === a.line1.toLowerCase() && e.postalCode === a.postalCode && e.city.toLowerCase() === a.city.toLowerCase(),
  )
  if (same) return
  await db.insert(addresses).values({
    userId,
    recipientName: a.recipientName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 || null,
    city: a.city,
    postalCode: a.postalCode,
    country: a.country || 'CY',
    isDefault: existing.length === 0,
  })
}

/* ============================================================== stripe == */

/** A Stripe Checkout page for an unpaid card order. Called at checkout and
 *  again from the order page's "Pay now" if the first attempt was abandoned. */
export async function startCardPayment(orderId: string): Promise<string> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) throw new OrderError('That order does not exist.')
  if (order.status !== 'PAYMENT_PENDING') throw new OrderError('This order does not need paying.')
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))

  const back = siteUrl(orderUrl(order))
  const join = back.includes('?') ? '&' : '?'
  const description = items
    .map((i) => `${i.quantity} × ${i.productName}${i.colorName ? ` ${i.colorName}` : ''}${i.size ? ` ${i.size}` : ''}`)
    .join(', ')
    .slice(0, 480)

  /* One line for the whole order, for the exact total: discounts and delivery
     are already in it, so Stripe can never charge a different number. */
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: order.id,
    locale: stripeLocale(order.locale),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: order.currency.toLowerCase(),
          unit_amount: order.totalCents,
          product_data: { name: `${BRAND.name} order ${order.orderNumber}`, description: description || undefined },
        },
      },
    ],
    metadata: { orderId: order.id, orderNumber: order.orderNumber },
    payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.orderNumber } },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    success_url: `${back}${join}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}${join}payment=cancelled`,
  })

  await db
    .update(payments)
    .set({ providerSessionId: session.id, updatedAt: new Date() })
    .where(and(eq(payments.orderId, orderId), eq(payments.provider, 'stripe'), eq(payments.status, 'PENDING')))

  if (!session.url) throw new Error('Stripe returned no payment page.')
  return session.url
}

/** Ask Stripe about a Checkout session and record the payment if it went
 *  through. Safe to call any number of times, from the webhook and from the
 *  return page alike. */
export async function syncCheckoutSession(sessionId: string): Promise<'paid' | 'unpaid' | 'unknown'> {
  const session = await stripe().checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent.latest_charge'],
  })
  const orderId = session.metadata?.orderId ?? session.client_reference_id
  if (!orderId) return 'unknown'
  if (session.payment_status !== 'paid') return 'unpaid'

  const pi = typeof session.payment_intent === 'object' ? session.payment_intent : null
  const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  const card = charge?.payment_method_details?.card ?? null

  const changed = await db.transaction(async (tx) => {
    const [order] = await tx
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
    if (!order) return false

    const now = new Date()
    const [payment] = await tx
      .update(payments)
      .set({
        status: 'SUCCEEDED',
        providerPaymentId: pi?.id ?? (typeof session.payment_intent === 'string' ? session.payment_intent : null),
        providerSessionId: session.id,
        cardBrand: card?.brand ?? null,
        cardLast4: card?.last4 ?? null,
        paidAt: now,
        updatedAt: now,
      })
      .where(and(eq(payments.orderId, orderId), eq(payments.provider, 'stripe'), sql`${payments.status} <> 'SUCCEEDED'`))
      .returning({ id: payments.id })
    if (!payment) return false

    if (order.status === 'PAYMENT_PENDING') {
      await tx.update(orders).set({ status: 'PAID', paidAt: now, updatedAt: now }).where(eq(orders.id, orderId))
      return true
    }
    /* Paid after the order was cancelled for not being paid in time: keep
       the money on record and tell staff, rather than quietly reviving it. */
    await tx
      .update(orders)
      .set({
        paidAt: now,
        adminNote: sql`concat_ws(E'\\n', ${orders.adminNote}, ${'Card payment arrived after the order was ' + order.status.toLowerCase() + '. Refund it, or reinstate the order.'}::text)`,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId))
    return false
  })

  if (changed) {
    await safely(() => issueInvoice(orderId), 'invoice')
    await notifyStatus(orderId, 'PAID')
  }
  return 'paid'
}

/** Stripe webhook events, each handled once. */
export async function handleStripeEvent(event: { id: string; type: string; data: { object: unknown } }) {
  const [fresh] = await db
    .insert(webhookEvents)
    .values({ id: event.id, provider: 'stripe', type: event.type, payload: null })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id })
  if (!fresh) return 'duplicate'

  try {
    await applyStripeEvent(event)
  } catch (err) {
    /* Forget we saw it, so Stripe's retry is handled instead of skipped as a
       duplicate. Every step below is safe to run twice. */
    await db.delete(webhookEvents).where(eq(webhookEvents.id, event.id)).catch(() => undefined)
    throw err
  }
  return 'handled'
}

async function applyStripeEvent(event: { id: string; type: string; data: { object: unknown } }) {
  const obj = event.data.object as { id?: string; metadata?: Record<string, string> | null; client_reference_id?: string | null }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (obj.id) await syncCheckoutSession(obj.id)
  } else if (event.type === 'checkout.session.expired') {
    const orderId = obj.metadata?.orderId ?? obj.client_reference_id
    if (orderId) {
      /* Only if nothing else has happened to it since. */
      const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId))
      const [newer] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.providerSessionId, obj.id ?? ''), eq(payments.status, 'PENDING')))
      if (order?.status === 'PAYMENT_PENDING' && newer) {
        await cancelOrder(orderId, { reason: 'The card payment was not completed.', by: null })
      }
    }
  } else if (event.type === 'charge.refunded') {
    /* Refunds made in the Stripe dashboard show up on the order too. */
    const charge = obj as { payment_intent?: string | null; amount_refunded?: number }
    if (charge.payment_intent) {
      await db
        .update(payments)
        .set({
          refundedCents: charge.amount_refunded ?? 0,
          status: sql`case when ${charge.amount_refunded ?? 0} >= ${payments.amountCents} then 'REFUNDED'::payment_status else 'PARTIALLY_REFUNDED'::payment_status end`,
          updatedAt: new Date(),
        })
        .where(eq(payments.providerPaymentId, charge.payment_intent))
      const [p] = await db
        .select({ orderId: payments.orderId })
        .from(payments)
        .where(eq(payments.providerPaymentId, charge.payment_intent))
      if (p) await safely(() => creditRefunds(p.orderId, 'Refund made in Stripe'), 'credit note')
    }
  }
}

/* ========================================================== lifecycle == */

const OPEN = ['PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP'] as const

/** Cancel an order that has not left the shop, and put its stock back. A
 *  card payment already taken is refunded through Stripe when `refund` is set. */
export async function cancelOrder(
  orderId: string,
  opts: { reason: string; by: { id: string; email: string } | null; refund?: boolean },
) {
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update')
    if (!order) throw new OrderError('That order does not exist.')
    if (!(OPEN as readonly string[]).includes(order.status)) {
      throw new OrderError(`An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot be cancelled.`)
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    for (const i of items) if (i.variantId) await restock(tx, i.variantId, i.quantity)

    /* A cancelled order gives its promo code use back. */
    const uses = await tx.delete(promoCodeUsage).where(eq(promoCodeUsage.orderId, orderId)).returning({ codeId: promoCodeUsage.promoCodeId })
    for (const u of uses) {
      await tx
        .update(promoCodes)
        .set({ timesUsed: sql`greatest(${promoCodes.timesUsed} - 1, 0)` })
        .where(eq(promoCodes.id, u.codeId))
    }

    const now = new Date()
    await tx
      .update(orders)
      .set({
        status: 'CANCELLED',
        cancelledAt: now,
        updatedAt: now,
        adminNote: sql`concat_ws(E'\\n', ${orders.adminNote}, ${`Cancelled: ${opts.reason}`}::text)`,
      })
      .where(eq(orders.id, orderId))
    await tx
      .update(payments)
      .set({ status: 'CANCELLED', updatedAt: now })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')))
    const [paid] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
    return { order, paid }
  })

  if (opts.refund && result.paid) await refundPayment(result.paid.id)

  /* Unused Stripe pages are closed so the customer cannot pay a cancelled order. */
  const pending = await db
    .select({ sessionId: payments.providerSessionId })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.provider, 'stripe'), eq(payments.status, 'CANCELLED')))
  for (const p of pending) {
    if (p.sessionId && stripeEnabled()) await stripe().checkout.sessions.expire(p.sessionId).catch(() => undefined)
  }
  await notifyStatus(orderId, 'CANCELLED')
}

async function refundPayment(paymentId: string) {
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId))
  if (!p) return
  if (p.provider === 'stripe' && p.providerPaymentId && stripeEnabled()) {
    await stripe().refunds.create({ payment_intent: p.providerPaymentId })
  }
  await db
    .update(payments)
    .set({ status: 'REFUNDED', refundedCents: p.amountCents, updatedAt: new Date() })
    .where(eq(payments.id, paymentId))
  await safely(() => creditRefunds(p.orderId), 'credit note')
}

/** Refund a delivered or shipped order (a return). Optionally puts the items
 *  back on the shelf, when they came back unopened. */
export async function refundOrder(orderId: string, opts: { restock: boolean; by: { id: string; email: string } }) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new OrderError('That order does not exist.')
  if (order.status === 'REFUNDED' || order.status === 'CANCELLED') throw new OrderError('This order is already closed.')
  const [paid] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'SUCCEEDED')))
  if (!paid) throw new OrderError('Nothing has been paid on this order yet. Cancel it instead.')
  await refundPayment(paid.id)
  await db.transaction(async (tx) => {
    if (opts.restock) {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId))
      for (const i of items) if (i.variantId) await restock(tx, i.variantId, i.quantity)
    }
    await tx.update(orders).set({ status: 'REFUNDED', updatedAt: new Date() }).where(eq(orders.id, orderId))
  })
}

/* The steps staff move an order through, and where each may go next. */
const NEXT: Record<string, string[]> = {
  PENDING: ['PROCESSING'],
  PAID: ['PROCESSING'],
  PROCESSING: ['READY_FOR_PICKUP', 'SHIPPED'],
  READY_FOR_PICKUP: ['DELIVERED'],
  SHIPPED: ['DELIVERED'],
}

export function nextSteps(status: string, kind: 'PICKUP' | 'SHIPPING'): string[] {
  const all = NEXT[status] ?? []
  return all.filter((s) => (kind === 'PICKUP' ? s !== 'SHIPPED' : s !== 'READY_FOR_PICKUP'))
}

export async function setOrderStatus(
  orderId: string,
  next: 'PROCESSING' | 'READY_FOR_PICKUP' | 'SHIPPED' | 'DELIVERED',
  extra: { trackingNumber?: string; trackingUrl?: string } = {},
) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new OrderError('That order does not exist.')
  if (!nextSteps(order.status, order.deliveryKind).includes(next)) {
    throw new OrderError(`An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot go to ${next.toLowerCase().replace(/_/g, ' ')}.`)
  }
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        status: next,
        updatedAt: now,
        ...(next === 'SHIPPED'
          ? { shippedAt: now, trackingNumber: extra.trackingNumber || null, trackingUrl: extra.trackingUrl || null }
          : {}),
        ...(next === 'DELIVERED' ? { deliveredAt: now } : {}),
      })
      /* Only if nobody else moved it meanwhile (two staff, two clicks). */
      .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
      .returning({ id: orders.id })
      .then((rows) => {
        if (!rows.length) throw new OrderError('Someone else just changed this order. The page will show its new status.')
      })
    /* Cash on delivery: handing the parcel over is when the money arrives. */
    if (next === 'DELIVERED' && order.paymentMethod === 'cod') {
      await tx
        .update(payments)
        .set({ status: 'SUCCEEDED', paidAt: now, updatedAt: now })
        .where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')))
      await tx.update(orders).set({ paidAt: now }).where(eq(orders.id, orderId))
    }
  })
  if (next === 'DELIVERED' && order.paymentMethod === 'cod') await safely(() => issueInvoice(orderId), 'invoice')
  await notifyStatus(orderId, next, extra)
  if (next === 'PROCESSING' && order.status === 'PENDING') {
    /* A confirmed cash order: "we have it and are preparing it". */
    try {
      const { orderEvent } = await import('@/lib/automations')
      await orderEvent(orderId, 'order_confirmed', 'Confirmed by the shop.')
    } catch (err) {
      console.error('[orders] confirm email not scheduled', err)
    }
  }
}

/** Cash received before delivery (e.g. paid at the counter). */
export async function markCashReceived(orderId: string) {
  const now = new Date()
  const [p] = await db
    .update(payments)
    .set({ status: 'SUCCEEDED', paidAt: now, updatedAt: now })
    .where(and(eq(payments.orderId, orderId), eq(payments.provider, 'cod'), eq(payments.status, 'PENDING')))
    .returning({ id: payments.id })
  if (!p) throw new OrderError('There is no unpaid cash payment on this order.')
  await db.update(orders).set({ paidAt: now, updatedAt: now }).where(eq(orders.id, orderId))
  await safely(() => issueInvoice(orderId), 'invoice')
}

export async function setAdminNote(orderId: string, note: string) {
  await db.update(orders).set({ adminNote: note.trim() || null, updatedAt: new Date() }).where(eq(orders.id, orderId))
}

/** Card orders nobody paid for within the hour: cancelled, stock returned. */
export async function sweepUnpaidOrders(now = new Date()) {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.status, 'PAYMENT_PENDING'), lt(orders.createdAt, new Date(now.getTime() - 75 * 60 * 1000))))
    .limit(50)
  let cancelled = 0
  for (const o of stale) {
    try {
      await cancelOrder(o.id, { reason: 'Not paid within an hour.', by: null })
      cancelled++
    } catch (err) {
      console.error('[orders] unpaid sweep failed for', o.id, err)
    }
  }
  return cancelled
}

/* ============================================================== reading == */

export type OrderSummary = {
  id: string
  orderNumber: string
  status: string
  totalCents: number
  currency: string
  createdAt: Date
  itemCount: number
  paymentMethod: string
  firstImage: string | null
}

export async function listOrdersForUser(userId: string): Promise<OrderSummary[]> {
  const rows = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalCents: orders.totalCents,
      currency: orders.currency,
      createdAt: orders.createdAt,
      paymentMethod: orders.paymentMethod,
      itemCount: sql<number>`(select coalesce(sum(quantity), 0) from order_items oi where oi.order_id = "orders"."id")`.mapWith(Number),
      firstImage: sql<string | null>`(select image_url from order_items oi where oi.order_id = "orders"."id" limit 1)`,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
  return rows
}

export type OrderDetail = Awaited<ReturnType<typeof loadOrder>>

async function loadOrder(where: ReturnType<typeof eq>) {
  const [order] = await db.select().from(orders).where(where).limit(1)
  if (!order) return null
  const [items, pays] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.productName)),
    db.select().from(payments).where(eq(payments.orderId, order.id)).orderBy(desc(payments.createdAt)),
  ])
  /* Link each line back to its product while it still exists. */
  const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is string => Boolean(x)))]
  const slugs = productIds.length
    ? await db.select({ id: products.id, slug: products.slug, isActive: products.isActive }).from(products).where(inArray(products.id, productIds))
    : []
  const slugOf = new Map(slugs.filter((s) => s.isActive).map((s) => [s.id, s.slug]))
  return {
    ...order,
    items: items.map((i) => ({ ...i, productSlug: i.productId ? (slugOf.get(i.productId) ?? null) : null })),
    payments: pays,
  }
}

export async function getOrderForUser(orderNumber: string, userId: string) {
  const o = await loadOrder(eq(orders.orderNumber, orderNumber))
  return o && o.userId === userId ? o : null
}

/** For the private link in the confirmation and emails. Compared in constant
 *  time so the token cannot be guessed byte by byte. */
export async function getOrderByToken(orderNumber: string, token: string) {
  if (!token || token.length !== 48) return null
  const o = await loadOrder(eq(orders.orderNumber, orderNumber))
  if (!o?.accessToken) return null
  const { timingSafeEqual } = await import('node:crypto')
  const a = Buffer.from(o.accessToken)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b) ? o : null
}

export async function getOrderById(id: string) {
  return loadOrder(eq(orders.id, id))
}

export type PaymentRow = {
  id: string
  orderNumber: string
  provider: string
  status: string
  amountCents: number
  refundedCents: number
  currency: string
  cardBrand: string | null
  cardLast4: string | null
  paidAt: Date | null
  createdAt: Date
}

export async function listPaymentsForUser(userId: string): Promise<PaymentRow[]> {
  return db
    .select({
      id: payments.id,
      orderNumber: orders.orderNumber,
      provider: payments.provider,
      status: payments.status,
      amountCents: payments.amountCents,
      refundedCents: payments.refundedCents,
      currency: payments.currency,
      cardBrand: payments.cardBrand,
      cardLast4: payments.cardLast4,
      paidAt: payments.paidAt,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .where(eq(orders.userId, userId))
    .orderBy(desc(payments.createdAt))
}

/** "Buy again": everything from a past order that is still sold goes back in
 *  the bag, as much as is in stock. Says what could not be added. */
export async function reorder(orderId: string, cartId: string) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const ids = items.map((i) => i.variantId).filter((x): x is string => Boolean(x))
  const live = ids.length
    ? await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(and(inArray(productVariants.id, ids), eq(productVariants.isActive, true), eq(products.isActive, true)))
    : []
  const liveIds = new Set(live.map((l) => l.id))
  const inBag = await db.select({ variantId: cartItems.variantId, quantity: cartItems.quantity }).from(cartItems).where(eq(cartItems.cartId, cartId))
  const have = new Map(inBag.map((b) => [b.variantId, b.quantity]))

  let added = 0
  const missed: string[] = []
  for (const i of items) {
    if (!i.variantId || !liveIds.has(i.variantId)) {
      missed.push(i.productName)
      continue
    }
    try {
      await addToCart(cartId, i.variantId, Math.min(20, (have.get(i.variantId) ?? 0) + i.quantity))
      added++
    } catch {
      missed.push(i.productName)
    }
  }
  return { added, missed }
}

/* ================================================================ admin == */

export type AdminOrderRow = {
  id: string
  orderNumber: string
  customerName: string
  email: string
  status: string
  paymentMethod: string
  channel: string
  paymentStatus: string | null
  deliveryKind: string
  totalCents: number
  createdAt: Date
  itemCount: number
}

export async function listAdminOrders(f: { status?: string; q?: string; page?: number; userId?: string }) {
  const pageSize = 30
  const page = Math.max(1, f.page ?? 1)
  const conds = []
  if (f.status === 'open') conds.push(inArray(orders.status, ['PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP']))
  else if (f.status && /^[A-Z_]+$/.test(f.status)) conds.push(sql`${orders.status} = ${f.status}`)
  if (f.userId) conds.push(eq(orders.userId, f.userId))
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`
    conds.push(or(ilike(orders.orderNumber, q), ilike(orders.email, q), ilike(orders.customerName, q), ilike(orders.phone, q))!)
  }
  const where = conds.length ? and(...conds) : undefined
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        email: orders.email,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        channel: orders.channel,
        paymentStatus: sql<string | null>`(select status::text from payments p where p.order_id = "orders"."id" order by p.created_at desc limit 1)`,
        deliveryKind: orders.deliveryKind,
        totalCents: orders.totalCents,
        createdAt: orders.createdAt,
        itemCount: sql<number>`(select coalesce(sum(quantity), 0) from order_items oi where oi.order_id = "orders"."id")`.mapWith(Number),
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(orders).where(where),
  ])
  return { rows: rows as AdminOrderRow[], total, page, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function orderCounts() {
  const res = await db.execute<{ status: string; n: number }>(sql`select status::text as status, count(*)::int as n from orders group by status`)
  const out: Record<string, number> = {}
  for (const r of res.rows) out[r.status] = Number(r.n)
  return out
}

/* ------------------------------------------------------------ customers -- */

export async function listCustomers(f: { q?: string; page?: number }) {
  const pageSize = 30
  const page = Math.max(1, f.page ?? 1)
  const conds = [eq(users.role, 'CUSTOMER')]
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`
    conds.push(or(ilike(users.email, q), ilike(users.firstName, q), ilike(users.lastName, q), ilike(users.phone, q))!)
  }
  const where = and(...conds)
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        phone: users.phone,
        isActive: users.isActive,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        orders: sql<number>`(select count(*) from orders o where o.user_id = "users"."id")`.mapWith(Number),
        spentCents: sql<number>`(select coalesce(sum(total_cents), 0) from orders o where o.user_id = "users"."id" and o.status in ('PAID','PROCESSING','READY_FOR_PICKUP','SHIPPED','DELIVERED'))`.mapWith(Number),
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(users).where(where),
  ])
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getCustomer(id: string) {
  const [user] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      locale: users.locale,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, id))
  if (!user) return null
  const [addr, orderList, pays] = await Promise.all([
    db.select().from(addresses).where(eq(addresses.userId, id)).orderBy(desc(addresses.isDefault)),
    listAdminOrders({ userId: id, page: 1 }),
    listPaymentsForUser(id),
  ])
  return { ...user, addresses: addr, orders: orderList.rows, payments: pays }
}

export async function setCustomerActive(id: string, isActive: boolean) {
  const [row] = await db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.role, 'CUSTOMER')))
    .returning({ id: users.id })
  if (!row) throw new OrderError('That customer does not exist.')
  if (!isActive) {
    const { revokeAllSessionsForUser } = await import('@/lib/auth/session')
    await revokeAllSessionsForUser(id)
  }
}

/* The first product image, for order lines written before images existed. */
export async function firstImageFor(productId: string) {
  const [img] = await db
    .select({ url: productImages.url })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position))
    .limit(1)
  return img?.url ?? null
}
