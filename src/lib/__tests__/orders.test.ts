/* ============================================================================
 * Checkout and the order lifecycle, against a real Postgres.
 *
 * What must hold:
 *  · placing an order turns the bag's holds into a sale: stock leaves the
 *    shelf, the bag is emptied, the order and its lines are a snapshot;
 *  · the total is the server's, whatever the bag looked like;
 *  · cancelling puts every unit back;
 *  · a cash order delivered records the cash as received;
 *  · a customer only ever sees their own orders, and a guest only with the
 *    order's secret.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import {
  cartItems,
  carts,
  categories,
  deliveryOptions,
  emailJobs,
  inventory,
  invoices,
  inventoryReservations,
  orderItems,
  orders,
  payments,
  productVariants,
  products,
  promoCodeUsage,
  users,
} from '@/db/schema'
import { addToCart } from '../cart'
import {
  CheckoutError,
  cancelOrder,
  getOrderByToken,
  getOrderForUser,
  listOrdersForUser,
  listPaymentsForUser,
  markCashReceived,
  placeOrder,
  refundOrder,
  setOrderStatus,
} from '../orders'
import { ensureInvoices, invoiceTotals } from '../invoices'
import { toXlsx } from '../spreadsheet'
import { accountingSheets } from '../accounting-export'

let variant: string
let shipping: string
let pickup: string

const address = {
  recipientName: 'Test Person',
  phone: '+35799123456',
  line1: 'Test Street 1',
  city: 'Larnaca',
  postalCode: '6017',
  country: 'CY',
}

async function onHand() {
  const [r] = await db.select({ onHand: inventory.onHand, reserved: inventory.reserved }).from(inventory).where(eq(inventory.variantId, variant))
  return r
}

async function cart(token = `t-${Math.random()}`) {
  const [c] = await db.insert(carts).values({ anonymousToken: token }).returning({ id: carts.id })
  return c.id
}

beforeEach(async () => {
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
  await db.execute(sql`delete from users where email like '%@orders.test'`)

  const [root] = await db.insert(categories).values({ slug: 'root', name: { en: 'Root' } }).returning({ id: categories.id })
  const [cat] = await db.insert(categories).values({ slug: 'protein', parentId: root.id, name: { en: 'Protein' } }).returning({ id: categories.id })
  const [p] = await db
    .insert(products)
    .values({ categoryId: cat.id, slug: 'whey', name: { en: 'Whey', el: 'Whey EL' }, priceCents: 4000, isActive: true })
    .returning({ id: products.id })
  const [v] = await db
    .insert(productVariants)
    .values({ productId: p.id, sku: 'W-CHOC-1KG', size: '1kg', colorName: { en: 'Chocolate', el: 'Σοκολάτα' }, colorHex: '#5a3825' })
    .returning({ id: productVariants.id })
  variant = v.id
  await db.insert(inventory).values({ variantId: variant, onHand: 10, reserved: 0 })

  const [s, k] = await db
    .insert(deliveryOptions)
    .values([
      { kind: 'SHIPPING', name: { en: 'Home' }, priceCents: 500, position: 0 },
      { kind: 'PICKUP', name: { en: 'Store' }, priceCents: 0, position: 1 },
    ])
    .returning({ id: deliveryOptions.id })
  shipping = s.id
  pickup = k.id
})

afterAll(async () => {
  await pool.end()
})

const input = (over: Partial<Parameters<typeof placeOrder>[0]['input']> = {}) => ({
  email: 'Buyer@Orders.test',
  phone: '+35799123456',
  firstName: 'Ana',
  lastName: 'Buyer',
  deliveryOptionId: shipping,
  shippingAddress: address,
  paymentMethod: 'cod' as const,
  locale: 'el' as const,
  ...over,
})

describe('placing an order', () => {
  it('turns the bag into a sale, a snapshot and an empty bag', async () => {
    const c = await cart()
    await addToCart(c, variant, 3)
    expect(await onHand()).toEqual({ onHand: 10, reserved: 3 })

    const result = await placeOrder({ cartId: c, userId: null, input: input() })
    expect(result.redirectUrl).toMatch(/\/el\/order\/.+\?t=[0-9a-f]{48}&placed=1$/)

    expect(await onHand()).toEqual({ onHand: 7, reserved: 0 })
    expect(await db.select().from(cartItems).where(eq(cartItems.cartId, c))).toHaveLength(0)

    const [o] = await db.select().from(orders).where(eq(orders.id, result.orderId))
    expect(o.status).toBe('PENDING')
    expect(o.email).toBe('buyer@orders.test')
    /* Over the free delivery threshold, so delivery is free. */
    expect(o.totalCents).toBe(3 * 4000)
    expect(o.deliveryCents).toBe(0)
    expect(o.paymentMethod).toBe('cod')

    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id))
    /* Copied in, in the customer's language. */
    expect(line.productName).toBe('Whey EL')
    expect(line.colorName).toBe('Σοκολάτα')
    expect(line.lineTotalCents).toBe(12000)

    const [pay] = await db.select().from(payments).where(eq(payments.orderId, o.id))
    expect(pay.provider).toBe('cod')
    expect(pay.status).toBe('PENDING')
  })

  it('refuses an empty bag, and a delivery with no address', async () => {
    const empty = await cart()
    await expect(placeOrder({ cartId: empty, userId: null, input: input() })).rejects.toBeInstanceOf(CheckoutError)

    const c = await cart()
    await addToCart(c, variant, 1)
    await expect(
      placeOrder({ cartId: c, userId: null, input: input({ shippingAddress: undefined }) }),
    ).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' })
    /* Nothing was sold. */
    expect((await onHand()).onHand).toBe(10)
  })

  it('refuses collection on the website (staff enter collection orders)', async () => {
    const c = await cart()
    await addToCart(c, variant, 1)
    await expect(
      placeOrder({ cartId: c, userId: null, input: input({ deliveryOptionId: pickup, shippingAddress: undefined }) }),
    ).rejects.toMatchObject({ code: 'NO_DELIVERY' })
  })

  it('refuses card payment when Stripe is not set up', async () => {
    const before = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    const c = await cart()
    await addToCart(c, variant, 1)
    await expect(placeOrder({ cartId: c, userId: null, input: input({ paymentMethod: 'card' }) })).rejects.toMatchObject({
      code: 'CARD_UNAVAILABLE',
    })
    if (before) process.env.STRIPE_SECRET_KEY = before
  })
})

describe('after the order', () => {
  it('cancelling puts every unit back on the shelf', async () => {
    const c = await cart()
    await addToCart(c, variant, 4)
    const r = await placeOrder({ cartId: c, userId: null, input: input() })
    expect((await onHand()).onHand).toBe(6)
    await cancelOrder(r.orderId, { reason: 'test', by: null })
    expect((await onHand()).onHand).toBe(10)
    const [o] = await db.select().from(orders).where(eq(orders.id, r.orderId))
    expect(o.status).toBe('CANCELLED')
    await expect(cancelOrder(r.orderId, { reason: 'again', by: null })).rejects.toThrow()
  })

  it('a cash order handed over records the cash as received', async () => {
    const c = await cart()
    await addToCart(c, variant, 1)
    const r = await placeOrder({ cartId: c, userId: null, input: input() })
    await expect(setOrderStatus(r.orderId, 'DELIVERED')).rejects.toThrow()
    await setOrderStatus(r.orderId, 'PROCESSING')
    await setOrderStatus(r.orderId, 'SHIPPED', { trackingNumber: 'CY1' })
    await setOrderStatus(r.orderId, 'DELIVERED')
    const [o] = await db.select().from(orders).where(eq(orders.id, r.orderId))
    expect(o.status).toBe('DELIVERED')
    expect(o.trackingNumber).toBe('CY1')
    expect(o.paidAt).not.toBeNull()
    const [pay] = await db.select().from(payments).where(eq(payments.orderId, r.orderId))
    expect(pay.status).toBe('SUCCEEDED')
  })

  it('a customer sees only their own orders; a guest only with the secret', async () => {
    const [u1, u2] = await db
      .insert(users)
      .values([
        { email: 'a@orders.test', phone: '+35799000101', passwordHash: 'x', firstName: 'A', lastName: 'A' },
        { email: 'b@orders.test', phone: '+35799000102', passwordHash: 'x', firstName: 'B', lastName: 'B' },
      ])
      .returning({ id: users.id })
    const [c1] = await db.insert(carts).values({ userId: u1.id }).returning({ id: carts.id })
    await addToCart(c1.id, variant, 1)
    const mine = await placeOrder({ cartId: c1.id, userId: u1.id, input: input() })
    expect(mine.redirectUrl).toMatch(/\/el\/account\/orders\//)

    expect(await getOrderForUser(mine.orderNumber, u1.id)).not.toBeNull()
    expect(await getOrderForUser(mine.orderNumber, u2.id)).toBeNull()
    expect(await listOrdersForUser(u2.id)).toHaveLength(0)
    expect((await listOrdersForUser(u1.id))[0].itemCount).toBe(1)
    expect(await listPaymentsForUser(u1.id)).toHaveLength(1)

    const c = await cart()
    await addToCart(c, variant, 1)
    const guest = await placeOrder({ cartId: c, userId: null, input: input() })
    const token = new URL(`http://x${guest.redirectUrl}`).searchParams.get('t')!
    expect(await getOrderByToken(guest.orderNumber, token)).not.toBeNull()
    expect(await getOrderByToken(guest.orderNumber, 'f'.repeat(48))).toBeNull()
    expect(await getOrderByToken(guest.orderNumber, '')).toBeNull()
  })
})

describe('invoices', () => {
  const staff = { id: '00000000-0000-0000-0000-000000000000', email: 'staff@orders.test' }

  it('a paid order gets one numbered invoice; unpaid orders get none', async () => {
    const c = await cart()
    await addToCart(c, variant, 2)
    const r = await placeOrder({ cartId: c, userId: null, input: input() })
    expect(await db.select().from(invoices)).toHaveLength(0)

    await markCashReceived(r.orderId)
    await ensureInvoices() // a second pass must not duplicate
    const list = await db.select().from(invoices)
    expect(list).toHaveLength(1)
    const [inv] = list
    expect(inv.number).toMatch(/^INV-\d{4}-000001$/)
    expect(inv.totalCents).toBe(8000)
    expect(inv.netCents + inv.vatCents).toBe(8000)
    expect(inv.lines.reduce((n, l) => n + l.totalCents, 0)).toBe(8000)
    expect(inv.customer.name).toBe('Ana Buyer')
  })

  it('a refund issues a credit note, and the period nets to zero', async () => {
    const c = await cart()
    await addToCart(c, variant, 1)
    const r = await placeOrder({ cartId: c, userId: null, input: input() })
    await setOrderStatus(r.orderId, 'PROCESSING')
    await setOrderStatus(r.orderId, 'SHIPPED')
    await setOrderStatus(r.orderId, 'DELIVERED')
    await refundOrder(r.orderId, { restock: false, by: staff })

    const docs = await db.select().from(invoices).orderBy(invoices.issuedAt)
    expect(docs.map((d) => d.kind)).toEqual(['INVOICE', 'CREDIT_NOTE'])
    expect(docs[1].number).toMatch(/^CN-\d{4}-000001$/)
    expect(docs[1].relatesToId).toBe(docs[0].id)
    const t = await invoiceTotals({})
    expect(t.gross).toBe(0)
    expect(t.vat).toBe(0)
  })

  it('exports a workbook Excel can open', async () => {
    const c = await cart()
    await addToCart(c, variant, 1)
    const r = await placeOrder({ cartId: c, userId: null, input: input() })
    await markCashReceived(r.orderId)
    const s = await accountingSheets({})
    expect(s.invoices.rows).toHaveLength(1)
    const file = toXlsx([s.invoices, s.lines, s.summary])
    expect(file.subarray(0, 2).toString()).toBe('PK')
    expect(file.length).toBeGreaterThan(1000)
  })
})

describe('orders taken by staff', () => {
  const staff = { id: '00000000-0000-0000-0000-000000000001' }
  const base = {
    firstName: 'Phone',
    lastName: 'Customer',
    phone: '+35799111222',
    locale: 'en' as const,
    delivery: { kind: 'SHIPPING' as const, address: { line1: 'Street 1', city: 'Larnaca', postalCode: '6017', country: 'CY' } },
    sendEmail: false,
  }

  it('takes the stock, uses the agreed delivery charge and a changed price', async () => {
    const { createManualOrder } = await import('../manual-orders')
    const o = await createManualOrder(
      { ...base, deliveryCents: 1500, lines: [{ variantId: variant, quantity: 2, unitCents: 3500 }], paid: false },
      staff,
    )
    const [row] = await db.select().from(orders).where(eq(orders.id, o.id))
    expect(row.status).toBe('PROCESSING')
    expect(row.channel).toBe('phone')
    expect(row.totalCents).toBe(2 * 3500 + 1500)
    expect(row.deliveryCents).toBe(1500)
    expect((await onHand()).onHand).toBe(8)
    expect(await db.select().from(invoices)).toHaveLength(0)
  })

  it('refuses more than is on the shelf, and changes nothing', async () => {
    const { createManualOrder, ManualOrderError } = await import('../manual-orders')
    await expect(
      createManualOrder({ ...base, deliveryCents: 0, lines: [{ variantId: variant, quantity: 11 }], paid: false }, staff),
    ).rejects.toBeInstanceOf(ManualOrderError)
    expect((await onHand()).onHand).toBe(10)
    expect(await db.select().from(orders)).toHaveLength(0)
  })

  it('already paid: records the cash and issues the invoice', async () => {
    const { createManualOrder } = await import('../manual-orders')
    const o = await createManualOrder(
      { ...base, delivery: { kind: 'PICKUP' }, deliveryCents: 0, lines: [{ variantId: variant, quantity: 1 }], paid: true },
      staff,
    )
    const [pay] = await db.select().from(payments).where(eq(payments.orderId, o.id))
    expect(pay.status).toBe('SUCCEEDED')
    const docs = await db.select().from(invoices)
    expect(docs).toHaveLength(1)
    expect(docs[0].totalCents).toBe(4000)
  })
})
