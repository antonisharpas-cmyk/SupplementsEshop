/* ============================================================================
 * Shipments: an order's parcel with BOX NOW, from creation to collection.
 *
 *   create   staff press "Create BOX NOW shipment" on the order. BOX NOW returns
 *            the parcel number; the order moves to Processing and the parcel
 *            number becomes its tracking number.
 *   track    BOX NOW calls our webhook when a parcel changes. The webhook is
 *            only a nudge: the state is always read back from BOX NOW's API
 *            with our own credentials, so a forged call can change nothing.
 *            The automation clock also asks every 20 minutes, so tracking
 *            works before the webhook is registered.
 *   map      in the depot or on its way → Out for delivery (the customer gets
 *            the tracking email); collected from the locker → Delivered (a
 *            cash order is then recorded as paid). Returns, expiry and losses
 *            are written on the order for staff.
 *   cancel   only while BOX NOW has not received the parcel yet.
 * ========================================================================== */

import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { orders, shipments } from '@/db/schema'
import { BRAND } from '@/config/brand'
import {
  BOXNOW_TRACKING_URL,
  BoxNowError,
  boxnowStatus,
  cancelParcel,
  createDeliveryRequest,
  getParcel,
  parcelLabel,
} from '@/lib/boxnow'
import { OrderError, setOrderStatus } from '@/lib/orders'

/** States after which BOX NOW will not change the parcel again. */
const FINAL = ['delivered', 'returned', 'cancelled', 'canceled', 'lost']
/** On its way: in the depot, loaded, or waiting in the locker. */
const MOVING = ['in-depot', 'wait-for-load', 'in-transit', 'in-final-destination', 'final-destination', 'accepted-to-locker']
/** Something staff must look at. */
const PROBLEM = ['expired-return', 'expired', 'accepted-for-return', 'returned', 'lost', 'missing']

export type ShipmentRow = typeof shipments.$inferSelect

export async function shipmentsForOrder(orderId: string): Promise<ShipmentRow[]> {
  return db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.createdAt))
}

/** Create the BOX NOW parcel for an order. Throws OrderError with the reason. */
export async function createBoxNowShipment(orderId: string, opts: { compartmentSize: 1 | 2 | 3; by: string | null }) {
  const status = boxnowStatus()
  if (!status.canShip) throw new OrderError(`BOX NOW is not set up yet. Missing: ${status.missing.join(', ')}.`)

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId))
  if (!order) throw new OrderError('That order does not exist.')
  if (order.pickupPoint?.provider !== 'boxnow') throw new OrderError('This order is not for a BOX NOW locker.')
  if (!['PENDING', 'PAID', 'PROCESSING'].includes(order.status)) {
    throw new OrderError(`An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot be shipped.`)
  }
  if (order.paymentMethod === 'card' && !order.paidAt) throw new OrderError('This card order has not been paid yet.')

  const existing = await shipmentsForOrder(orderId)
  if (existing.some((s) => !s.cancelledAt)) throw new OrderError('This order already has a BOX NOW shipment.')

  /* Cash orders are collected by BOX NOW at the locker, if the contract allows. */
  const cod = order.paymentMethod === 'cod' && !order.paidAt
  if (cod && !status.cod) {
    throw new OrderError('This is a cash order, and cash on delivery at BOX NOW lockers is not enabled (BOXNOW_COD). Take the payment first, or enable it if your contract includes it.')
  }

  /* BOX NOW keeps every order number it has seen, so a reshipment after a
     cancel gets a suffix. */
  const reference = existing.length ? `${order.orderNumber}-${existing.length + 1}` : order.orderNumber
  let result: { deliveryRequestId: string; parcelIds: string[] }
  try {
    result = await createDeliveryRequest({
      reference,
      invoiceValueCents: order.totalCents,
      paymentMode: cod ? 'cod' : 'prepaid',
      amountToCollectCents: cod ? order.totalCents : 0,
      lockerId: order.pickupPoint.id,
      compartmentSize: opts.compartmentSize,
      recipient: { name: order.customerName, phone: order.phone ?? '', email: order.email },
      itemName: `${BRAND.name} order ${order.orderNumber}`,
    })
  } catch (err) {
    if (err instanceof BoxNowError) throw new OrderError(err.message)
    throw err
  }

  const parcelId = result.parcelIds[0]
  const now = new Date()
  const [row] = await db
    .insert(shipments)
    .values({
      orderId,
      carrier: 'boxnow',
      deliveryRequestId: result.deliveryRequestId || null,
      parcelId,
      reference,
      lockerId: order.pickupPoint.id,
      compartmentSize: opts.compartmentSize,
      paymentMode: cod ? 'cod' : 'prepaid',
      amountToCollectCents: cod ? order.totalCents : 0,
      state: 'new',
      checkedAt: now,
      createdBy: opts.by,
    })
    .returning()
  await db
    .update(orders)
    .set({ trackingNumber: parcelId, trackingUrl: BOXNOW_TRACKING_URL, updatedAt: now })
    .where(eq(orders.id, orderId))
  /* Being prepared. For a cash order this is also the confirmation email. */
  if (order.status === 'PENDING' || order.status === 'PAID') {
    await setOrderStatus(orderId, 'PROCESSING').catch((err) => console.error('[shipments] status not moved', err))
  }
  return row
}

/** Read the parcel's state from BOX NOW and move the order along with it. */
export async function refreshShipment(shipmentId: string): Promise<ShipmentRow | null> {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId))
  if (!s || !s.parcelId) return s ?? null
  const now = new Date()
  let info
  try {
    info = await getParcel(s.parcelId)
  } catch (err) {
    await db.update(shipments).set({ checkedAt: now }).where(eq(shipments.id, s.id))
    throw err
  }
  if (!info) {
    await db.update(shipments).set({ checkedAt: now }).where(eq(shipments.id, s.id))
    return s
  }
  const last = info.events.at(-1)
  const state = info.state || s.state
  const [row] = await db
    .update(shipments)
    .set({
      state,
      lastEvent: last?.type ?? s.lastEvent,
      lastEventAt: last?.at ?? s.lastEventAt,
      lastEventPlace: last?.place || s.lastEventPlace,
      cancelledAt: ['cancelled', 'canceled'].includes(state) ? (s.cancelledAt ?? now) : s.cancelledAt,
      checkedAt: now,
      updatedAt: now,
    })
    .where(eq(shipments.id, s.id))
    .returning()
  if (state !== s.state) await applyToOrder(row)
  return row
}

async function applyToOrder(s: ShipmentRow) {
  const [order] = await db.select().from(orders).where(eq(orders.id, s.orderId))
  if (!order) return
  const tracking = { trackingNumber: s.parcelId ?? undefined, trackingUrl: BOXNOW_TRACKING_URL }
  try {
    if (MOVING.includes(s.state) || s.state === 'delivered') {
      if (order.status === 'PENDING' || order.status === 'PAID') await setOrderStatus(order.id, 'PROCESSING')
      const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id))
      if (now.status === 'PROCESSING') await setOrderStatus(order.id, 'SHIPPED', tracking)
    }
    if (s.state === 'delivered') {
      const [now] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id))
      if (now.status === 'SHIPPED') await setOrderStatus(order.id, 'DELIVERED')
    }
  } catch (err) {
    console.error('[shipments] order status not moved', s.orderId, err)
  }
  if (PROBLEM.includes(s.state)) {
    const note = `BOX NOW parcel ${s.parcelId}: ${s.state.replace(/-/g, ' ')}${s.lastEventPlace ? ` (${s.lastEventPlace})` : ''}. Check the order.`
    await db
      .update(orders)
      .set({ adminNote: sql`concat_ws(E'\\n', ${orders.adminNote}, ${note}::text)`, updatedAt: new Date() })
      .where(eq(orders.id, s.orderId))
  }
}

/** The webhook's nudge: find the parcel and read its state back from BOX NOW. */
export async function refreshByParcelId(parcelId: string) {
  const [s] = await db.select({ id: shipments.id }).from(shipments).where(eq(shipments.parcelId, parcelId))
  if (!s) return null
  return refreshShipment(s.id)
}

/** Automation tick: shipments still moving, not checked for 20 minutes. */
export async function pollShipments(now = new Date(), limit = 10) {
  if (!boxnowStatus().api) return 0
  const due = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(
      and(
        isNull(shipments.cancelledAt),
        sql`${shipments.state} not in ${sql.raw(`(${FINAL.map((x) => `'${x}'`).join(',')})`)}`,
        or(isNull(shipments.checkedAt), lt(shipments.checkedAt, new Date(now.getTime() - 20 * 60_000))),
      ),
    )
    .limit(limit)
  let n = 0
  for (const d of due) {
    try {
      await refreshShipment(d.id)
      n++
    } catch (err) {
      console.error('[shipments] refresh failed', d.id, err instanceof Error ? err.message : err)
    }
  }
  return n
}

export async function cancelShipment(shipmentId: string) {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId))
  if (!s || !s.parcelId) throw new OrderError('That shipment does not exist.')
  if (s.cancelledAt) return s
  try {
    await cancelParcel(s.parcelId)
  } catch (err) {
    if (err instanceof BoxNowError) throw new OrderError(err.message)
    throw err
  }
  const now = new Date()
  const [row] = await db
    .update(shipments)
    .set({ state: 'cancelled', cancelledAt: now, updatedAt: now })
    .where(eq(shipments.id, s.id))
    .returning()
  await db
    .update(orders)
    .set({ trackingNumber: null, trackingUrl: null, updatedAt: now })
    .where(and(eq(orders.id, s.orderId), eq(orders.trackingNumber, s.parcelId)))
  return row
}

export async function shipmentLabel(shipmentId: string): Promise<{ pdf: ArrayBuffer; name: string }> {
  const [s] = await db.select().from(shipments).where(eq(shipments.id, shipmentId))
  if (!s || !s.parcelId) throw new OrderError('That shipment does not exist.')
  try {
    return { pdf: await parcelLabel(s.parcelId), name: `boxnow-${s.reference}-${s.parcelId}.pdf` }
  } catch (err) {
    if (err instanceof BoxNowError) throw new OrderError(err.message)
    throw err
  }
}

/** Orders cancelled by the shop: cancel their BOX NOW parcels too, if still possible. */
export async function cancelShipmentsForOrder(orderId: string) {
  const open = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.orderId, orderId), isNull(shipments.cancelledAt), inArray(shipments.state, ['new'])))
  for (const s of open) await cancelShipment(s.id).catch((err) => console.error('[shipments] cancel failed', err))
}
