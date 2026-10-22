/* ============================================================================
 * Place an order.
 *
 * The body carries who, where and how to pay. It never carries a price: the
 * server prices the bag again here, from the database, and that is the number
 * the customer is charged.
 * ========================================================================== */

import { z } from 'zod'
import { getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { CheckoutError, placeOrder } from '@/lib/orders'
import { emailSchema, localeSchema, nameSchema, phoneSchema, uuidSchema, cyCountrySchema, cyPostalCodeSchema } from '@/lib/validation'
import { clientKey, hit } from '@/lib/rate-limit'
import { fail, json, readJson } from '@/lib/api'

const address = z.object({
  recipientName: z.string().trim().min(2, 'Enter the name for the delivery.').max(160),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Enter the street and number.').max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'Enter the town or city.').max(100),
  postalCode: cyPostalCodeSchema,
  country: cyCountrySchema,
})

const schema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  deliveryOptionId: uuidSchema,
  shippingAddress: address.optional(),
  /* The BOX NOW locker picked on the map; re-checked with BOX NOW on the server. */
  pickupPoint: z
    .object({
      id: z.string().trim().min(1).max(40),
      name: z.string().trim().max(160).default(''),
      address: z.string().trim().max(200).default(''),
      postalCode: z.string().trim().max(10).default(''),
    })
    .optional(),
  customerNote: z.string().trim().max(500).optional().or(z.literal('')),
  /* The website takes card only. Cash orders exist only when staff enter
     them in Admin (phone orders). */
  paymentMethod: z.literal('card', { message: 'Online orders are paid by card.' }),
  saveAddress: z.boolean().default(false),
  acceptTerms: z.literal(true, { message: 'Tick the box to accept the terms.' }),
  /* Optional yes to offers by SMS, to the phone given above. */
  smsConsent: z.boolean().default(false),
  locale: localeSchema,
})

export async function POST(request: Request) {
  const limited = hit(`checkout:${clientKey(request)}`, 10, 60)
  if (!limited.ok) return fail(429, 'TOO_MANY', 'Too many tries. Wait a minute and try again.')

  const body = await readJson(request, schema)
  if ('response' in body) return body.response

  const [user, token] = await Promise.all([getCurrentUser(), readCartToken()])
  if (!user && !token) return fail(409, 'EMPTY_CART', 'Your bag is empty.')
  const cartId = await getOrCreateCart({ userId: user?.id ?? null, anonymousToken: token })

  try {
    const result = await placeOrder({
      cartId,
      userId: user?.id ?? null,
      input: {
        ...body.data,
        customerNote: body.data.customerNote || undefined,
        shippingAddress: body.data.shippingAddress
          ? { ...body.data.shippingAddress, line2: body.data.shippingAddress.line2 || null }
          : undefined,
      },
    })
    if (body.data.smsConsent) {
      try {
        const { subscribeSms } = await import('@/lib/sms-marketing')
        await subscribeSms({
          phone: body.data.phone,
          userId: user?.id ?? null,
          firstName: body.data.firstName,
          locale: body.data.locale,
          source: 'checkout',
        })
      } catch (err) {
        /* Never fails an order that has already been placed. */
        console.error('[api/checkout] SMS opt-in not recorded', err)
      }
    }
    return json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof CheckoutError) return fail(409, err.code, err.message)
    console.error('[api/checkout] failed', err)
    return fail(500, 'CHECKOUT_FAILED', 'Something went wrong placing your order. Nothing was charged. Please try again.')
  }
}
