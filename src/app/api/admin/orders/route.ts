/* Admin: enter an order for a customer, e.g. one taken on the phone. */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { ManualOrderError, createManualOrder } from '@/lib/manual-orders'
import { InventoryError } from '@/lib/inventory'
import { UUID, fail, json, readJson } from '@/lib/api'
import { emailSchema, nameSchema, phoneSchema } from '@/lib/validation'
import { audit } from '@/lib/audit'

const schema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: z.union([z.literal(''), emailSchema]).optional(),
  phone: phoneSchema,
  locale: z.enum(['en', 'el', 'ru']).default('en'),
  delivery: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('SHIPPING'),
      address: z.object({
        line1: z.string().trim().min(3, 'Enter the street and number.').max(200),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().min(2, 'Enter the town or city.').max(100),
        postalCode: z.string().trim().min(3, 'Enter the postal code.').max(20),
        country: z.string().trim().length(2).toUpperCase().default('CY'),
      }),
    }),
    z.object({ kind: z.literal('PICKUP') }),
  ]),
  deliveryCents: z.number().int().min(0).max(1_000_000),
  lines: z
    .array(
      z.object({
        variantId: z.string().regex(UUID),
        quantity: z.number().int().min(1).max(999),
        unitCents: z.number().int().min(0).max(10_000_000).optional(),
      }),
    )
    .min(1, 'Add at least one product.')
    .max(60),
  paid: z.boolean().default(false),
  sendEmail: z.boolean().default(true),
  note: z.string().trim().max(1000).optional(),
})

export async function POST(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  try {
    const order = await createManualOrder({ ...body.data, email: body.data.email || undefined }, guard.user)
    await audit({ actor: guard.user, action: 'order.create_manual', entity: 'order', entityId: order.id, diff: { orderNumber: order.orderNumber } })
    revalidatePath('/admin/orders')
    return json({ ok: true, id: order.id, orderNumber: order.orderNumber })
  } catch (err) {
    if (err instanceof ManualOrderError || err instanceof InventoryError) return fail(422, 'INVALID_INPUT', err.message)
    throw err
  }
}
