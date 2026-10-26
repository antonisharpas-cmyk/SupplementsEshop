/* ============================================================================
 * Cart API.
 *
 * GET    — the priced cart
 * POST   — set a line's quantity (0 removes it)
 * DELETE — empty the cart
 *
 * The client sends variant ids and quantities. It never sends a price, and
 * this route never reads one from the body. Availability is decided by the
 * reservation system, so a POST can legitimately fail with 409.
 * ========================================================================== */

import { cookies } from 'next/headers'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { cartItems } from '@/db/schema'
import { CartError, addToCart, clearCart, getCartCount, getCartView, getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, getOrCreateCartToken } from '@/lib/auth/session'
import { updateCartLineSchema } from '@/lib/validation'
import { clientKey, hit } from '@/lib/rate-limit'
import { isLocale, type Locale } from '@/config/brand'

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })

/** Resolve the caller's cart, creating one (and a cookie) if needed. */
async function resolveCart() {
  const user = await getCurrentUser()
  /* A guest needs a token before a cart can exist; this sets the cookie. */
  const token = user ? null : await getOrCreateCartToken()
  const cartId = await getOrCreateCart({ userId: user?.id ?? null, anonymousToken: token })
  return { cartId, user }
}

async function currentLocale(): Promise<Locale> {
  const jar = await cookies()
  const raw = jar.get('sf_locale')?.value ?? 'en'
  return (isLocale(raw) ? raw : 'en') as Locale
}

/* -------------------------------------------------------------------- GET -- */

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const { cartId, user } = await resolveCart()
    const locale = await currentLocale()

    const view = await getCartView(cartId, {
      deliveryOptionId: url.searchParams.get('deliveryOptionId'),
      promoCode: url.searchParams.get('promoCode'),
      email: user?.email ?? null,
      userId: user?.id ?? null,
      locale,
    })

    return json({ ok: true, ...view })
  } catch (err) {
    console.error('[api/cart] GET failed', err)
    return json({ ok: false, error: 'CART_UNAVAILABLE' }, 500)
  }
}

/* ------------------------------------------------------------------- POST -- */

const MAX_PER_LINE = 20
const MAX_PER_BAG = 60
const HOLD_PER_HOUR = 150

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  /* A real shopper changes the bag a few times a minute, not hundreds. */
  if (!hit(`cart:${clientKey(request)}`, 60, 60).ok) {
    return json({ ok: false, error: 'TOO_MANY', message: 'Too many changes at once. Wait a moment and try again.' }, 429)
  }

  const parsed = updateCartLineSchema.safeParse(body)
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'That request was not valid.',
        issues: z.treeifyError(parsed.error),
      },
      422,
    )
  }

  try {
    const { cartId, user } = await resolveCart()
    const { variantId, mode } = parsed.data
    let quantity = parsed.data.quantity
    const [line] = await db
      .select({ quantity: cartItems.quantity })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
      .limit(1)
    const before = line?.quantity ?? 0
    if (mode === 'add' && quantity > 0) quantity = Math.min(MAX_PER_LINE, before + quantity)

    /* Holding stock without buying it. A bag holds what is in it for a few
       minutes, so someone who wanted to empty the shelves for real buyers
       (a competitor, a script) could keep adding. Two limits stop that
       without touching a real shopper: one bag holds at most MAX_PER_BAG
       units, and one address can put at most HOLD_PER_HOUR units into bags
       in an hour, however many bags it opens. */
    const more = quantity - before
    if (more > 0) {
      if ((await getCartCount(cartId)) + more > MAX_PER_BAG) {
        return json({ ok: false, error: 'BAG_FULL', message: `One order can hold up to ${MAX_PER_BAG} items. For more, contact us for a wholesale order.` }, 409)
      }
      if (!hit(`hold:${clientKey(request)}`, HOLD_PER_HOUR, 3600, Date.now(), more).ok) {
        return json({ ok: false, error: 'TOO_MANY', message: 'Too many items added in a short time. Please try again later or contact us.' }, 429)
      }
    }

    await addToCart(cartId, variantId, quantity)

    const [count, view] = await Promise.all([
      getCartCount(cartId),
      getCartView(cartId, { email: user?.email ?? null, userId: user?.id ?? null }),
    ])

    return json({
      ok: true,
      cartCount: count,
      totals: view.totals,
      reservationExpiresAt: view.reservationExpiresAt,
    })
  } catch (err) {
    if (err instanceof CartError) {
      /* 409 Conflict is the honest status: the request was well-formed, the
         world just changed underneath it. */
      return json(
        {
          ok: false,
          error: err.code,
          message: err.message,
          available: err.available ?? 0,
        },
        err.code === 'NO_SUCH_VARIANT' ? 404 : 409,
      )
    }
    console.error('[api/cart] POST failed', err)
    return json({ ok: false, error: 'CART_UPDATE_FAILED' }, 500)
  }
}

/* ----------------------------------------------------------------- DELETE -- */

export async function DELETE() {
  try {
    const { cartId } = await resolveCart()
    await clearCart(cartId)
    return json({ ok: true, cartCount: 0 })
  } catch (err) {
    console.error('[api/cart] DELETE failed', err)
    return json({ ok: false, error: 'CART_CLEAR_FAILED' }, 500)
  }
}
