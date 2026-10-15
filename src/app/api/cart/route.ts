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
import { CartError, addToCart, clearCart, getCartCount, getCartView, getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, getOrCreateCartToken } from '@/lib/auth/session'
import { updateCartLineSchema } from '@/lib/validation'
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

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
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
    const { variantId, quantity } = parsed.data

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
