/* ============================================================================
 * BOX NOW, against a scripted BOX NOW API (fetch is replaced).
 *
 * What must hold:
 *  · without the settings, lockers are not offered and nothing is pretended;
 *  · the locker is read back from BOX NOW at checkout, not taken from the
 *    browser, and becomes the delivery address (Cyprus only);
 *  · creating the shipment sends BOX NOW the documented request and records
 *    the parcel number as tracking; BOX NOW's refusals reach staff with their
 *    code; nothing is recorded when BOX NOW refuses;
 *  · tracking moves the order: on its way → out for delivery, collected →
 *    delivered (a cash order is then paid);
 *  · the webhook is only a nudge: the state comes from BOX NOW's API;
 *  · a parcel not handed over is cancelled with the order.
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
  shipments,
} from '@/db/schema'
import { addToCart } from '../cart'
import { cancelOrder, placeOrder } from '../orders'
import { resetBoxNowCache, boxnowStatus, boxnowPhone } from '../boxnow'
import { createBoxNowShipment, pollShipments, refreshByParcelId, shipmentsForOrder } from '../shipments'
import { quoteDelivery } from '../pricing'

/* ------------------------------------------------- scripted BOX NOW API --- */
type Call = { method: string; path: string; body: unknown; auth: string | null }
let calls: Call[] = []
let parcelState = 'new'
let parcelEvents: { type: string; locationDisplayName?: string; createTime: string }[] = []
let refuseCreate: { code: string; message: string } | null = null

const LOCKERS = [
  { id: '4321', type: 'apm', name: 'AlphaMega Larnaca', title: 'AlphaMega', addressLine1: 'Makariou 10', addressLine2: 'Larnaca', postalCode: '6017', country: 'CY', lat: 34.9, lng: 33.6 },
  { id: '9999', type: 'apm', name: 'Athens Locker', title: 'Athens', addressLine1: 'Stadiou 1', addressLine2: 'Athens', postalCode: '10564', country: 'GR' },
]

const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url))
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : null
  const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
  calls.push({ method, path: u.pathname + u.search, body, auth })
  const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

  if (u.pathname === '/api/v1/auth-sessions') {
    return body?.client_secret === 'secret' ? ok({ access_token: 'tok-1', token_type: 'Bearer', expires_in: 3600 }) : ok({ code: 'P400' }, 401)
  }
  if (auth !== 'Bearer tok-1') return ok({}, 401)
  if (u.pathname === '/api/v1/destinations') return ok({ data: LOCKERS })
  if (u.pathname === '/api/v1/origins') return ok({ data: [{ id: '2', type: 'warehouse', name: 'AIONIX warehouse', addressLine1: 'Industrial 5', postalCode: '7100', country: 'CY' }] })
  if (u.pathname === '/api/v1/delivery-requests' && method === 'POST') {
    if (refuseCreate) return ok(refuseCreate, 400)
    return ok({ id: '42224', parcels: [{ id: '9219709201' }] })
  }
  if (u.pathname === '/api/v1/parcels') {
    return ok({ data: [{ id: u.searchParams.get('parcelId'), state: parcelState, events: parcelEvents }] })
  }
  if (u.pathname === '/api/v1/parcels/9219709201:cancel' && method === 'POST') return ok({})
  if (u.pathname === '/api/v1/parcels/9219709201/label.pdf') return new Response('%PDF-1.4 label', { headers: { 'Content-Type': 'application/pdf' } })
  return ok({ code: 'P404', message: 'unknown' }, 404)
})

/* ---------------------------------------------------------------- setup --- */
const SETTINGS = {
  BOXNOW_API_URL: 'api-stage.boxnow.test',
  BOXNOW_CLIENT_ID: 'client',
  BOXNOW_CLIENT_SECRET: 'secret',
  BOXNOW_WAREHOUSE_ID: '2',
  BOXNOW_PARTNER_ID: '123',
  BOXNOW_SENDER_PHONE: '+35799000000',
}
function configure(on = true) {
  for (const [k, v] of Object.entries(SETTINGS)) {
    if (on) process.env[k] = v
    else delete process.env[k]
  }
  delete process.env.BOXNOW_COD
  resetBoxNowCache()
}

let variant: string
let lockerOption: string
let homeOption: string

beforeEach(async () => {
  vi.stubGlobal('fetch', fakeFetch)
  calls = []
  parcelState = 'new'
  parcelEvents = []
  refuseCreate = null
  configure(true)
  delete process.env.STRIPE_SECRET_KEY
  await db.delete(emailJobs)
  await db.delete(promoCodeUsage)
  await db.delete(invoices)
  await db.delete(shipments)
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
  const [home, lk] = await db
    .insert(deliveryOptions)
    .values([
      { kind: 'SHIPPING', name: { en: 'Home' }, priceCents: 500, position: 0 },
      { kind: 'SHIPPING', carrier: 'boxnow', name: { en: 'BOX NOW locker' }, priceCents: 300, position: 1 },
    ])
    .returning({ id: deliveryOptions.id })
  homeOption = home.id
  lockerOption = lk.id
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await pool.end()
})

async function cart() {
  const [c] = await db.insert(carts).values({ anonymousToken: `t-${Math.random()}` }).returning({ id: carts.id })
  await addToCart(c.id, variant, 1)
  return c.id
}
const input = (over: Record<string, unknown> = {}) => ({
  email: 'locker@orders.test',
  phone: '+35799123456',
  firstName: 'Lena',
  lastName: 'Locker',
  deliveryOptionId: lockerOption,
  paymentMethod: 'cod' as const,
  locale: 'en' as const,
  pickupPoint: { id: '4321', name: 'Fake name from browser', address: 'Fake street', postalCode: '1000' },
  ...over,
})
async function lockerOrder() {
  process.env.BOXNOW_COD = 'yes'
  const r = await placeOrder({ cartId: await cart(), userId: null, input: input() })
  return r.orderId
}
const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]

/* ---------------------------------------------------------------- tests --- */
describe('settings', () => {
  it('without the settings, the locker option is not offered and says what is missing', async () => {
    configure(false)
    expect(boxnowStatus()).toMatchObject({ checkout: false, api: false })
    expect(boxnowStatus().missing).toEqual(['BOXNOW_API_URL', 'BOXNOW_CLIENT_ID', 'BOXNOW_CLIENT_SECRET', 'BOXNOW_WAREHOUSE_ID', 'BOXNOW_PARTNER_ID'])
    const quotes = await quoteDelivery(4000)
    expect(quotes.map((q) => q.optionId)).toEqual([homeOption])
    await expect(placeOrder({ cartId: await cart(), userId: null, input: input() })).rejects.toMatchObject({ code: 'NO_DELIVERY' })
    expect(calls).toHaveLength(0)
  })

  it('phones go to BOX NOW in full international format', () => {
    expect(boxnowPhone('99 123456')).toBe('+35799123456')
    expect(boxnowPhone('0035799123456')).toBe('+35799123456')
    expect(boxnowPhone('+44 7700 900123')).toBeNull()
  })
})

describe('checkout', () => {
  it('takes the locker from BOX NOW, not from the browser, and delivers to it', async () => {
    const id = await lockerOrder()
    const o = await order(id)
    expect(o.pickupPoint).toEqual({ provider: 'boxnow', id: '4321', name: 'AlphaMega Larnaca', address: 'Makariou 10, Larnaca', postalCode: '6017', verified: true })
    expect(o.shippingAddress).toMatchObject({ line1: 'BOX NOW AlphaMega Larnaca', postalCode: '6017', country: 'CY', recipientName: 'Lena Locker' })
    expect(o.deliveryCents).toBe(300)
  })

  it('refuses a locker outside Cyprus, an unknown locker, and no locker', async () => {
    process.env.BOXNOW_COD = 'yes'
    await expect(placeOrder({ cartId: await cart(), userId: null, input: input({ pickupPoint: { id: '9999', name: '', address: '', postalCode: '' } }) })).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' })
    await expect(placeOrder({ cartId: await cart(), userId: null, input: input({ pickupPoint: { id: '1111', name: '', address: '', postalCode: '' } }) })).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' })
    await expect(placeOrder({ cartId: await cart(), userId: null, input: input({ pickupPoint: undefined }) })).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' })
  })

  it('cash at the locker only when the contract allows it', async () => {
    await expect(placeOrder({ cartId: await cart(), userId: null, input: input() })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
})

describe('shipment', () => {
  it('sends BOX NOW the documented request and records the parcel as tracking', async () => {
    const id = await lockerOrder()
    await createBoxNowShipment(id, { compartmentSize: 2, by: null })
    const create = calls.find((c) => c.path === '/api/v1/delivery-requests')!
    const o = await order(id)
    expect(create.auth).toBe('Bearer tok-1')
    expect(create.body).toMatchObject({
      orderNumber: o.orderNumber,
      paymentMode: 'cod',
      amountToBeCollected: (o.totalCents / 100).toFixed(2),
      invoiceValue: (o.totalCents / 100).toFixed(2),
      allowReturn: true,
      origin: { contactName: 'AIONIX', contactNumber: '+35799000000', locationId: '2' },
      destination: { contactName: 'Lena Locker', contactNumber: '+35799123456', contactEmail: 'locker@orders.test', locationId: '4321' },
      items: [{ compartmentSize: 2, weight: 0 }],
    })
    expect(o).toMatchObject({ status: 'PROCESSING', trackingNumber: '9219709201', trackingUrl: 'https://boxnow.cy/en/track' })
    const [s] = await shipmentsForOrder(id)
    expect(s).toMatchObject({ parcelId: '9219709201', deliveryRequestId: '42224', state: 'new', paymentMode: 'cod' })
    await expect(createBoxNowShipment(id, { compartmentSize: 2, by: null })).rejects.toThrow('already has')
  })

  it("BOX NOW's refusal reaches staff with its code, and nothing is recorded", async () => {
    const id = await lockerOrder()
    refuseCreate = { code: 'P402', message: 'Invalid destination' }
    await expect(createBoxNowShipment(id, { compartmentSize: 1, by: null })).rejects.toThrow(/P402: The chosen locker is not valid/)
    expect(await shipmentsForOrder(id)).toHaveLength(0)
    expect((await order(id)).status).toBe('PENDING')
  })

  it('tracking moves the order: on its way, then collected (cash recorded as paid)', async () => {
    const id = await lockerOrder()
    await createBoxNowShipment(id, { compartmentSize: 2, by: null })

    parcelState = 'in-final-destination'
    parcelEvents = [{ type: 'final-destination', locationDisplayName: 'AlphaMega Larnaca', createTime: '2026-10-22T10:00:00Z' }]
    /* The webhook names the parcel; the state is read from BOX NOW. */
    await refreshByParcelId('9219709201')
    expect((await order(id)).status).toBe('SHIPPED')
    const [s] = await shipmentsForOrder(id)
    expect(s).toMatchObject({ state: 'in-final-destination', lastEvent: 'final-destination', lastEventPlace: 'AlphaMega Larnaca' })

    parcelState = 'delivered'
    parcelEvents.push({ type: 'delivered', createTime: '2026-10-22T12:00:00Z' })
    await db.update(shipments).set({ checkedAt: new Date(0) })
    expect(await pollShipments()).toBe(1)
    const o = await order(id)
    expect(o.status).toBe('DELIVERED')
    expect(o.paidAt).not.toBeNull()
    const [p] = await db.select().from(payments).where(eq(payments.orderId, id))
    expect(p.status).toBe('SUCCEEDED')
  })

  it('a webhook for an unknown parcel changes nothing', async () => {
    expect(await refreshByParcelId('0000000000')).toBeNull()
  })

  it('cancelling the order cancels a parcel BOX NOW has not received', async () => {
    const id = await lockerOrder()
    await createBoxNowShipment(id, { compartmentSize: 2, by: null })
    await cancelOrder(id, { reason: 'test', by: null })
    expect(calls.some((c) => c.path === '/api/v1/parcels/9219709201:cancel')).toBe(true)
    const [s] = await shipmentsForOrder(id)
    expect(s.cancelledAt).not.toBeNull()
    expect((await order(id)).trackingNumber).toBeNull()
  })
})
