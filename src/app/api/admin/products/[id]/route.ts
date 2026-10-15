/* ============================================================================
 * Admin: edit one product's price and status (available / sold out / hidden).
 *
 * Money arrives as integer cents and is validated as such. A sale price must be
 * genuinely lower than the price — a "sale" that is not a saving is the kind of
 * thing consumer-protection regulators fine shops for, so the server refuses it
 * rather than trusting the form to have checked.
 * ========================================================================== */

import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { products } from '@/db/schema'
import { requireAdminApi } from '@/lib/admin'
import { invalidateSettingsCache } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { productStatus } from '@/lib/admin-catalog'
import { revalidatePath } from 'next/cache'
import { AdminError } from '@/lib/admin'
import { deleteProduct } from '@/lib/admin-products'

const money = z.number().int().min(0).max(100_000_000)

/*
 * Every field is optional, so one screen can change the status and another the
 * price without resending each other's values. Price and sale price travel
 * together, because "is the sale lower than the price?" needs both.
 *
 * `status` is the owner's three-way choice. `isActive` is still accepted for
 * anything written against the older two-way form.
 */
const bodySchema = z
  .object({
    priceCents: money.optional(),
    salePriceCents: money.nullable().optional(),
    isActive: z.boolean().optional(),
    status: z.enum(['available', 'sold_out', 'hidden']).optional(),
  })
  .strict()
  .refine((v) => (v.priceCents === undefined) === (v.salePriceCents === undefined), {
    message: 'Send the price and the sale price together.',
  })
  .refine((v) => v.salePriceCents == null || v.priceCents === undefined || v.salePriceCents < v.priceCents, {
    message: 'A sale price has to be lower than the normal price.',
    path: ['salePriceCents'],
  })
  .refine((v) => v.priceCents !== undefined || v.isActive !== undefined || v.status !== undefined, {
    message: 'Nothing to change.',
  })

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      {
        ok: false,
        error: 'INVALID_INPUT',
        message: parsed.error.issues[0]?.message ?? 'That was not valid.',
      },
      { status: 422 },
    )
  }
  const body = parsed.data

  const [before] = await db
    .select({
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      isActive: products.isActive,
      availability: products.availability,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1)
  if (!before) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })

  const change: Partial<typeof products.$inferInsert> = { updatedAt: new Date() }
  if (body.priceCents !== undefined) {
    change.priceCents = body.priceCents
    change.salePriceCents = body.salePriceCents ?? null
  }
  if (body.isActive !== undefined) change.isActive = body.isActive
  /* Hidden, sold out and available are three different decisions. Hiding
     leaves `availability` alone; nothing about stock or orders is touched. */
  if (body.status === 'hidden') change.isActive = false
  if (body.status === 'available') Object.assign(change, { isActive: true, availability: 'AVAILABLE' })
  if (body.status === 'sold_out') Object.assign(change, { isActive: true, availability: 'SOLD_OUT' })

  const [after] = await db
    .update(products)
    .set(change)
    .where(eq(products.id, id))
    .returning({
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      isActive: products.isActive,
      availability: products.availability,
    })

  const diff: Record<string, { from: unknown; to: unknown }> = {}
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (before[key] !== after[key]) diff[key] = { from: before[key], to: after[key] }
  }
  if (Object.keys(diff).length) {
    await audit({ actor: guard.user, action: 'product.update', entity: 'product', entityId: id, diff })
  }

  invalidateSettingsCache()
  /* Cards, product pages and the homepage all show status and price. */
  revalidatePath('/[locale]', 'layout')
  return Response.json(
    { ok: true, status: productStatus(after.isActive, after.availability), ...after },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** Delete a product that has never been ordered. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }
  try {
    await deleteProduct(id)
  } catch (err) {
    if (err instanceof AdminError) {
      return Response.json({ ok: false, error: 'REFUSED', message: err.message }, { status: 409 })
    }
    console.error('[api/admin/products] delete failed', err)
    return Response.json({ ok: false, error: 'DELETE_FAILED', message: 'Could not delete it.' }, { status: 500 })
  }
  await audit({ actor: guard.user, action: 'product.delete', entity: 'product', entityId: id })
  revalidatePath('/[locale]', 'layout')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
