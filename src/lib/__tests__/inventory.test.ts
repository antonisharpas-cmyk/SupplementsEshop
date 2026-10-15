/* ============================================================================
 * The tests that matter most in this codebase.
 *
 * These run against a REAL Postgres, not a mock. Mocking the database would
 * test nothing here: the entire correctness argument rests on Postgres row
 * locks serialising concurrent transactions, which a mock cannot reproduce.
 *
 * Spec section 39 asks specifically for the two-users-one-item case, and
 * specifically forbids solving it client-side. That is the first test below.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import {
  carts,
  categories,
  inventory,
  inventoryReservations,
  productVariants,
  products,
} from '@/db/schema'
import {
  consumeCartReservations,
  getStock,
  releaseCart,
  reserveForCart,
  reserveManyForCart,
  setOnHand,
  sweepExpiredReservations,
} from '../inventory'

let categoryId: string
let productId: string
let variantA: string
let variantB: string
const cartIds: string[] = []

async function freshFixture(stockA: number, stockB = 0) {
  /* Order matters: reservations reference carts, carts are independent. */
  await db.delete(inventoryReservations)
  await db.delete(carts)
  await db.delete(inventory)
  await db.delete(productVariants)
  await db.delete(products)
  await db.delete(categories)
  cartIds.length = 0

  const [cat] = await db
    .insert(categories)
    .values({ slug: 'test-cat', name: { en: 'Test' } })
    .returning({ id: categories.id })
  categoryId = cat.id

  const [prod] = await db
    .insert(products)
    .values({
      categoryId,
      slug: 'test-hoodie',
      name: { en: 'Test Hoodie', el: 'Δοκιμή', ru: 'Тест' },
      priceCents: 5900,
      isActive: true,
    })
    .returning({ id: products.id })
  productId = prod.id

  const [a, b] = await db
    .insert(productVariants)
    .values([
      { productId, sku: 'TH-BLK-M', size: 'M', colorHex: '#000000' },
      { productId, sku: 'TH-BLK-L', size: 'L', colorHex: '#000000' },
    ])
    .returning({ id: productVariants.id })
  variantA = a.id
  variantB = b.id

  await db.insert(inventory).values([
    { variantId: variantA, onHand: stockA, reserved: 0 },
    { variantId: variantB, onHand: stockB, reserved: 0 },
  ])
}

async function makeCarts(n: number) {
  const rows = await db
    .insert(carts)
    .values(
      Array.from({ length: n }, (_, i) => ({ anonymousToken: `anon-${Date.now()}-${i}-${Math.random()}` })),
    )
    .returning({ id: carts.id })
  cartIds.push(...rows.map((r) => r.id))
  return rows.map((r) => r.id)
}

async function stockOf(variantId: string) {
  const [row] = await db
    .select({
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      available: sql<number>`${inventory.onHand} - ${inventory.reserved}`.mapWith(Number),
    })
    .from(inventory)
    .where(eq(inventory.variantId, variantId))
  return row
}

afterAll(async () => {
  await pool.end()
})

/* ========================================================================== */

describe('the last item, contested', () => {
  beforeEach(async () => {
    await freshFixture(1)
  })

  it('lets exactly one of two simultaneous carts reserve it', async () => {
    const [cartA, cartB] = await makeCarts(2)

    /* Fired without awaiting in between — both transactions are open at once. */
    const [resA, resB] = await Promise.all([
      reserveForCart(cartA, { variantId: variantA, quantity: 1 }),
      reserveForCart(cartB, { variantId: variantA, quantity: 1 }),
    ])

    const winners = [resA, resB].filter((r) => r.ok)
    const losers = [resA, resB].filter((r) => !r.ok)

    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]).toMatchObject({ ok: false, reason: 'OUT_OF_STOCK', available: 0 })

    const stock = await stockOf(variantA)
    expect(stock).toMatchObject({ onHand: 1, reserved: 1, available: 0 })
  })

  it('lets exactly one of twenty simultaneous carts reserve it', async () => {
    const carts20 = await makeCarts(20)

    const results = await Promise.all(
      carts20.map((cartId) => reserveForCart(cartId, { variantId: variantA, quantity: 1 })),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(19)

    /* Every loser must get an actionable reason, not a crash. */
    for (const r of results.filter((r) => !r.ok)) {
      expect(r).toMatchObject({ ok: false, reason: 'OUT_OF_STOCK' })
    }

    const stock = await stockOf(variantA)
    expect(stock.reserved).toBe(1)
    expect(stock.available).toBe(0)

    const active = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(inventoryReservations)
      .where(eq(inventoryReservations.status, 'ACTIVE'))
    expect(active[0].n).toBe(1)
  })

  it('never oversells when five carts race for three units', async () => {
    await freshFixture(3)
    const five = await makeCarts(5)

    const results = await Promise.all(
      five.map((cartId) => reserveForCart(cartId, { variantId: variantA, quantity: 1 })),
    )

    expect(results.filter((r) => r.ok)).toHaveLength(3)
    expect(results.filter((r) => !r.ok)).toHaveLength(2)

    const stock = await stockOf(variantA)
    expect(stock).toMatchObject({ onHand: 3, reserved: 3, available: 0 })
  })

  it('refuses a quantity larger than the shelf and says what is left', async () => {
    await freshFixture(2)
    const [cart] = await makeCarts(1)

    const res = await reserveForCart(cart, { variantId: variantA, quantity: 5 })

    expect(res).toMatchObject({ ok: false, reason: 'INSUFFICIENT_STOCK', available: 2 })
    const stock = await stockOf(variantA)
    expect(stock.reserved).toBe(0)
  })
})

/* ========================================================================== */

describe('a cart adjusting its own hold', () => {
  beforeEach(async () => {
    await freshFixture(5)
  })

  it('treats quantity as a total, not a delta, and does not stack holds', async () => {
    const [cart] = await makeCarts(1)

    await reserveForCart(cart, { variantId: variantA, quantity: 2 })
    await reserveForCart(cart, { variantId: variantA, quantity: 3 })

    const stock = await stockOf(variantA)
    expect(stock.reserved).toBe(3) // not 5

    const rows = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(inventoryReservations)
      .where(
        and(eq(inventoryReservations.cartId, cart), eq(inventoryReservations.status, 'ACTIVE')),
      )
    expect(rows[0].n).toBe(1)
  })

  it('releases stock back when the quantity goes down', async () => {
    const [cart] = await makeCarts(1)

    await reserveForCart(cart, { variantId: variantA, quantity: 4 })
    expect((await stockOf(variantA)).available).toBe(1)

    await reserveForCart(cart, { variantId: variantA, quantity: 1 })
    expect((await stockOf(variantA)).available).toBe(4)
  })

  it('can take the last unit it already holds without competing with itself', async () => {
    await freshFixture(1)
    const [cart] = await makeCarts(1)

    const first = await reserveForCart(cart, { variantId: variantA, quantity: 1 })
    expect(first.ok).toBe(true)

    /* Re-reserving the same quantity must succeed — the cart's own hold is not
       competition. A naive `available >= quantity` check fails this. */
    const again = await reserveForCart(cart, { variantId: variantA, quantity: 1 })
    expect(again.ok).toBe(true)

    expect((await stockOf(variantA)).reserved).toBe(1)
  })
})

/* ========================================================================== */

describe('expiry returns stock to the shelf', () => {
  beforeEach(async () => {
    await freshFixture(1)
  })

  it('frees the item for the next customer once the hold lapses', async () => {
    const [cartA, cartB] = await makeCarts(2)

    const held = await reserveForCart(cartA, { variantId: variantA, quantity: 1 }, { ttlSeconds: 1 })
    expect(held.ok).toBe(true)

    const blocked = await reserveForCart(cartB, { variantId: variantA, quantity: 1 })
    expect(blocked).toMatchObject({ ok: false, reason: 'OUT_OF_STOCK' })

    /* Let it lapse. */
    await new Promise((r) => setTimeout(r, 1100))

    /* No sweep job has run. The next reservation attempt must still see the
       item as available, because expiry is handled inline. */
    const now = await reserveForCart(cartB, { variantId: variantA, quantity: 1 })
    expect(now.ok).toBe(true)

    const stock = await stockOf(variantA)
    expect(stock).toMatchObject({ onHand: 1, reserved: 1, available: 0 })
  })

  it('sweeps abandoned holds nobody is competing for', async () => {
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 1 }, { ttlSeconds: 1 })
    expect((await stockOf(variantA)).available).toBe(0)

    await new Promise((r) => setTimeout(r, 1100))

    const { released } = await sweepExpiredReservations()
    expect(released).toBe(1)
    expect((await stockOf(variantA)).available).toBe(1)
  })

  it('does not double-release when two sweeps run at once', async () => {
    await freshFixture(4)
    const four = await makeCarts(4)
    for (const cart of four) {
      await reserveForCart(cart, { variantId: variantA, quantity: 1 }, { ttlSeconds: 1 })
    }
    expect((await stockOf(variantA)).reserved).toBe(4)

    await new Promise((r) => setTimeout(r, 1100))

    const [s1, s2, s3] = await Promise.all([
      sweepExpiredReservations(),
      sweepExpiredReservations(),
      sweepExpiredReservations(),
    ])

    /* Exactly four releases in total, however they were divided up. */
    expect(s1.released + s2.released + s3.released).toBe(4)

    const stock = await stockOf(variantA)
    expect(stock).toMatchObject({ onHand: 4, reserved: 0, available: 4 })
  })
})

/* ========================================================================== */

describe('releasing a cart', () => {
  it('returns every line to the shelf', async () => {
    await freshFixture(3, 3)
    const [cart] = await makeCarts(1)

    await reserveForCart(cart, { variantId: variantA, quantity: 2 })
    await reserveForCart(cart, { variantId: variantB, quantity: 1 })

    const released = await releaseCart(cart)
    expect(released).toBe(2)

    expect((await stockOf(variantA)).available).toBe(3)
    expect((await stockOf(variantB)).available).toBe(3)
  })

  it('is safe to call twice', async () => {
    await freshFixture(2)
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 1 })

    expect(await releaseCart(cart)).toBe(1)
    expect(await releaseCart(cart)).toBe(0)
    expect((await stockOf(variantA)).available).toBe(2)
  })
})

/* ========================================================================== */

describe('multi-line reservation is all or nothing', () => {
  it('holds nothing when any single line cannot be satisfied', async () => {
    await freshFixture(5, 1)
    const [cart] = await makeCarts(1)

    const res = await reserveManyForCart(cart, [
      { variantId: variantA, quantity: 2 }, // fine
      { variantId: variantB, quantity: 3 }, // only 1 exists
    ])

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.failures).toHaveLength(1)
      expect(res.failures[0]).toMatchObject({ variantId: variantB, available: 1 })
    }

    /* The line that *could* have been reserved must not have been. */
    expect((await stockOf(variantA)).reserved).toBe(0)
    expect((await stockOf(variantB)).reserved).toBe(0)
  })

  it('holds every line when they all fit', async () => {
    await freshFixture(5, 5)
    const [cart] = await makeCarts(1)

    const res = await reserveManyForCart(cart, [
      { variantId: variantA, quantity: 2 },
      { variantId: variantB, quantity: 3 },
    ])

    expect(res.ok).toBe(true)
    expect((await stockOf(variantA)).reserved).toBe(2)
    expect((await stockOf(variantB)).reserved).toBe(3)
  })

  it('does not deadlock when two carts take the same pair in opposite order', async () => {
    await freshFixture(10, 10)
    const [cart1, cart2] = await makeCarts(2)

    /* Without deterministic lock ordering this is the classic deadlock. */
    const [r1, r2] = await Promise.all([
      reserveManyForCart(cart1, [
        { variantId: variantA, quantity: 1 },
        { variantId: variantB, quantity: 1 },
      ]),
      reserveManyForCart(cart2, [
        { variantId: variantB, quantity: 1 },
        { variantId: variantA, quantity: 1 },
      ]),
    ])

    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect((await stockOf(variantA)).reserved).toBe(2)
    expect((await stockOf(variantB)).reserved).toBe(2)
  })
})

/* ========================================================================== */

describe('consuming a reservation into a sale', () => {
  it('drops on-hand and reserved together, leaving available unchanged', async () => {
    await freshFixture(3)
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 2 })

    const before = await stockOf(variantA)
    expect(before).toMatchObject({ onHand: 3, reserved: 2, available: 1 })

    await db.transaction(async (tx) => {
      await consumeCartReservations(tx, cart, crypto.randomUUID())
    })

    const after = await stockOf(variantA)
    expect(after).toMatchObject({ onHand: 1, reserved: 0, available: 1 })
  })

  it('refuses to consume a hold that already expired', async () => {
    await freshFixture(2)
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 1 }, { ttlSeconds: 1 })

    await new Promise((r) => setTimeout(r, 1100))
    await sweepExpiredReservations()

    await expect(
      db.transaction(async (tx) => consumeCartReservations(tx, cart, crypto.randomUUID())),
    ).rejects.toThrow(/expired/i)

    /* Stock must be back on the shelf, not consumed. */
    expect((await stockOf(variantA)).onHand).toBe(2)
  })
})

/* ========================================================================== */

describe('admin stock edits respect live carts', () => {
  it('refuses to set stock below what customers are holding', async () => {
    await freshFixture(5)
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 3 })

    await expect(setOnHand(variantA, 1)).rejects.toThrow(/held in customer carts/i)

    /* Down to exactly the reserved amount is allowed. */
    const ok = await setOnHand(variantA, 3)
    expect(ok).toMatchObject({ onHand: 3, reserved: 3, available: 0 })
  })

  it('rejects a negative count', async () => {
    await freshFixture(1)
    await expect(setOnHand(variantA, -1)).rejects.toThrow(/whole number/i)
  })
})

/* ========================================================================== */

describe('the stock read model', () => {
  it('reports low stock and out of stock correctly', async () => {
    await freshFixture(2, 0)
    const view = await getStock([variantA, variantB])

    expect(view.get(variantA)).toMatchObject({ available: 2, inStock: true, isLowStock: true })
    expect(view.get(variantB)).toMatchObject({ available: 0, inStock: false, isLowStock: false })
  })

  it('shows zero available while an item sits in someone else’s cart', async () => {
    await freshFixture(1)
    const [cart] = await makeCarts(1)
    await reserveForCart(cart, { variantId: variantA, quantity: 1 })

    const view = await getStock([variantA])
    expect(view.get(variantA)).toMatchObject({ onHand: 1, available: 0, inStock: false })
  })
})
