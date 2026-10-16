/* ============================================================================
 * CART — spec section 11, joined to the reservation system in inventory.ts.
 *
 * The design decision that matters: a cart line and a stock reservation are
 * kept in lockstep. Adding to the cart takes the item off the shelf; removing
 * it puts it back. There is no state where the cart says "1 × M" and inventory
 * disagrees, because both are written in the same operation and the reservation
 * is the thing that decides whether the line may exist at all.
 *
 * So `addToCart` can fail with OUT_OF_STOCK, and that is the normal path, not
 * an edge case.
 * ========================================================================== */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  cartItems,
  carts,
  categories,
  inventory,
  inventoryReservations,
  productImages,
  productVariants,
  products,
  promoCodes,
} from '@/db/schema'
import {
  releaseCart,
  releaseForCartVariant,
  reserveForCart,
  type ReserveOutcome,
} from './inventory'
import { priceCart, type CartLineForPricing, type CartTotals } from './pricing'
import type { Locale } from '@/config/brand'

export class CartError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_SUCH_VARIANT' | 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'INVALID_QUANTITY' | 'SOLD_OUT',
    readonly available?: number,
  ) {
    super(message)
    this.name = 'CartError'
  }
}

/* ------------------------------------------------------------- identity ---- */

/**
 * Find or create the cart for this visitor. A signed-in customer's cart is
 * keyed on their user id; a guest's on their cookie token.
 */
export async function getOrCreateCart(args: {
  userId?: string | null
  anonymousToken?: string | null
}): Promise<string> {
  if (!args.userId && !args.anonymousToken) {
    throw new Error('A cart needs either a user or an anonymous token.')
  }

  if (args.userId) {
    const [existing] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.userId, args.userId))
      .limit(1)
    if (existing) return existing.id

    const [created] = await db
      .insert(carts)
      .values({ userId: args.userId })
      .returning({ id: carts.id })
    return created.id
  }

  const token = args.anonymousToken!
  const [existing] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.anonymousToken, token))
    .limit(1)
  if (existing) return existing.id

  /* onConflictDoNothing then re-read: two parallel requests from the same new
     browser must not create two carts. */
  const [created] = await db
    .insert(carts)
    .values({ anonymousToken: token })
    .onConflictDoNothing()
    .returning({ id: carts.id })
  if (created) return created.id

  const [raced] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.anonymousToken, token))
    .limit(1)
  return raced.id
}

/**
 * On sign-in, fold the guest cart into the customer's own. Their existing
 * saved cart wins on quantity conflicts, because it is the more deliberate of
 * the two.
 */
export async function mergeGuestCart(anonymousToken: string, userId: string): Promise<void> {
  const [guest] = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.anonymousToken, anonymousToken))
    .limit(1)
  if (!guest) return

  const userCartId = await getOrCreateCart({ userId })
  if (userCartId === guest.id) return

  const guestLines = await db
    .select({ variantId: cartItems.variantId, quantity: cartItems.quantity })
    .from(cartItems)
    .where(eq(cartItems.cartId, guest.id))

  /* Give the guest's holds back to the shelf BEFORE re-reserving them for the
     account. The units are the same units: asking for them again while the
     guest cart still holds them means the last item in stock can never be
     merged — the shop would be competing with itself and the customer would
     watch their bag empty as they signed in. */
  await releaseCart(guest.id)

  /* Re-reserve against the user's cart rather than moving reservation rows,
     so the stock check runs again and the normal per-line limit applies. */
  for (const line of guestLines) {
    const existing = await db
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, userCartId), eq(cartItems.variantId, line.variantId)))
      .limit(1)

    const target = Math.max(existing[0]?.quantity ?? 0, line.quantity)
    await addToCart(userCartId, line.variantId, target).catch(() => {
      /* Out of stock during a merge is not worth failing the sign-in over —
         the line is simply dropped and the customer sees the cart as it is. */
    })
  }

  await db.delete(carts).where(eq(carts.id, guest.id))
}

/* -------------------------------------------------------------- mutations -- */

/**
 * Set a line's quantity. `quantity` is the total wanted, matching how a
 * stepper behaves. Zero removes the line.
 *
 * The reservation is taken FIRST: if the stock is not there, the cart is not
 * changed at all, so the customer never sees a line they cannot buy.
 */
export async function addToCart(
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<{ cartId: string; reservation: ReserveOutcome }> {
  if (quantity === 0) {
    await removeFromCart(cartId, variantId)
    return {
      cartId,
      reservation: { ok: false, reason: 'INVALID_QUANTITY', available: 0, variantId },
    }
  }

  const reservation = await reserveForCart(cartId, { variantId, quantity })

  if (!reservation.ok) {
    const messages: Record<string, string> = {
      OUT_OF_STOCK: 'This item is no longer available.',
      INSUFFICIENT_STOCK:
        reservation.available > 0
          ? `Only ${reservation.available} left, we have adjusted the amount you can add.`
          : 'This item is no longer available.',
      NO_SUCH_VARIANT: 'That size is no longer sold.',
      INVALID_QUANTITY: 'Choose a quantity between 1 and 20.',
      SOLD_OUT: 'This piece is sold out right now.',
    }
    throw new CartError(
      messages[reservation.reason] ?? 'This item is not available.',
      reservation.reason,
      reservation.available,
    )
  }

  await db
    .insert(cartItems)
    .values({ cartId, variantId, quantity })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: { quantity },
    })

  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId))
  await noteBagChange(cartId)

  return { cartId, reservation }
}

/**
 * Tell the automations the bag changed — (re)schedules or cancels the
 * abandoned-bag reminder (lib/automations.ts). A reminder is never worth
 * failing a customer's click over, so errors are logged and swallowed.
 * Imported lazily: automations reads carts, so a static import would be a cycle.
 */
async function noteBagChange(cartId: string) {
  try {
    const { bagChanged } = await import('@/lib/automations')
    await bagChanged(cartId)
  } catch (err) {
    console.error('[cart] abandoned-bag scheduling failed', err)
  }
}

export async function removeFromCart(cartId: string, variantId: string): Promise<void> {
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
  await releaseForCartVariant(cartId, variantId)
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId))
  await noteBagChange(cartId)
}

export async function clearCart(cartId: string): Promise<void> {
  await db.delete(cartItems).where(eq(cartItems.cartId, cartId))
  await releaseCart(cartId)
  await noteBagChange(cartId)
}

export async function setCartPromoCode(cartId: string, promoCodeId: string | null): Promise<void> {
  await db.update(carts).set({ appliedPromoCodeId: promoCodeId }).where(eq(carts.id, cartId))
}

/** The code the customer applied to this cart, if any. Stored on the cart, not
 *  in the browser, so it survives a refresh, another device and sign-in — and
 *  so the server, not the client, decides what is applied. */
export async function getCartPromoCode(cartId: string): Promise<string | null> {
  const [row] = await db
    .select({ code: promoCodes.code })
    .from(carts)
    .innerJoin(promoCodes, eq(promoCodes.id, carts.appliedPromoCodeId))
    .where(eq(carts.id, cartId))
    .limit(1)
  return row?.code ?? null
}

/** Resolve a typed code to its id, for storing on the cart. */
export async function findPromoCodeId(code: string): Promise<string | null> {
  const [row] = await db
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(sql`upper(${promoCodes.code}) = ${code.trim().toUpperCase()}`)
    .limit(1)
  return row?.id ?? null
}

/* ------------------------------------------------------------------- read -- */

export type CartLineView = {
  variantId: string
  productId: string
  productSlug: string
  productName: Record<string, string>
  categoryId: string
  sku: string
  size: string
  colorName: Record<string, string> | null
  colorHex: string | null
  imageUrl: string | null
  quantity: number
  listCents: number
  unitFinalCents: number
  unitDiscountCents: number
  lineFinalCents: number
  discountPercent: number
  /** Live availability, so the cart can warn before checkout. */
  availableIncludingThisCart: number
  isAvailable: boolean
}

export type CartView = {
  cartId: string
  lines: CartLineView[]
  totals: CartTotals
  promoCodeError: Awaited<ReturnType<typeof priceCart>>['promoCodeError']
  /** When the held stock lapses, so the UI can show a countdown. */
  reservationExpiresAt: Date | null
  isEmpty: boolean
}

/**
 * Everything the cart page and checkout need, priced server-side.
 *
 * Deliberately one query for the lines plus one for pricing, rather than an ORM
 * relation walk — a cart page must not turn into N+1 queries.
 */
export async function getCartView(
  cartId: string,
  opts: {
    deliveryOptionId?: string | null
    promoCode?: string | null
    email?: string | null
    userId?: string | null
    locale?: Locale
  } = {},
): Promise<CartView> {
  /* An explicit code (checkout previewing "what if") wins; otherwise use the
     one stored on the cart. */
  const promoCode = opts.promoCode ?? (await getCartPromoCode(cartId))

  const rows = await db
    .select({
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      sku: productVariants.sku,
      size: productVariants.size,
      colorName: productVariants.colorName,
      colorHex: productVariants.colorHex,
      priceOverride: productVariants.priceCentsOverride,
      salePriceOverride: productVariants.salePriceCentsOverride,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      productPrice: products.priceCents,
      productSale: products.salePriceCents,
      categoryId: products.categoryId,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(cartItems.createdAt)

  if (rows.length === 0) {
    const { totals, promoCodeError } = await priceCart({ lines: [] })
    return {
      cartId,
      lines: [],
      totals,
      promoCodeError,
      reservationExpiresAt: null,
      isEmpty: true,
    }
  }

  /* One image per product for the cart thumbnail. */
  const productIds = [...new Set(rows.map((r) => r.productId))]
  const images = await db
    .select({
      productId: productImages.productId,
      url: productImages.url,
      position: productImages.position,
    })
    .from(productImages)
    .where(inArray(productImages.productId, productIds))
    .orderBy(productImages.position)

  const firstImage = new Map<string, string>()
  for (const img of images) {
    if (!firstImage.has(img.productId)) firstImage.set(img.productId, img.url)
  }

  /* How much this cart itself holds, so the view can show the honest number
     "available to you" rather than a zero it caused. */
  const holds = await db
    .select({
      variantId: inventoryReservations.variantId,
      quantity: inventoryReservations.quantity,
      expiresAt: inventoryReservations.expiresAt,
    })
    .from(inventoryReservations)
    .where(
      and(eq(inventoryReservations.cartId, cartId), eq(inventoryReservations.status, 'ACTIVE')),
    )
  const heldBy = new Map(holds.map((h) => [h.variantId, h.quantity]))
  const reservationExpiresAt = holds.length
    ? holds.reduce((min, h) => (h.expiresAt < min ? h.expiresAt : min), holds[0].expiresAt)
    : null

  const pricingLines: CartLineForPricing[] = rows.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    categoryId: r.categoryId,
    quantity: r.quantity,
    listCents: r.priceOverride ?? r.productPrice,
    saleCents: r.salePriceOverride ?? r.productSale,
  }))

  const { totals, promoCodeError } = await priceCart({
    lines: pricingLines,
    deliveryOptionId: opts.deliveryOptionId ?? null,
    promoCode,
    email: opts.email ?? null,
    userId: opts.userId ?? null,
  })

  const pricedByVariant = new Map(totals.lines.map((l) => [l.variantId, l]))

  const lines: CartLineView[] = rows.map((r) => {
    const priced = pricedByVariant.get(r.variantId)!
    const onHand = r.onHand ?? 0
    const reserved = r.reserved ?? 0
    const availableIncludingThisCart = onHand - reserved + (heldBy.get(r.variantId) ?? 0)

    return {
      variantId: r.variantId,
      productId: r.productId,
      productSlug: r.productSlug,
      productName: r.productName,
      categoryId: r.categoryId,
      sku: r.sku,
      size: r.size,
      colorName: r.colorName,
      colorHex: r.colorHex,
      imageUrl: firstImage.get(r.productId) ?? null,
      quantity: r.quantity,
      listCents: priced.listCents,
      unitFinalCents: priced.unitFinalCents,
      unitDiscountCents: priced.unitDiscountCents,
      lineFinalCents: priced.lineFinalCents,
      discountPercent:
        priced.listCents > 0
          ? Math.round((priced.unitDiscountCents / priced.listCents) * 100)
          : 0,
      availableIncludingThisCart,
      isAvailable: availableIncludingThisCart >= r.quantity,
    }
  })

  return { cartId, lines, totals, promoCodeError, reservationExpiresAt, isEmpty: false }
}

/** Badge count for the header. One cheap query. */
export async function getCartCount(cartId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${cartItems.quantity}), 0)`.mapWith(Number) })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId))
  return row?.n ?? 0
}

/**
 * Housekeeping: a cart nobody has touched for a long time is abandoned. Its
 * reservations have expired already; this removes the empty shell so the table
 * does not grow without limit.
 */
export async function purgeStaleCarts(olderThanDays = 60): Promise<number> {
  const rows = await db
    .delete(carts)
    .where(
      and(
        sql`${carts.updatedAt} < now() - (${olderThanDays} || ' days')::interval`,
        sql`${carts.userId} is null`,
      ),
    )
    .returning({ id: carts.id })
  return rows.length
}

/** Category ids for the cart, used when validating a restricted promo code. */
export async function getCartCategoryIds(cartId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ categoryId: products.categoryId, parentId: categories.parentId })
    .from(cartItems)
    .innerJoin(productVariants, eq(cartItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(cartItems.cartId, cartId))

  /* A code limited to Clothing, or to Men, applies to Clothing / Men / Socks:
     every ancestor counts, all the way up. */
  const all = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories)
  const parentOf = new Map(all.map((c) => [c.id, c.parentId]))
  const ids = new Set<string>()
  for (const r of rows) {
    let cur: string | null | undefined = r.categoryId
    let guard = 0
    while (cur && guard++ < 6) {
      ids.add(cur)
      cur = parentOf.get(cur)
    }
  }
  return [...ids]
}
