/* ============================================================================
 * INVENTORY RESERVATIONS — spec sections 12, 28 and 39.
 *
 * The requirement, restated: two people click "Add to cart" on the last item at
 * the same millisecond. Exactly one may succeed. The other must be told it is
 * gone. This must be true even if both requests land on different serverless
 * instances that know nothing about each other.
 *
 * How it is guaranteed
 * --------------------
 * Every mutation opens a transaction and takes `SELECT … FOR UPDATE` on the
 * inventory row before reading `available`. Postgres serialises the second
 * transaction behind the first, so the second one reads the *post-first-write*
 * value and correctly sees zero available. No application-level locking, no
 * distributed lock service, no polling, and nothing that depends on both
 * requests hitting the same process.
 *
 * Belt and braces: CHECK (reserved <= on_hand) in constraints.sql means that
 * even a future bug that skipped the lock would abort the transaction rather
 * than oversell.
 *
 * Deadlock avoidance
 * ------------------
 * A cart reserving several variants at once locks them in sorted id order.
 * Two carts holding the same two items in opposite orders would otherwise
 * deadlock. Sorting gives every transaction the same lock order.
 *
 * Expiry
 * ------
 * Reservations carry an `expiresAt`. Rather than relying only on a background
 * job, every reservation attempt first releases *that variant's* expired holds
 * inside the same transaction. So the shelf is always accurate at the moment it
 * matters, even if the sweep job is not running at all. `sweepExpired()` exists
 * as well, to return stock for abandoned carts nobody is competing for.
 * ========================================================================== */

import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { db, type Tx } from '@/db'
import { inventory, inventoryReservations, productVariants, products } from '@/db/schema'
import { getSetting } from './settings'

export type ReserveRequest = { variantId: string; quantity: number }

export type ReserveOutcome =
  | { ok: true; reservationId: string; expiresAt: Date; available: number }
  | {
      ok: false
      reason:
        | 'OUT_OF_STOCK'
        | 'INSUFFICIENT_STOCK'
        | 'NO_SUCH_VARIANT'
        | 'INVALID_QUANTITY'
        /** The product is in the shop but marked sold out by the owner. */
        | 'SOLD_OUT'
      /** What the customer could actually have, so the UI can offer it. */
      available: number
      variantId: string
    }

export class InventoryError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'InventoryError'
  }
}

/* -------------------------------------------------------------- internals -- */

/**
 * Release every expired ACTIVE reservation for the given variants and return
 * the stock. MUST be called inside a transaction that already holds, or is
 * about to take, the inventory row locks.
 *
 * Returns how many reservations were released, for logging and tests.
 */
async function releaseExpiredFor(tx: Tx, variantIds: string[], now: Date): Promise<number> {
  if (variantIds.length === 0) return 0

  /* Claim the expired rows first by flipping their status, so two concurrent
     sweeps cannot both decrement `reserved` for the same reservation. The
     UPDATE … RETURNING is atomic: whoever flips the row owns the decrement. */
  const expired = await tx
    .update(inventoryReservations)
    .set({ status: 'RELEASED', releasedAt: now })
    .where(
      and(
        inArray(inventoryReservations.variantId, variantIds),
        eq(inventoryReservations.status, 'ACTIVE'),
        lt(inventoryReservations.expiresAt, now),
      ),
    )
    .returning({
      id: inventoryReservations.id,
      variantId: inventoryReservations.variantId,
      quantity: inventoryReservations.quantity,
    })

  if (expired.length === 0) return 0

  /* Sum per variant, then one UPDATE per variant. */
  const byVariant = new Map<string, number>()
  for (const r of expired) {
    byVariant.set(r.variantId, (byVariant.get(r.variantId) ?? 0) + r.quantity)
  }

  for (const [variantId, qty] of byVariant) {
    await tx
      .update(inventory)
      .set({
        /* GREATEST guards the floor: if bookkeeping ever drifted, we clamp at
           zero instead of aborting the customer's request on a CHECK. */
        reserved: sql`GREATEST(${inventory.reserved} - ${qty}, 0)`,
        updatedAt: now,
      })
      .where(eq(inventory.variantId, variantId))
  }

  return expired.length
}

/** Locks inventory rows in a deterministic order and returns their state. */
async function lockInventoryRows(tx: Tx, variantIds: string[]) {
  const ordered = [...new Set(variantIds)].sort()
  if (ordered.length === 0) return new Map<string, { onHand: number; reserved: number }>()

  /* Drizzle's .for('update') emits FOR UPDATE; ORDER BY inside the locking
     select is what makes the lock order deterministic. */
  const rows = await tx
    .select({
      variantId: inventory.variantId,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
    })
    .from(inventory)
    .where(inArray(inventory.variantId, ordered))
    .orderBy(inventory.variantId)
    .for('update')

  return new Map(rows.map((r) => [r.variantId, { onHand: r.onHand, reserved: r.reserved }]))
}

/* ------------------------------------------------------------------ public -- */

/**
 * Reserve stock for a cart. Idempotent per (cart, variant): calling it again
 * with a new quantity adjusts the existing hold rather than stacking a second
 * one, and refreshes the expiry.
 *
 * `quantity` is the TOTAL the cart should hold for that variant, not a delta —
 * matching how a quantity stepper in the UI actually behaves.
 */
export async function reserveForCart(
  cartId: string,
  request: ReserveRequest,
  opts: { ttlSeconds?: number } = {},
): Promise<ReserveOutcome> {
  const { variantId, quantity } = request

  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: 'INVALID_QUANTITY', available: 0, variantId }
  }

  /* Can this be bought at all? Checked here, on the server, because the
     browser can post any variant id it likes: a hidden product, a retired
     size or a product marked sold out must not be reservable just because
     someone knows its id. Hidden answers exactly like "no such thing". */
  const [sellable] = await db
    .select({
      productActive: products.isActive,
      variantActive: productVariants.isActive,
      availability: products.availability,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1)
  if (!sellable || !sellable.productActive || !sellable.variantActive) {
    return { ok: false, reason: 'NO_SUCH_VARIANT', available: 0, variantId }
  }
  if (sellable.availability === 'SOLD_OUT') {
    return { ok: false, reason: 'SOLD_OUT', available: 0, variantId }
  }

  const ttl = opts.ttlSeconds ?? (await getSetting('reservation_ttl_seconds'))
  const maxPerLine = await getSetting('max_qty_per_line')
  if (quantity > maxPerLine) {
    return { ok: false, reason: 'INVALID_QUANTITY', available: maxPerLine, variantId }
  }

  return db.transaction(async (tx) => {
    const now = new Date()

    /* 1. Return anything this variant was holding past its expiry, so an
          abandoned cart cannot keep the last item off the shelf. */
    await releaseExpiredFor(tx, [variantId], now)

    /* 2. Take the row lock. Everything after this point is serialised against
          any other transaction touching the same variant. */
    const locked = await lockInventoryRows(tx, [variantId])
    const row = locked.get(variantId)
    if (!row) {
      return { ok: false as const, reason: 'NO_SUCH_VARIANT' as const, available: 0, variantId }
    }

    /* 3. What does this cart already hold? Its own hold is not competition. */
    const [existing] = await tx
      .select({
        id: inventoryReservations.id,
        quantity: inventoryReservations.quantity,
      })
      .from(inventoryReservations)
      .where(
        and(
          eq(inventoryReservations.cartId, cartId),
          eq(inventoryReservations.variantId, variantId),
          eq(inventoryReservations.status, 'ACTIVE'),
        ),
      )
      .limit(1)

    const alreadyHeld = existing?.quantity ?? 0
    const availableToThisCart = row.onHand - row.reserved + alreadyHeld
    const delta = quantity - alreadyHeld

    if (delta > 0 && availableToThisCart < quantity) {
      return {
        ok: false as const,
        reason: availableToThisCart <= 0 ? ('OUT_OF_STOCK' as const) : ('INSUFFICIENT_STOCK' as const),
        available: Math.max(0, availableToThisCart),
        variantId,
      }
    }

    const expiresAt = new Date(now.getTime() + ttl * 1000)

    /* 4. Move the reserved counter by the delta only. */
    if (delta !== 0) {
      await tx
        .update(inventory)
        .set({ reserved: sql`${inventory.reserved} + ${delta}`, updatedAt: now })
        .where(eq(inventory.variantId, variantId))
    }

    /* 5. Record or refresh the hold. */
    let reservationId: string
    if (existing) {
      await tx
        .update(inventoryReservations)
        .set({ quantity, expiresAt })
        .where(eq(inventoryReservations.id, existing.id))
      reservationId = existing.id
    } else {
      const [created] = await tx
        .insert(inventoryReservations)
        .values({ cartId, variantId, quantity, expiresAt, status: 'ACTIVE' })
        .returning({ id: inventoryReservations.id })
      reservationId = created.id
    }

    return {
      ok: true as const,
      reservationId,
      expiresAt,
      available: row.onHand - row.reserved - delta,
    }
  })
}

/**
 * Reserve several variants atomically — used at checkout, where a partial
 * reservation would be worse than none. Either every line is held, or nothing
 * changes and the caller is told which line failed.
 */
export async function reserveManyForCart(
  cartId: string,
  requests: ReserveRequest[],
  opts: { ttlSeconds?: number } = {},
): Promise<{ ok: true; expiresAt: Date } | { ok: false; failures: ReserveOutcome[] }> {
  if (requests.length === 0) return { ok: true, expiresAt: new Date() }

  const ttl = opts.ttlSeconds ?? (await getSetting('reservation_ttl_seconds'))

  try {
    return await db.transaction(async (tx) => {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + ttl * 1000)
      const variantIds = requests.map((r) => r.variantId)

      await releaseExpiredFor(tx, variantIds, now)

      /* One locking select for all variants, in sorted order — this is the
         deadlock-avoidance step. */
      const locked = await lockInventoryRows(tx, variantIds)

      const held = await tx
        .select({
          variantId: inventoryReservations.variantId,
          id: inventoryReservations.id,
          quantity: inventoryReservations.quantity,
        })
        .from(inventoryReservations)
        .where(
          and(
            eq(inventoryReservations.cartId, cartId),
            eq(inventoryReservations.status, 'ACTIVE'),
            inArray(inventoryReservations.variantId, variantIds),
          ),
        )
      const heldBy = new Map(held.map((h) => [h.variantId, h]))

      const failures: ReserveOutcome[] = []
      for (const req of requests) {
        const row = locked.get(req.variantId)
        if (!row) {
          failures.push({
            ok: false,
            reason: 'NO_SUCH_VARIANT',
            available: 0,
            variantId: req.variantId,
          })
          continue
        }
        const already = heldBy.get(req.variantId)?.quantity ?? 0
        const availableToCart = row.onHand - row.reserved + already
        if (req.quantity > availableToCart) {
          failures.push({
            ok: false,
            reason: availableToCart <= 0 ? 'OUT_OF_STOCK' : 'INSUFFICIENT_STOCK',
            available: Math.max(0, availableToCart),
            variantId: req.variantId,
          })
        }
      }

      /* All-or-nothing: roll back so no partial holds linger. */
      if (failures.length > 0) {
        throw new PartialReservation(failures)
      }

      for (const req of requests) {
        const already = heldBy.get(req.variantId)
        const delta = req.quantity - (already?.quantity ?? 0)
        if (delta !== 0) {
          await tx
            .update(inventory)
            .set({ reserved: sql`${inventory.reserved} + ${delta}`, updatedAt: now })
            .where(eq(inventory.variantId, req.variantId))
        }
        if (already) {
          await tx
            .update(inventoryReservations)
            .set({ quantity: req.quantity, expiresAt })
            .where(eq(inventoryReservations.id, already.id))
        } else {
          await tx.insert(inventoryReservations).values({
            cartId,
            variantId: req.variantId,
            quantity: req.quantity,
            expiresAt,
            status: 'ACTIVE',
          })
        }
      }

      return { ok: true as const, expiresAt }
    })
  } catch (err) {
    if (err instanceof PartialReservation) return { ok: false, failures: err.failures }
    throw err
  }
}

/* Thrown purely to force a rollback; never escapes reserveManyForCart. */
class PartialReservation extends Error {
  constructor(readonly failures: ReserveOutcome[]) {
    super('partial reservation')
  }
}

/** Drop a single line's hold — the customer removed it from the cart. */
export async function releaseForCartVariant(cartId: string, variantId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const now = new Date()
    await lockInventoryRows(tx, [variantId])

    const released = await tx
      .update(inventoryReservations)
      .set({ status: 'RELEASED', releasedAt: now })
      .where(
        and(
          eq(inventoryReservations.cartId, cartId),
          eq(inventoryReservations.variantId, variantId),
          eq(inventoryReservations.status, 'ACTIVE'),
        ),
      )
      .returning({ quantity: inventoryReservations.quantity })

    if (released.length === 0) return false

    const total = released.reduce((s, r) => s + r.quantity, 0)
    await tx
      .update(inventory)
      .set({ reserved: sql`GREATEST(${inventory.reserved} - ${total}, 0)`, updatedAt: now })
      .where(eq(inventory.variantId, variantId))

    return true
  })
}

/** Release everything a cart holds — cart emptied, session abandoned, payment
 *  cancelled, or the customer walked away from Stripe. */
export async function releaseCart(cartId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const now = new Date()

    const active = await tx
      .select({ variantId: inventoryReservations.variantId })
      .from(inventoryReservations)
      .where(
        and(eq(inventoryReservations.cartId, cartId), eq(inventoryReservations.status, 'ACTIVE')),
      )
    if (active.length === 0) return 0

    await lockInventoryRows(
      tx,
      active.map((a) => a.variantId),
    )

    const released = await tx
      .update(inventoryReservations)
      .set({ status: 'RELEASED', releasedAt: now })
      .where(
        and(eq(inventoryReservations.cartId, cartId), eq(inventoryReservations.status, 'ACTIVE')),
      )
      .returning({
        variantId: inventoryReservations.variantId,
        quantity: inventoryReservations.quantity,
      })

    const byVariant = new Map<string, number>()
    for (const r of released) {
      byVariant.set(r.variantId, (byVariant.get(r.variantId) ?? 0) + r.quantity)
    }
    for (const [variantId, qty] of byVariant) {
      await tx
        .update(inventory)
        .set({ reserved: sql`GREATEST(${inventory.reserved} - ${qty}, 0)`, updatedAt: now })
        .where(eq(inventory.variantId, variantId))
    }

    return released.length
  })
}

/**
 * Convert a cart's holds into a sale: the goods have left the building.
 * `onHand` drops and `reserved` drops by the same amount, so `available` is
 * unchanged — the item was already off the shelf while reserved.
 *
 * Called inside the order-creation transaction, so an order and its stock
 * movement commit or fail together.
 */
export async function consumeCartReservations(
  tx: Tx,
  cartId: string,
  orderId: string,
): Promise<{ consumed: number }> {
  const now = new Date()

  const active = await tx
    .select({
      id: inventoryReservations.id,
      variantId: inventoryReservations.variantId,
      quantity: inventoryReservations.quantity,
    })
    .from(inventoryReservations)
    .where(
      and(eq(inventoryReservations.cartId, cartId), eq(inventoryReservations.status, 'ACTIVE')),
    )

  if (active.length === 0) {
    throw new InventoryError(
      'This cart no longer holds any stock, the reservation expired.',
      'RESERVATION_EXPIRED',
    )
  }

  await lockInventoryRows(
    tx,
    active.map((a) => a.variantId),
  )

  /* Re-read under the lock and confirm the holds are still ACTIVE. A sweep may
     have expired them between the select above and the lock. */
  const stillActive = await tx
    .update(inventoryReservations)
    .set({ status: 'CONSUMED', consumedAt: now, orderId })
    .where(
      and(
        inArray(
          inventoryReservations.id,
          active.map((a) => a.id),
        ),
        eq(inventoryReservations.status, 'ACTIVE'),
      ),
    )
    .returning({
      variantId: inventoryReservations.variantId,
      quantity: inventoryReservations.quantity,
    })

  if (stillActive.length !== active.length) {
    throw new InventoryError(
      'Your reservation expired while the payment was being taken.',
      'RESERVATION_EXPIRED',
    )
  }

  const byVariant = new Map<string, number>()
  for (const r of stillActive) {
    byVariant.set(r.variantId, (byVariant.get(r.variantId) ?? 0) + r.quantity)
  }

  for (const [variantId, qty] of byVariant) {
    await tx
      .update(inventory)
      .set({
        onHand: sql`${inventory.onHand} - ${qty}`,
        reserved: sql`${inventory.reserved} - ${qty}`,
        updatedAt: now,
      })
      .where(eq(inventory.variantId, variantId))
  }

  return { consumed: stillActive.length }
}

/** Refresh a cart's expiry while the customer is actively shopping, so a slow
 *  checkout does not lose the basket mid-payment. */
export async function extendCartReservations(cartId: string, ttlSeconds?: number) {
  const ttl = ttlSeconds ?? (await getSetting('reservation_ttl_seconds'))
  const expiresAt = new Date(Date.now() + ttl * 1000)
  const rows = await db
    .update(inventoryReservations)
    .set({ expiresAt })
    .where(
      and(eq(inventoryReservations.cartId, cartId), eq(inventoryReservations.status, 'ACTIVE')),
    )
    .returning({ id: inventoryReservations.id })
  return { extended: rows.length, expiresAt }
}

/**
 * Background sweep for abandoned carts. The per-request release above keeps
 * contested stock accurate; this returns stock nobody is asking for, so the
 * admin inventory view and the low-stock alerts stay truthful.
 */
export async function sweepExpiredReservations(limit = 500): Promise<{ released: number }> {
  const now = new Date()

  const due = await db
    .select({ variantId: inventoryReservations.variantId })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.status, 'ACTIVE'), lt(inventoryReservations.expiresAt, now)))
    .limit(limit)

  if (due.length === 0) return { released: 0 }

  const variantIds = [...new Set(due.map((d) => d.variantId))]

  const released = await db.transaction(async (tx) => {
    await lockInventoryRows(tx, variantIds)
    return releaseExpiredFor(tx, variantIds, new Date())
  })

  return { released }
}

/* ------------------------------------------------------------- read models -- */

export type StockView = {
  variantId: string
  onHand: number
  reserved: number
  available: number
  lowStockThreshold: number
  isLowStock: boolean
  inStock: boolean
}

/** What the storefront shows. Never trust a client-side copy of this. */
export async function getStock(variantIds: string[]): Promise<Map<string, StockView>> {
  if (variantIds.length === 0) return new Map()

  const rows = await db
    .select({
      variantId: inventory.variantId,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      lowStockThreshold: inventory.lowStockThreshold,
      available: sql<number>`${inventory.onHand} - ${inventory.reserved}`.mapWith(Number),
    })
    .from(inventory)
    .where(inArray(inventory.variantId, variantIds))

  return new Map(
    rows.map((r) => [
      r.variantId,
      {
        ...r,
        isLowStock: r.available > 0 && r.available <= r.lowStockThreshold,
        inStock: r.available > 0,
      },
    ]),
  )
}

/** Admin: set the physical count. Cannot be set below what carts are holding,
 *  which is the honest answer — you cannot un-promise stock already promised. */
export async function setOnHand(variantId: string, onHand: number) {
  if (!Number.isInteger(onHand) || onHand < 0) {
    throw new InventoryError('Stock must be a whole number of zero or more.', 'INVALID_QUANTITY')
  }

  const result = await db.transaction(async (tx) => {
    const locked = await lockInventoryRows(tx, [variantId])
    const row = locked.get(variantId)
    if (!row) throw new InventoryError('No inventory row for that variant.', 'NO_SUCH_VARIANT')

    if (onHand < row.reserved) {
      throw new InventoryError(
        `Cannot set stock to ${onHand}: ${row.reserved} unit(s) are currently held in customer ` +
          `carts. Wait for those reservations to expire, or set it to ${row.reserved} or more.`,
        'BELOW_RESERVED',
      )
    }

    await tx
      .update(inventory)
      .set({ onHand, updatedAt: new Date() })
      .where(eq(inventory.variantId, variantId))

    return {
      onHand,
      reserved: row.reserved,
      available: onHand - row.reserved,
      wasAvailable: row.onHand - row.reserved,
    }
  })

  /* Back from nothing: anyone who asked to be told gets a "back in stock"
     email (lib/automations.ts — it re-checks everything before sending). */
  if (result.wasAvailable <= 0 && result.available > 0) {
    try {
      const { stockReplenished } = await import('@/lib/automations')
      await stockReplenished(variantId)
    } catch (err) {
      console.error('[inventory] back-in-stock scheduling failed', err)
    }
  }
  const { wasAvailable: _was, ...out } = result
  void _was
  return out
}

/** Restock after a cancellation or refund. */
export async function restock(tx: Tx, variantId: string, quantity: number) {
  if (quantity <= 0) return
  await tx
    .update(inventory)
    .set({ onHand: sql`${inventory.onHand} + ${quantity}`, updatedAt: new Date() })
    .where(eq(inventory.variantId, variantId))
}
