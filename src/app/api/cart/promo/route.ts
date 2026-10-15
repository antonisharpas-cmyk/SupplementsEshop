/* ============================================================================
 * Promo code on the cart — spec sections 11 and 20.
 *
 * POST   { code } — validate and apply
 * DELETE          — remove whatever is applied
 *
 * The validation is not re-implemented here. The route prices the cart WITH the
 * code and lets `priceCart` decide: it owns the minimum-order rule, the usage
 * limits, the product/category restrictions and the expiry window, and it is
 * the same code path checkout will use. A code is only stored on the cart if
 * pricing accepted it, so an applied code always means a real discount.
 *
 * The discount is never taken from the request body, and the code is stored as
 * an id on the cart row rather than in a cookie, so a customer cannot grant
 * themselves a discount by editing client state.
 * ========================================================================== */

import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  findPromoCodeId,
  getCartPromoCode,
  getCartView,
  getOrCreateCart,
  setCartPromoCode,
} from '@/lib/cart'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { isLocale, type Locale } from '@/config/brand'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

const bodySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    /* Codes are printed on cards and read out loud: letters, digits, dash. */
    .regex(/^[A-Za-z0-9-]+$/, 'A promo code is letters, numbers and dashes.'),
})

async function currentLocale(): Promise<Locale> {
  const jar = await cookies()
  const raw = jar.get('sf_locale')?.value ?? 'en'
  return (isLocale(raw) ? raw : 'en') as Locale
}

/** The caller's existing cart. A promo code cannot create one — there is
 *  nothing to discount until something is in the bag. */
async function existingCart() {
  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])
  if (!user && !token) return null
  const cartId = await getOrCreateCart({ userId: user?.id ?? null, anonymousToken: token })
  return { cartId, user }
}

/* ------------------------------------------------------------------- POST -- */

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400)
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: 'INVALID_INPUT',
        message: 'That promo code was not recognised.',
      },
      422,
    )
  }

  try {
    const cart = await existingCart()
    if (!cart) {
      return json({ ok: false, error: 'EMPTY_CART', message: 'Your bag is empty.' }, 409)
    }

    const locale = await currentLocale()
    const { cartId, user } = cart

    /* Price the cart as if the code were applied, and believe the result. */
    const preview = await getCartView(cartId, {
      promoCode: parsed.data.code,
      email: user?.email ?? null,
      userId: user?.id ?? null,
      locale,
    })

    if (preview.promoCodeError) {
      return json(
        {
          ok: false,
          error: preview.promoCodeError.reason,
          message: preview.promoCodeError.message,
        },
        409,
      )
    }

    if (preview.totals.promoCodeDiscountCents <= 0) {
      /* Valid but worth nothing on this basket — say so rather than showing a
         "−€0.00" line that looks like a bug. */
      return json(
        {
          ok: false,
          error: 'NO_DISCOUNT',
          message: 'That code does not reduce anything in your bag.',
        },
        409,
      )
    }

    const promoCodeId = await findPromoCodeId(parsed.data.code)
    if (!promoCodeId) {
      return json({ ok: false, error: 'NOT_FOUND', message: 'That promo code was not recognised.' }, 409)
    }

    await setCartPromoCode(cartId, promoCodeId)

    return json({
      ok: true,
      code: preview.totals.promoCode?.code ?? parsed.data.code.toUpperCase(),
      discountCents: preview.totals.promoCodeDiscountCents,
      totals: preview.totals,
    })
  } catch (err) {
    console.error('[api/cart/promo] POST failed', err)
    return json({ ok: false, error: 'PROMO_FAILED', message: 'Something went wrong.' }, 500)
  }
}

/* ----------------------------------------------------------------- DELETE -- */

export async function DELETE() {
  try {
    const cart = await existingCart()
    if (!cart) return json({ ok: true, code: null })

    const had = await getCartPromoCode(cart.cartId)
    await setCartPromoCode(cart.cartId, null)
    return json({ ok: true, removed: had })
  } catch (err) {
    console.error('[api/cart/promo] DELETE failed', err)
    return json({ ok: false, error: 'PROMO_FAILED' }, 500)
  }
}
