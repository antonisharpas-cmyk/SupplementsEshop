/* ============================================================================
 * Automated emails: what triggers them, when they go, and why one didn't.
 *
 * Every automated email is a row in `email_jobs` before it is anything else:
 *
 *   trigger ──► job (SCHEDULED, due at scheduledAt, with the reason)
 *                 │  the worker, every 30 s (instrumentation.ts → runAutomations)
 *                 ▼
 *              checks again, at send time ──► SENT | SKIPPED (why) | FAILED
 *
 * Checking at send time, not at trigger time, is the point: four hours after a
 * bag was left the customer may have bought it, emptied it, unsubscribed, or
 * the pieces may have sold out. The job records which, in words, so the admin
 * can see why an email did or did not go ("skipped: bought it at 16:10").
 *
 * The rules, per kind:
 *
 *   marketing   needs a confirmed newsletter subscription (consent) and
 *               carries its unsubscribe link; respects the frequency limit —
 *               no two marketing emails to one address within
 *               `marketing_cooldown_hours` (Settings).
 *   lifecycle   follows something the customer did; can be switched off.
 *   essential   order and account messages; cannot be switched off, only
 *               de-duplicated (one "shipped" per order, ever).
 *
 * Every job that must only ever happen once has a `dedupeKey`
 * ('order:<id>:order_shipped'); the database's unique index makes a second
 * trigger a no-op, however it arrives.
 *
 * Future triggers (first order, price drop, …) are a new handler here and a
 * template in email-templates.ts — nothing else changes.
 * ========================================================================== */

import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  carts,
  cartItems,
  emailJobs,
  emailLog,
  newsletterSubscribers,
  orderItems,
  orders,
  products,
  stockAlerts,
  users,
} from '@/db/schema'
import { BRAND } from '@/config/brand'
import { siteUrl } from '@/lib/email'
import { tField } from '@/i18n/field'
import { formatMoney } from '@/lib/pricing'
import { getSettings } from '@/lib/settings'
import { templateDef, type Item, type TemplateKey, type Vars } from '@/lib/email-templates'
import { asEmailLocale, sendTemplate, templateState } from '@/lib/mailer'

type Job = typeof emailJobs.$inferSelect

const minutes = (n: number) => n * 60_000
const hours = (n: number) => n * 3_600_000
const at = (d: Date, locale = 'en') =>
  d.toLocaleString(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Nicosia',
  })

/** No second abandoned-bag reminder to the same customer within this. */
export const ABANDONED_REPEAT_DAYS = 7

/* =============================================================== jobs == */

export async function scheduleJob(j: {
  automation: TemplateKey
  email: string
  userId?: string | null
  name?: string | null
  locale?: string | null
  context?: Record<string, unknown>
  dedupeKey?: string | null
  triggeredAt?: Date
  scheduledAt?: Date
  reason: string
}): Promise<Job | null> {
  const [row] = await db
    .insert(emailJobs)
    .values({
      automation: j.automation,
      email: j.email.toLowerCase(),
      userId: j.userId ?? null,
      recipientName: j.name?.slice(0, 160) ?? null,
      locale: asEmailLocale(j.locale),
      context: j.context ?? {},
      dedupeKey: j.dedupeKey ?? null,
      triggeredAt: j.triggeredAt ?? new Date(),
      scheduledAt: j.scheduledAt ?? new Date(),
      reason: j.reason.slice(0, 1000),
    })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

async function finish(job: Job, status: 'SENT' | 'SKIPPED' | 'CANCELLED' | 'FAILED', outcome: string, extra: Partial<Job> = {}) {
  await db
    .update(emailJobs)
    .set({ status, outcome: outcome.slice(0, 1000), processedAt: new Date(), ...extra })
    .where(eq(emailJobs.id, job.id))
}

/** Cancel scheduled jobs matching a condition, saying why. */
async function cancelScheduled(where: ReturnType<typeof and>, why: string) {
  await db
    .update(emailJobs)
    .set({ status: 'CANCELLED', outcome: why, processedAt: new Date() })
    .where(and(eq(emailJobs.status, 'SCHEDULED'), where))
}

/* ------------------------------------------------------ shared checks -- */

/** A confirmed subscriber for this address — the consent marketing needs —
 *  and the unsubscribe links that go with it. */
async function marketingConsent(email: string) {
  const [sub] = await db
    .select({ id: newsletterSubscribers.id, status: newsletterSubscribers.status, locale: newsletterSubscribers.locale })
    .from(newsletterSubscribers)
    .where(sql`lower(${newsletterSubscribers.email}) = ${email.toLowerCase()}`)
    .limit(1)
  if (!sub || sub.status !== 'SUBSCRIBED') return null
  const { unsubscribeUrl, oneClickUrl } = await import('@/lib/newsletter')
  const locale = asEmailLocale(sub.locale)
  return { pageUrl: unsubscribeUrl(sub.id, locale), oneClickUrl: oneClickUrl(sub.id) }
}

/** The frequency limit: when the last marketing email reached this address,
 *  if it was within the cooldown. */
export async function recentMarketing(email: string, now = new Date()): Promise<Date | null> {
  const { marketing_cooldown_hours } = await getSettings(['marketing_cooldown_hours'])
  if (marketing_cooldown_hours <= 0) return null
  const [row] = await db
    .select({ at: emailLog.createdAt })
    .from(emailLog)
    .where(
      and(
        sql`lower(${emailLog.toEmail}) = ${email.toLowerCase()}`,
        eq(emailLog.category, 'marketing'),
        sql`${emailLog.status} <> 'failed'`,
        gt(emailLog.createdAt, new Date(now.getTime() - hours(marketing_cooldown_hours))),
      ),
    )
    .orderBy(desc(emailLog.createdAt))
    .limit(1)
  return row?.at ?? null
}

async function boughtSince(userId: string | null, email: string, since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ at: orders.createdAt })
    .from(orders)
    .where(
      and(
        or(userId ? eq(orders.userId, userId) : sql`false`, sql`lower(${orders.email}) = ${email.toLowerCase()}`),
        gt(orders.createdAt, since),
        sql`${orders.status} not in ('CANCELLED')`,
      ),
    )
    .limit(1)
  return row?.at ?? null
}

/* ============================================================ worker == */

type Prepared = { send: Vars; to?: string; unsubscribe?: { pageUrl: string; oneClickUrl: string } } | { skip: string }

const HANDLERS: Partial<Record<TemplateKey, (job: Job, now: Date) => Promise<Prepared>>> = {
  welcome: prepareWelcome,
  abandoned_bag: (job, now) => prepareAbandoned(job, now, false),
  abandoned_bag_followup: (job, now) => prepareAbandoned(job, now, true),
  back_in_stock: prepareBackInStock,
  review_request: prepareOrder,
  order_received: prepareOrder,
  payment_confirmed: prepareOrder,
  order_confirmed: prepareOrder,
  order_preparing: prepareOrder,
  order_ready_for_pickup: prepareOrder,
  order_shipped: prepareOrder,
  order_delivered: prepareOrder,
  order_completed: prepareOrder,
  order_cancelled: prepareOrder,
  tier_upgraded: prepareTier,
  tier_near: prepareTier,
  tier_expiring: prepareTier,
  tier_last_call: prepareTier,
  tier_downgraded: prepareTier,
}

/**
 * Handle every job that is due. Safe to run from several places at once:
 * each job is claimed with FOR UPDATE SKIP LOCKED, so two workers never
 * take the same one.
 */
export async function processDueJobs(now = new Date(), limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const claimed = await db.execute<{ id: string }>(sql`
    update email_jobs set processed_at = ${now}
    where id in (
      select id from email_jobs
      where status = 'SCHEDULED' and scheduled_at <= ${now}
        and (processed_at is null or processed_at < ${new Date(now.getTime() - minutes(10))})
      order by scheduled_at
      limit ${limit}
      for update skip locked
    )
    returning id`)
  const ids = claimed.rows.map((r) => r.id)
  if (!ids.length) return { sent: 0, skipped: 0, failed: 0 }
  const jobs = await db.select().from(emailJobs).where(inArray(emailJobs.id, ids))

  const tally = { sent: 0, skipped: 0, failed: 0 }
  for (const job of jobs) {
    const key = job.automation as TemplateKey
    try {
      const def = templateDef(key)
      const state = await templateState(key)
      if (!state.enabled) {
        await finish(job, 'SKIPPED', 'Switched off in Marketing & Emails.')
        tally.skipped++
        continue
      }
      const handler = HANDLERS[key]
      const prepared: Prepared = handler ? await handler(job, now) : { send: {} }
      if ('skip' in prepared) {
        await finish(job, 'SKIPPED', prepared.skip)
        tally.skipped++
        continue
      }
      let unsubscribe = prepared.unsubscribe
      if (def.category === 'marketing') {
        unsubscribe ??= (await marketingConsent(job.email)) ?? undefined
        if (!unsubscribe) {
          await finish(job, 'SKIPPED', 'No marketing consent: not a confirmed subscriber, or unsubscribed.')
          tally.skipped++
          continue
        }
        const last = await recentMarketing(job.email, now)
        if (last) {
          await finish(job, 'SKIPPED', `Frequency limit: another marketing email went out ${at(last)}.`)
          tally.skipped++
          continue
        }
      }
      const result = await sendTemplate(key, {
        to: prepared.to ?? job.email,
        locale: job.locale,
        vars: { customer_name: job.recipientName ?? '', ...prepared.send },
        unsubscribe,
        relatedId: job.id,
      })
      if (result.status === 'disabled') {
        await finish(job, 'SKIPPED', 'Switched off in Marketing & Emails.')
        tally.skipped++
      } else if (result.status === 'failed') {
        await finish(job, 'FAILED', result.detail ?? 'The email service refused it.', { subject: result.subject, emailLogId: result.logId ?? null })
        tally.failed++
      } else {
        await finish(job, 'SENT', result.status === 'logged' ? 'Written to the log (no email service configured).' : 'Sent.', {
          subject: result.subject,
          emailLogId: result.logId ?? null,
        })
        tally.sent++
        await afterSent(job, now)
      }
    } catch (err) {
      console.error('[automations] job failed', job.id, err)
      await finish(job, 'FAILED', err instanceof Error ? err.message : 'Unexpected error.')
      tally.failed++
    }
  }
  return tally
}

/** What a sent email sets in motion. */
async function afterSent(job: Job, now: Date) {
  if (job.automation === 'abandoned_bag') {
    const follow = await templateState('abandoned_bag_followup')
    if (!follow.enabled || follow.delayMinutes === null) return
    const due = new Date(Math.max(job.triggeredAt.getTime() + minutes(follow.delayMinutes), now.getTime() + minutes(60)))
    await scheduleJob({
      automation: 'abandoned_bag_followup',
      email: job.email,
      userId: job.userId,
      name: job.recipientName,
      locale: job.locale,
      context: { ...job.context, firstJobId: job.id },
      dedupeKey: `abandoned_bag_followup:${job.id}`,
      triggeredAt: job.triggeredAt,
      scheduledAt: due,
      reason: `First reminder sent ${at(now)}; follow-up if the bag is still untouched.`,
    })
  }
  if (job.automation === 'back_in_stock' && typeof job.context.alertId === 'string') {
    await db.update(stockAlerts).set({ notifiedAt: now }).where(eq(stockAlerts.id, job.context.alertId))
  }
  if (job.automation === 'order_delivered' && typeof job.context.orderId === 'string') {
    const review = await templateState('review_request')
    if (review.enabled && review.delayMinutes !== null) {
      await scheduleJob({
        automation: 'review_request',
        email: job.email,
        userId: job.userId,
        name: job.recipientName,
        locale: job.locale,
        context: { orderId: job.context.orderId },
        dedupeKey: `order:${job.context.orderId}:review_request`,
        scheduledAt: new Date(now.getTime() + minutes(review.delayMinutes)),
        reason: 'Order delivered.',
      })
    }
  }
}

/* ========================================================= triggers == */

/* ------------------------------------------------------------ welcome -- */

export async function scheduleWelcome(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return null
  return scheduleJob({
    automation: 'welcome',
    email: user.email,
    userId,
    name: user.firstName,
    locale: user.locale,
    dedupeKey: `welcome:${userId}`,
    reason: 'Email verified, account created.',
  })
}

async function prepareWelcome(job: Job): Promise<Prepared> {
  const [sub] = await db
    .select({ status: newsletterSubscribers.status })
    .from(newsletterSubscribers)
    .where(sql`lower(${newsletterSubscribers.email}) = ${job.email}`)
    .limit(1)
  const locale = asEmailLocale(job.locale)
  const note = {
    en: 'You’re also on the list for new arrivals, you can unsubscribe from any of those emails.',
    el: 'Είσαι επίσης στη λίστα για τις νέες αφίξεις, μπορείς να διαγραφείς από οποιοδήποτε από αυτά τα email.',
    ru: 'Вы также подписаны на новости о новинках, отписаться можно в любом из этих писем.',
  }[locale]
  return { send: { newsletter_note: sub?.status === 'SUBSCRIBED' ? note : '' } }
}

/* -------------------------------------------------------- abandoned bag -- */

/**
 * Something changed in a bag. For a signed-in customer's bag, (re)set its
 * reminder to `delay` after this moment; an emptied bag cancels it. Guest
 * bags are left alone — there is no one to write to.
 */
export async function bagChanged(cartId: string, now = new Date()) {
  const [cart] = await db.select({ id: carts.id, userId: carts.userId }).from(carts).where(eq(carts.id, cartId)).limit(1)
  if (!cart?.userId) return
  const [{ n }] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)`.mapWith(Number) })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
  const forCart = sql`${emailJobs.context}->>'cartId' = ${cartId}`
  const kinds = inArray(emailJobs.automation, ['abandoned_bag', 'abandoned_bag_followup'])

  if (n === 0) {
    await cancelScheduled(and(kinds, forCart), 'The bag was emptied.')
    return
  }
  /* A change starts a new episode: the old follow-up no longer fits. */
  await cancelScheduled(and(eq(emailJobs.automation, 'abandoned_bag_followup'), forCart), 'The bag changed after the first reminder.')

  const state = await templateState('abandoned_bag')
  if (!state.enabled || state.delayMinutes === null) {
    await cancelScheduled(and(eq(emailJobs.automation, 'abandoned_bag'), forCart), 'Switched off in Marketing & Emails.')
    return
  }
  const [user] = await db
    .select({ email: users.email, firstName: users.firstName, locale: users.locale, verified: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, cart.userId))
    .limit(1)
  if (!user?.verified) return

  const due = new Date(now.getTime() + minutes(state.delayMinutes))
  const reason = `${n} item${n === 1 ? '' : 's'} in the bag, last changed ${at(now)}.`
  const [existing] = await db
    .select({ id: emailJobs.id })
    .from(emailJobs)
    .where(and(eq(emailJobs.status, 'SCHEDULED'), eq(emailJobs.automation, 'abandoned_bag'), forCart))
    .limit(1)
  if (existing) {
    /* Move the one reminder rather than piling up a row per click. */
    await db.update(emailJobs).set({ triggeredAt: now, scheduledAt: due, reason }).where(eq(emailJobs.id, existing.id))
    return
  }
  await scheduleJob({
    automation: 'abandoned_bag',
    email: user.email,
    userId: cart.userId,
    name: user.firstName,
    locale: user.locale,
    context: { cartId },
    triggeredAt: now,
    scheduledAt: due,
    reason,
  })
}

async function prepareAbandoned(job: Job, now: Date, followUp: boolean): Promise<Prepared> {
  const cartId = String(job.context.cartId ?? '')
  const [cart] = await db.select().from(carts).where(eq(carts.id, cartId)).limit(1)
  if (!cart || cart.userId !== job.userId) return { skip: 'The bag no longer exists.' }
  /* Anything since the trigger means a newer reminder (or none) is due. */
  if (cart.updatedAt.getTime() > job.triggeredAt.getTime() + 2000) return { skip: `The bag changed ${at(cart.updatedAt)}.` }

  const bought = await boughtSince(job.userId, job.email, job.triggeredAt)
  if (bought) return { skip: `Ordered ${at(bought)}, no reminder needed.` }

  if (!followUp) {
    const [recent] = await db
      .select({ at: emailJobs.processedAt })
      .from(emailJobs)
      .where(
        and(
          eq(emailJobs.automation, 'abandoned_bag'),
          eq(emailJobs.status, 'SENT'),
          job.userId ? eq(emailJobs.userId, job.userId) : eq(emailJobs.email, job.email),
          gt(emailJobs.processedAt, new Date(now.getTime() - ABANDONED_REPEAT_DAYS * 86_400_000)),
        ),
      )
      .limit(1)
    if (recent?.at) return { skip: `A bag reminder already went out ${at(recent.at)}.` }
  } else {
    const firstId = String(job.context.firstJobId ?? '')
    const [first] = await db.select({ status: emailJobs.status }).from(emailJobs).where(eq(emailJobs.id, firstId)).limit(1)
    if (first?.status !== 'SENT') return { skip: 'The first reminder was not sent.' }
  }

  const locale = asEmailLocale(job.locale)
  const { getCartView } = await import('@/lib/cart')
  const view = await getCartView(cartId, { locale, userId: job.userId })
  if (!view.lines.length) return { skip: 'The bag is empty.' }

  /* Only what can still be bought: live, not marked sold out, in stock. */
  const status = await db
    .select({ id: products.id, isActive: products.isActive, availability: products.availability })
    .from(products)
    .where(inArray(products.id, [...new Set(view.lines.map((l) => l.productId))]))
  const ok = new Map(status.map((s) => [s.id, s.isActive && s.availability === 'AVAILABLE']))
  const lines = view.lines.filter((l) => ok.get(l.productId) && l.availableIncludingThisCart > 0)
  if (!lines.length) return { skip: 'Nothing in the bag is available any more.' }

  const items: Item[] = lines.map((l) => ({
    name: tField(l.productName, locale),
    image: l.imageUrl,
    detail: [l.colorName ? tField(l.colorName, locale) : null, l.size].filter(Boolean).join(' · '),
    quantity: l.quantity,
    price: formatMoney(l.lineFinalCents, locale),
  }))
  return { send: { bag_items: items, bag_url: siteUrl(`/${locale}/cart`) } }
}

/* -------------------------------------------------------------- orders -- */

const STATUS_TEMPLATE: Partial<Record<string, TemplateKey>> = {
  PAID: 'payment_confirmed',
  PROCESSING: 'order_preparing',
  READY_FOR_PICKUP: 'order_ready_for_pickup',
  SHIPPED: 'order_shipped',
  DELIVERED: 'order_delivered',
  CANCELLED: 'order_cancelled',
}

/** A new order: its "received" email, and the end of any bag reminder. */
export async function orderCreated(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return
  await cancelScheduled(
    and(
      inArray(emailJobs.automation, ['abandoned_bag', 'abandoned_bag_followup']),
      order.userId ? eq(emailJobs.userId, order.userId) : eq(emailJobs.email, order.email.toLowerCase()),
    ),
    `Ordered (${order.orderNumber}).`,
  )
  /* A card order is not real until Stripe says it is paid: nothing is
     emailed now. The payment email (payment_confirmed) is its confirmation. */
  if (order.paymentMethod === 'card' && !order.paidAt) return
  await orderEvent(orderId, 'order_received', 'Order placed.')
  if (order.paymentMethod === 'cod') await notifyStaffNewOrder(orderId, 'placed')
}

/** "New order" to the shop's own inbox (Settings, support email). */
export async function notifyStaffNewOrder(orderId: string, when: 'placed' | 'paid') {
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
    if (!order || order.channel === 'phone') return
    /* Once per order: cash at placing, card at payment. */
    if ((order.paymentMethod === 'cod') !== (when === 'placed')) return
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
    const { support_email } = await getSettings(['support_email'])
    const a = order.shippingAddress as { line1?: string; line2?: string | null; city?: string; postalCode?: string } | null
    await sendTemplate('order_new_staff', {
      to: support_email || BRAND.contact.email,
      locale: 'en',
      replyTo: order.email || undefined,
      relatedId: orderId,
      vars: {
        order_number: order.orderNumber,
        order_total: formatMoney(order.totalCents, 'en'),
        customer_name: order.customerName,
        customer_email: `${order.email}${order.userId ? ' (account)' : ' (guest)'}`,
        customer_phone: order.phone ?? '',
        payment_method: order.paymentMethod === 'cod' ? 'Cash on delivery, to collect' : 'Card, paid',
        delivery:
          order.deliveryKind === 'PICKUP'
            ? 'Collection in store'
            : `Delivery to ${[a?.line1, a?.line2, [a?.postalCode, a?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}`,
        order_items: items.map((i) => ({
          name: i.productName,
          image: i.imageUrl,
          detail: [i.colorName, i.size].filter(Boolean).join(' · '),
          quantity: i.quantity,
          price: formatMoney(i.lineTotalCents, 'en'),
        })),
        admin_url: siteUrl(`/admin/orders/${orderId}`),
      },
    })
  } catch (err) {
    console.error('[automations] staff new order email failed', err)
  }
}

/** An order's status moved: the matching email, if there is one. The
 *  tracking number goes in only when the courier gave a real one. */
export async function orderStatusChanged(orderId: string, status: string, extra: { trackingNumber?: string; trackingUrl?: string } = {}) {
  const key = STATUS_TEMPLATE[status]
  if (status === 'PAID') await notifyStaffNewOrder(orderId, 'paid')
  /* A paid order (card at payment, cash when handed over) can earn a tier. */
  if (status === 'PAID' || status === 'DELIVERED') await refreshTierForOrder(orderId)
  if (status === 'CANCELLED') {
    /* A card order that was never paid (the customer left Stripe's page):
       they were never told it existed, so no cancellation email either. */
    const [o] = await db.select({ paymentMethod: orders.paymentMethod, paidAt: orders.paidAt }).from(orders).where(eq(orders.id, orderId))
    if (o?.paymentMethod === 'card' && !o.paidAt) return
  }
  if (key) await orderEvent(orderId, key, `Status changed to ${status.toLowerCase().replace(/_/g, ' ')}.`, extra)
}

/** For the two steps with no status of their own: 'order_confirmed' and
 *  'order_completed'. Each order gets each email at most once. */
export async function orderEvent(orderId: string, key: TemplateKey, reason: string, extra: Record<string, unknown> = {}) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return null
  return scheduleJob({
    automation: key,
    email: order.email,
    userId: order.userId,
    name: order.customerName.split(' ')[0],
    locale: order.locale,
    context: { orderId, ...extra },
    dedupeKey: `order:${orderId}:${key}`,
    reason,
  })
}

async function prepareOrder(job: Job, now: Date): Promise<Prepared> {
  const orderId = String(job.context.orderId ?? '')
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1)
  if (!order) return { skip: 'The order no longer exists.' }

  /* Two emails that would say the same thing: send the first only. */
  const sentFor = async (key: TemplateKey, withinMs: number) => {
    const [row] = await db
      .select({ at: emailJobs.processedAt })
      .from(emailJobs)
      .where(and(eq(emailJobs.dedupeKey, `order:${orderId}:${key}`), eq(emailJobs.status, 'SENT')))
      .limit(1)
    return row?.at && now.getTime() - row.at.getTime() < withinMs ? row.at : null
  }
  /* Queued before payment (an older version did that): never sent unpaid. */
  if ((job.automation === 'order_received' || job.automation === 'order_cancelled') && order.paymentMethod === 'card' && !order.paidAt) {
    return { skip: 'A card order that was never paid.' }
  }
  if (job.automation === 'order_confirmed') {
    const paid = await sentFor('payment_confirmed', minutes(15))
    if (paid) return { skip: `The payment email (${at(paid)}) already confirmed it.` }
  }
  if (job.automation === 'order_completed') {
    const delivered = await sentFor('order_delivered', hours(48))
    if (delivered) return { skip: `The delivery email (${at(delivered)}) already said it.` }
  }

  const locale = asEmailLocale(order.locale)
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId))
  const { estimated_delivery_min_days: lo, estimated_delivery_max_days: hi } = await getSettings([
    'estimated_delivery_min_days',
    'estimated_delivery_max_days',
  ])
  const refund = job.automation === 'order_cancelled' && order.paidAt ? formatMoney(order.totalCents, locale) : ''
  return {
    send: {
      order_number: order.orderNumber,
      order_total: formatMoney(order.totalCents, locale),
      order_url: siteUrl(
        order.userId
          ? `/${locale}/account/orders/${order.orderNumber}`
          : `/${locale}/order/${order.orderNumber}?t=${order.accessToken ?? ''}`,
      ),
      order_items: items.map((i) => ({
        name: i.productName,
        image: i.imageUrl,
        detail: [i.colorName, i.size].filter(Boolean).join(' · '),
        quantity: i.quantity,
        price: formatMoney(i.lineTotalCents, locale),
      })),
      tracking_number: typeof job.context.trackingNumber === 'string' ? job.context.trackingNumber : '',
      tracking_url: typeof job.context.trackingUrl === 'string' ? job.context.trackingUrl : '',
      delivery_estimate: order.deliveryKind === 'PICKUP' ? '' : locale === 'ru' ? `от ${lo} до ${hi} ${WORKING_DAYS.ru}` : locale === 'el' ? `${lo} έως ${hi} ${WORKING_DAYS.el}` : `${lo} to ${hi} ${WORKING_DAYS.en}`,
      pickup_address: `${BRAND.contact.pickupName}, ${BRAND.contact.addressLines.join(', ')}`,
      opening_hours: BRAND.contact.openingHours,
      refund_amount: refund,
    },
  }
}

/* ------------------------------------------------------- back in stock -- */

/** A variant's available stock went from none to some: tell everyone who
 *  asked to be told. (No one can ask yet — the button is not built.) */
export async function stockReplenished(variantId: string) {
  const alerts = await db
    .select()
    .from(stockAlerts)
    .where(and(eq(stockAlerts.variantId, variantId), isNull(stockAlerts.notifiedAt)))
  for (const a of alerts) {
    await scheduleJob({
      automation: 'back_in_stock',
      email: a.email,
      userId: a.userId,
      locale: a.locale,
      context: { variantId, alertId: a.id },
      dedupeKey: `back_in_stock:${a.id}`,
      reason: 'The size they asked about is back in stock.',
    })
  }
}

async function prepareBackInStock(job: Job): Promise<Prepared> {
  const variantId = String(job.context.variantId ?? '')
  const [row] = await db.execute<{
    name: Record<string, string>
    slug: string
    colour: Record<string, string> | null
    size: string
    available: number
    buyable: boolean
    price: number
    image: string | null
  }>(sql`
    select p.name, p.slug, v.color_name as colour, v.size,
           coalesce(i.on_hand - i.reserved, 0) as available,
           (p.is_active and p.availability = 'AVAILABLE' and v.is_active) as buyable,
           coalesce(p.sale_price_cents, p.price_cents) as price,
           (select url from product_images pi where pi.product_id = p.id order by pi.position limit 1) as image
    from product_variants v join products p on p.id = v.product_id
    left join inventory i on i.variant_id = v.id
    where v.id = ${variantId}::uuid`).then((r) => r.rows)
  if (!row || !row.buyable || Number(row.available) <= 0) return { skip: 'Sold out again before we could tell them.' }
  const locale = asEmailLocale(job.locale)
  const name = tField(row.name, locale)
  return {
    send: {
      product_name: name,
      product: {
        name,
        image: row.image,
        detail: [row.colour ? tField(row.colour, locale) : null, row.size].filter(Boolean).join(' · '),
        price: formatMoney(Number(row.price), locale),
      },
      product_url: siteUrl(`/${locale}/products/${row.slug}`),
    },
  }
}

/* ============================================================ the loop == */

/** Everything time-driven, in one call: the worker's 30-second tick. */
const WORKING_DAYS = { en: 'working days', el: 'εργάσιμες ημέρες', ru: 'рабочих дней' } as const

export async function runAutomations(now = new Date()) {
  const { sweepIdleConversations } = await import('@/lib/support')
  const { runDueCampaigns } = await import('@/lib/newsletter')
  const { sweepUnpaidOrders } = await import('@/lib/orders')
  const { sweepExpiredReservations } = await import('@/lib/inventory')
  const closed = await sweepIdleConversations(now)
  /* Bag holds past their time go back on sale for everyone. */
  const { released } = await sweepExpiredReservations().catch((err) => {
    console.error('[automations] expired holds sweep failed', err)
    return { released: 0 }
  })
  const unpaid = await sweepUnpaidOrders(now).catch((err) => {
    console.error('[automations] unpaid order sweep failed', err)
    return 0
  })
  const jobs = await processDueJobs(now)
  const campaigns = await runDueCampaigns(now)
  /* BOX NOW parcels on their way: read their state, in case a webhook was missed. */
  const { pollShipments } = await import('@/lib/shipments')
  /* Membership tiers: ending, ended, or never checked yet. */
  const { sweepTiers } = await import('@/lib/loyalty')
  const tiers = await sweepTiers(now).catch((err) => {
    console.error('[automations] tier sweep failed', err)
    return 0
  })
  const parcels = await pollShipments(now).catch((err) => {
    console.error('[automations] BOX NOW tracking failed', err)
    return 0
  })
  /* Finance: rent and other repeating expenses, overdue retailer invoices,
     and the stock value at the end of last month. */
  const finance = await (async () => {
    const { writeRecurring } = await import('@/lib/expenses')
    const { remindOverdue } = await import('@/lib/wholesale')
    const { snapshotStockValue } = await import('@/lib/finance-reports')
    const recurring = await writeRecurring(now).catch((err) => (console.error('[automations] repeating expenses failed', err), 0))
    const reminders = await remindOverdue(now).catch((err) => (console.error('[automations] wholesale reminders failed', err), 0))
    await snapshotStockValue(now).catch((err) => console.error('[automations] stock value snapshot failed', err))
    return { recurring, reminders }
  })()
  return { closed, unpaid, released, jobs, campaigns, parcels, tiers, ...finance }
}

/* =========================================================== reading == */

export type ActivityRow = {
  id: string
  source: 'job' | 'log'
  kind: string
  recipient: string
  name: string | null
  subject: string | null
  status: string
  triggeredAt: Date | null
  scheduledAt: Date | null
  sentAt: Date | null
  detail: string | null
}

/** Email Activity: every automation job (scheduled, sent, skipped …) and
 *  every other email sent (codes, transcripts, campaigns), newest first. */
export async function emailActivity(opts: { status?: string; kind?: string; q?: string; page?: number }) {
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const q = opts.q?.trim().toLowerCase().slice(0, 120)
  const pat = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
  const res = await db.execute<ActivityRow & { total: number }>(sql`
    with rows as (
      select j.id, 'job' as source, j.automation as kind, j.email as recipient, j.recipient_name as name,
             j.subject, lower(j.status::text) as status, j.triggered_at as "triggeredAt", j.scheduled_at as "scheduledAt",
             case when j.status = 'SENT' then j.processed_at end as "sentAt",
             concat_ws(', ', j.reason, j.outcome) as detail, coalesce(j.processed_at, j.scheduled_at) as sort_at
      from email_jobs j
      union all
      select l.id, 'log', l.kind, l.to_email, null, l.subject,
             l.status, null, null, l.created_at, l.error, l.created_at
      from email_log l
      where not exists (select 1 from email_jobs j where j.email_log_id = l.id)
    )
    select *, count(*) over ()::int as total from rows
    where true
      ${opts.status ? sql`and status = ${opts.status}` : sql``}
      ${opts.kind ? sql`and kind = ${opts.kind}` : sql``}
      ${pat ? sql`and (lower(recipient) like ${pat} or lower(coalesce(subject, '')) like ${pat} or lower(coalesce(name, '')) like ${pat})` : sql``}
    order by sort_at desc
    limit 50 offset ${(page - 1) * 50}`)
  const total = Number(res.rows[0]?.total ?? 0)
  return { rows: res.rows, total, page, pages: Math.max(1, Math.ceil(total / 50)) }
}

/** The dashboard's Customer Activity numbers. */
export async function customerActivity() {
  const day = sql`(date_trunc('day', now() at time zone 'Europe/Nicosia') at time zone 'Europe/Nicosia')`
  const res = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from users where role = 'CUSTOMER' and created_at >= ${day}) as new_customers,
      (select count(*)::int from support_conversations where status = 'OPEN') as open_conversations,
      (select count(*)::int from newsletter_subscribers where status = 'SUBSCRIBED') as subscribers,
      (select count(distinct c.id)::int from carts c join cart_items ci on ci.cart_id = c.id
         where c.user_id is not null and c.updated_at < now() - interval '1 hour') as abandoned_bags,
      (select count(*)::int from email_jobs where status = 'SCHEDULED') as scheduled,
      (select count(*)::int from email_log where created_at >= ${day} and status <> 'failed') as sent_today`)
  const r = res.rows[0] ?? {}
  return {
    newCustomers: Number(r.new_customers ?? 0),
    openConversations: Number(r.open_conversations ?? 0),
    subscribers: Number(r.subscribers ?? 0),
    abandonedBags: Number(r.abandoned_bags ?? 0),
    scheduled: Number(r.scheduled ?? 0),
    sentToday: Number(r.sent_today ?? 0),
  }
}

/* ============================================================ tiers == */

/** After an order is paid: bring its customer's tier up to date. */
export async function refreshTierForOrder(orderId: string) {
  try {
    const [o] = await db.select({ userId: orders.userId }).from(orders).where(eq(orders.id, orderId))
    if (!o?.userId) return
    const { evaluateTier } = await import('@/lib/loyalty')
    await evaluateTier(o.userId)
  } catch (err) {
    console.error('[automations] tier not updated', err)
  }
}

export async function scheduleTierEmail(
  key: 'tier_upgraded' | 'tier_near' | 'tier_expiring' | 'tier_last_call' | 'tier_downgraded',
  userId: string,
  dedupe: string,
  vars: Record<string, string>,
) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return
  await scheduleJob({
    automation: key,
    email: user.email,
    userId,
    name: user.firstName,
    locale: user.locale,
    context: { ...vars },
    dedupeKey: dedupe,
    reason: { tier_upgraded: 'Earned a new tier.', tier_near: 'Close to the next tier.', tier_expiring: 'Tier ends soon.', tier_last_call: 'Tier ends in two days.', tier_downgraded: 'Tier ended, moved down one.' }[key],
  })
}

const NEEDED_WORDS = {
  en: { order: (n: number) => (n === 1 ? '1 more order' : `${n} more orders`), spend: (m: string) => `${m} more spent`, and: ' and ', none: 'keep shopping as you do' },
  el: { order: (n: number) => (n === 1 ? '1 ακόμη παραγγελία' : `${n} ακόμη παραγγελίες`), spend: (m: string) => `${m} ακόμη σε αγορές`, and: ' και ', none: 'συνέχισε όπως τώρα' },
  ru: { order: (n: number) => (n === 1 ? 'ещё 1 заказ' : `ещё ${n} заказа(ов)`), spend: (m: string) => `ещё ${m} покупок`, and: ' и ', none: 'продолжайте в том же духе' },
} as const

export function neededWords(p: { ordersNeeded: number; spendNeededCents: number }, locale: 'en' | 'el' | 'ru') {
  const w = NEEDED_WORDS[locale]
  const parts = [p.ordersNeeded > 0 ? w.order(p.ordersNeeded) : null, p.spendNeededCents > 0 ? w.spend(formatMoney(p.spendNeededCents, locale)) : null].filter(Boolean)
  return parts.length ? parts.join(w.and) : w.none
}

async function prepareTier(job: Job, now: Date): Promise<Prepared> {
  if (!job.userId) return { skip: 'No account.' }
  const { customerTier, progressTowards, TIER_NAMES } = await import('@/lib/loyalty')
  const ct = await customerTier(job.userId, now)
  if (!ct || !ct.enabled) return { skip: 'Membership tiers are switched off.' }
  const locale = asEmailLocale(job.locale)
  const date = (d: Date | null) =>
    d ? d.toLocaleDateString(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Nicosia' }) : ''

  if (job.automation === 'tier_near' && (!ct.next || ct.next.progress.share >= 1)) return { skip: 'No longer close: already moved up.' }
  if (job.automation === 'tier_expiring' || job.automation === 'tier_last_call') {
    const days = job.automation === 'tier_last_call' ? ct.config.lastCallDays : ct.config.warningDays
    if (!ct.expiresAt || ct.expiresAt.getTime() - now.getTime() > days * 86_400_000) return { skip: 'The tier was renewed in the meantime.' }
  }
  if (job.automation === 'tier_downgraded' && typeof job.context.old_tier !== 'string') return { skip: 'Missing details.' }

  /* What is needed: for the next tier (near), to keep this one (expiring),
     or to get back to the one they lost (downgraded). */
  const back = ct.config.tiers.find((t) => TIER_NAMES[t.key] === job.context.old_tier)
  const need =
    job.automation === 'tier_near' && ct.next
      ? ct.next.progress
      : (job.automation === 'tier_expiring' || job.automation === 'tier_last_call') && ct.keep
        ? ct.keep
        : job.automation === 'tier_downgraded' && back
          ? progressTowards(back, ct.stats)
          : { ordersNeeded: 0, spendNeededCents: 0 }

  return {
    send: {
      tier_name: TIER_NAMES[ct.tier],
      tier_discount: `${ct.rule.discountPercent}%`,
      expires_on: date(ct.expiresAt),
      next_tier: ct.next ? TIER_NAMES[ct.next.key] : '',
      next_discount: ct.next ? `${ct.next.discountPercent}%` : '',
      needed: neededWords(need, locale),
      lower_tier: ct.lower ? TIER_NAMES[ct.lower.key] : '',
      lower_discount: ct.lower ? `${ct.lower.discountPercent}%` : '',
      old_tier: typeof job.context.old_tier === 'string' ? job.context.old_tier : '',
      membership_url: siteUrl(`/${locale}/account/membership`),
    },
  }
}
