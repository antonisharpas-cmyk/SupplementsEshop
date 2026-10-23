/* ============================================================================
 * Orders entered by staff: a customer phoned, or asked in the shop, and the
 * owner takes the order for them.
 *
 *  · Stock leaves the shelf straight away, as with any order. Not enough on
 *    the shelf refuses the whole order, nothing half done.
 *  · Prices default to today's price (promotions included); staff can change
 *    a unit price, e.g. for an agreed discount.
 *  · Delivery is whatever was agreed on the phone, 0 included.
 *  · Payment is cash on delivery. "Already paid" records the cash as taken
 *    and issues the invoice at once.
 *  · The order starts as Being prepared: staff confirmed it on the phone.
 *  · If the email belongs to an account, the order shows in that account.
 * ========================================================================== */

import { costsOf } from '@/lib/stock'
import { randomBytes } from 'node:crypto'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { deliveryOptions, inventory, orderItems, orders, payments, productImages, productVariants, products, users } from '@/db/schema'
import { generateOrderNumber, resolvePrices } from '@/lib/pricing'
import { getSetting, getSettings } from '@/lib/settings'
import { isUniqueViolation } from '@/lib/db-errors'
import { issueInvoice, safely, vatOf } from '@/lib/invoices'

export class ManualOrderError extends Error {}

export type ManualOrderInput = {
  firstName: string
  lastName: string
  email?: string
  phone: string
  locale: 'en' | 'el' | 'ru'
  delivery:
    | { kind: 'SHIPPING'; address: { line1: string; line2?: string; city: string; postalCode: string; country: string } }
    | { kind: 'PICKUP' }
  deliveryCents: number
  lines: { variantId: string; quantity: number; unitCents?: number }[]
  paid: boolean
  sendEmail: boolean
  note?: string
}

/** For the form: every active size with its price today and what is free. */
export async function manualOrderCatalogue() {
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      categoryId: products.categoryId,
      name: products.name,
      size: productVariants.size,
      flavour: productVariants.colorName,
      sku: productVariants.sku,
      list: sql<number>`coalesce(${productVariants.priceCentsOverride}, ${products.priceCents})`.mapWith(Number),
      sale: sql<number | null>`coalesce(${productVariants.salePriceCentsOverride}, ${products.salePriceCents})`,
      available: sql<number>`greatest(coalesce(${inventory.onHand}, 0) - coalesce(${inventory.reserved}, 0), 0)`.mapWith(Number),
      isActive: products.isActive,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.isActive, true))
    .orderBy(sql`${products.name}->>'en'`, productVariants.position)
  const prices = await resolvePrices(
    rows.map((r) => ({ productId: r.productId, categoryId: r.categoryId, variantId: r.variantId, listCents: r.list, saleCents: r.sale === null ? null : Number(r.sale) })),
  )
  return rows.map((r) => ({
    variantId: r.variantId,
    label: [r.name.en, r.flavour?.en, r.size].filter(Boolean).join(', '),
    sku: r.sku,
    priceCents: prices.get(r.variantId)?.finalCents ?? r.list,
    available: r.available,
    hidden: !r.isActive,
  }))
}

export async function createManualOrder(input: ManualOrderInput, staff: { id: string }) {
  if (input.lines.length === 0) throw new ManualOrderError('Add at least one product.')
  const merged = new Map<string, { variantId: string; quantity: number; unitCents?: number }>()
  for (const l of input.lines) {
    const prev = merged.get(l.variantId)
    merged.set(l.variantId, prev ? { ...prev, quantity: prev.quantity + l.quantity } : { ...l })
  }
  const lines = [...merged.values()]

  const variants = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      categoryId: products.categoryId,
      name: products.name,
      size: productVariants.size,
      flavour: productVariants.colorName,
      sku: productVariants.sku,
      list: sql<number>`coalesce(${productVariants.priceCentsOverride}, ${products.priceCents})`.mapWith(Number),
      sale: sql<number | null>`coalesce(${productVariants.salePriceCentsOverride}, ${products.salePriceCents})`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, lines.map((l) => l.variantId)))
  const byId = new Map(variants.map((v) => [v.variantId, v]))
  if (variants.length !== lines.length) throw new ManualOrderError('One of those products no longer exists.')

  const firstImages = await db
    .select({ productId: productImages.productId, url: productImages.url, position: productImages.position })
    .from(productImages)
    .where(inArray(productImages.productId, variants.map((v) => v.productId)))
  const imageOf = new Map<string, string>()
  for (const i of firstImages.sort((a, b) => a.position - b.position)) if (!imageOf.has(i.productId)) imageOf.set(i.productId, i.url)

  const prices = await resolvePrices(
    variants.map((v) => ({ productId: v.productId, categoryId: v.categoryId, variantId: v.variantId, listCents: v.list, saleCents: v.sale === null ? null : Number(v.sale) })),
  )

  const priced = lines.map((l) => {
    const v = byId.get(l.variantId)!
    const p = prices.get(l.variantId)
    const today = p?.finalCents ?? v.list
    const unit = l.unitCents ?? today
    return {
      ...l,
      v,
      listCents: v.list,
      unitCents: unit,
      unitDiscountCents: Math.max(0, v.list - unit),
      lineTotalCents: unit * l.quantity,
      promotionId: l.unitCents === undefined ? (p?.promotionId ?? null) : null,
      promotionSnapshot: l.unitCents === undefined ? (p?.promotionSnapshot ?? null) : null,
    }
  })

  const subtotal = priced.reduce((n, l) => n + l.listCents * l.quantity, 0)
  const goods = priced.reduce((n, l) => n + l.lineTotalCents, 0)
  const total = goods + input.deliveryCents
  const { vat_rate_bp: rate, currency } = await getSettings(['vat_rate_bp', 'currency'])
  const prefix = await getSetting('order_number_prefix')

  const [option] = await db
    .select()
    .from(deliveryOptions)
    .where(and(eq(deliveryOptions.kind, input.delivery.kind), eq(deliveryOptions.isActive, true)))
    .limit(1)

  const email = (input.email ?? '').trim().toLowerCase()
  const [account] = email ? await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1) : []
  const name = `${input.firstName} ${input.lastName}`.trim()
  const now = new Date()

  for (let attempt = 0; attempt < 4; attempt++) {
    const orderNumber = generateOrderNumber(prefix)
    try {
      const created = await db.transaction(async (tx) => {
        /* Take the stock first; any line short of stock stops everything. */
        for (const l of priced) {
          const got = await tx
            .update(inventory)
            .set({ onHand: sql`${inventory.onHand} - ${l.quantity}`, updatedAt: now })
            .where(and(eq(inventory.variantId, l.variantId), sql`${inventory.onHand} - ${inventory.reserved} >= ${l.quantity}`))
            .returning({ id: inventory.variantId })
          if (!got.length) {
            const label = [l.v.name.en, l.v.flavour?.en, l.v.size].filter(Boolean).join(', ')
            throw new ManualOrderError(`Not enough ${label} on the shelf for ${l.quantity}.`)
          }
        }

        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber,
            userId: account?.id ?? null,
            email,
            phone: input.phone,
            customerName: name,
            status: 'PROCESSING',
            deliveryKind: input.delivery.kind,
            deliveryOptionId: option?.id ?? null,
            deliveryOptionName: option?.name ?? { en: input.delivery.kind === 'SHIPPING' ? 'Delivery' : 'Collection in store' },
            shippingAddress:
              input.delivery.kind === 'SHIPPING'
                ? { recipientName: name, phone: input.phone, ...input.delivery.address, line2: input.delivery.address.line2 || null }
                : null,
            billingAddress: null,
            subtotalCents: subtotal,
            promotionDiscountCents: subtotal - goods > 0 ? subtotal - goods : 0,
            promoCodeDiscountCents: 0,
            deliveryCents: input.deliveryCents,
            totalCents: total,
            vatCents: vatOf(total, rate),
            currency,
            customerNote: null,
            adminNote: [`Phone order.`, input.note?.trim()].filter(Boolean).join(' '),
            locale: input.locale,
            paymentMethod: 'cod',
            channel: 'phone',
            createdBy: staff.id,
            accessToken: randomBytes(24).toString('hex'),
            paidAt: input.paid ? now : null,
          })
          .returning({ id: orders.id, orderNumber: orders.orderNumber })

        /* What each unit cost the shop right now, for the profit (lib/stock.ts). */
        const unitCosts = await costsOf(priced.map((l) => l.variantId), tx)
        await tx.insert(orderItems).values(
          priced.map((l) => ({
            orderId: order.id,
            variantId: l.variantId,
            productId: l.v.productId,
            productName: (l.v.name[input.locale] || l.v.name.en || '').slice(0, 300),
            sku: l.v.sku,
            size: l.v.size,
            colorName: l.v.flavour ? (l.v.flavour[input.locale] || l.v.flavour.en || '').slice(0, 80) || null : null,
            imageUrl: imageOf.get(l.v.productId) ?? null,
            quantity: l.quantity,
            unitPriceCents: l.listCents,
            unitDiscountCents: l.unitDiscountCents,
            lineTotalCents: l.lineTotalCents,
            appliedPromotionId: l.promotionId,
            appliedPromotionSnapshot: l.promotionSnapshot,
            unitCostCents: unitCosts.has(l.variantId) ? Math.round(unitCosts.get(l.variantId)!) : null,
          })),
        )

        await tx.insert(payments).values({
          orderId: order.id,
          provider: 'cod',
          status: input.paid ? 'SUCCEEDED' : 'PENDING',
          amountCents: total,
          currency,
          paidAt: input.paid ? now : null,
        })
        return order
      })

      if (input.paid) await safely(() => issueInvoice(created.id), 'invoice')
      if (input.sendEmail && email) {
        try {
          const { orderEvent } = await import('@/lib/automations')
          await orderEvent(created.id, 'order_confirmed', 'Phone order entered by staff.')
        } catch (err) {
          console.error('[manual-orders] confirmation email not scheduled', err)
        }
      }
      return created
    } catch (err) {
      if (isUniqueViolation(err, 'orders_number_unique')) continue
      throw err
    }
  }
  throw new Error('Could not allocate an order number.')
}
