/* ============================================================================
 * "Notify me when it's back".
 *
 * A customer on a sold out flavour or size leaves their email; it is kept
 * for that exact flavour and size. When it comes back in stock,
 * lib/automations.ts (stockReplenished) sends the Back in stock email once
 * and marks the request done.
 * ========================================================================== */

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { inventory, productVariants, products, stockAlerts } from '@/db/schema'

export class StockAlertError extends Error {
  constructor(
    message: string,
    public code: 'NOT_FOUND' | 'IN_STOCK' | 'TOO_MANY',
  ) {
    super(message)
    this.name = 'StockAlertError'
  }
}

/** Waiting requests one address may have at once: plenty for a customer,
 *  too few to be useful for flooding someone's inbox later. */
const MAX_PER_EMAIL = 20

export async function requestStockAlert(input: { variantId: string; email: string; userId?: string | null; locale: string }) {
  const email = input.email.trim().toLowerCase()
  const [v] = await db
    .select({
      id: productVariants.id,
      available: sql<number>`coalesce(${inventory.onHand} - ${inventory.reserved}, 0)`.mapWith(Number),
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(and(eq(productVariants.id, input.variantId), eq(productVariants.isActive, true), eq(products.isActive, true)))
    .limit(1)
  if (!v) throw new StockAlertError('That product is no longer in the shop.', 'NOT_FOUND')
  if (v.available > 0) throw new StockAlertError('It is in stock now.', 'IN_STOCK')

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(stockAlerts)
    .where(and(sql`lower(${stockAlerts.email}) = ${email}`, isNull(stockAlerts.notifiedAt)))
  if (n >= MAX_PER_EMAIL) throw new StockAlertError('Too many requests for this email.', 'TOO_MANY')

  /* Asking again for the same size is fine: one request, renewed. */
  await db.execute(sql`
    insert into stock_alerts (variant_id, email, user_id, locale)
    values (${v.id}::uuid, ${email}, ${input.userId ?? null}, ${input.locale})
    on conflict (variant_id, lower(email)) do update
      set notified_at = null, locale = excluded.locale,
          user_id = coalesce(excluded.user_id, stock_alerts.user_id), created_at = now()`)
}

/** For the admin: sold out sizes customers are waiting for, most wanted first. */
export async function waitingForStock(limit = 50) {
  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      product: products.name,
      flavour: productVariants.colorName,
      size: productVariants.size,
      sku: productVariants.sku,
      waiting: sql<number>`count(*)`.mapWith(Number),
      since: sql<Date>`min(${stockAlerts.createdAt})`,
      available: sql<number>`coalesce(max(${inventory.onHand} - ${inventory.reserved}), 0)`.mapWith(Number),
    })
    .from(stockAlerts)
    .innerJoin(productVariants, eq(productVariants.id, stockAlerts.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(isNull(stockAlerts.notifiedAt))
    .groupBy(productVariants.id, products.id)
    .orderBy(desc(sql`count(*)`))
    .limit(limit)
}
