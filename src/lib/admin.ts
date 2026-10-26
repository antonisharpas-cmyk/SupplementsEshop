/* ============================================================================
 * ADMIN — the guard, and the reads each screen needs.
 *
 * One rule, in one place: `guardAdmin()` is the first line of every admin page
 * and every admin API route. It is impossible to add a screen and forget the
 * check without also forgetting to fetch the data, because the data comes from
 * here too.
 *
 * A signed-in customer who guesses /admin gets the 404 page, not "forbidden".
 * Telling them the route exists is an invitation.
 * ========================================================================== */

import { notFound, redirect } from 'next/navigation'
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  categories,
  emailLog,
  inventory,
  productImages,
  productVariants,
  products,
  promoCodes,
  promotions,
  users,
} from '@/db/schema'
import { AuthError, getCurrentUser, type SessionUser } from '@/lib/auth/session'
import type { UserRole } from '@/db/schema'
import { compareSizes } from '@/lib/sizes'
import { listProductsByIds } from '@/lib/catalog'

/* ------------------------------------------------------------------ guard -- */

/**
 * For PAGES. Sends a signed-out visitor to sign in (and back here afterwards);
 * shows a signed-in customer the 404 page.
 */
export async function guardAdmin(
  next = '/admin',
  minimum: UserRole = 'ADMIN',
): Promise<SessionUser> {
  const user = await getCurrentUser()

  if (!user) redirect(`/en/sign-in?next=${encodeURIComponent(next)}`)
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') notFound()
  if (minimum === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') notFound()

  return user
}

/** Owner (SUPER_ADMIN) or a manager: may see costs, profit and the finance area. */
export const canSeeFinance = (u: { role: UserRole; financeAccess?: boolean } | null | undefined) =>
  Boolean(u && (u.role === 'SUPER_ADMIN' || (u.role === 'ADMIN' && u.financeAccess)))

/** For finance PAGES: staff without finance access get the 404 page. */
export async function guardFinance(next = '/admin'): Promise<SessionUser> {
  const user = await guardAdmin(next)
  if (!canSeeFinance(user)) notFound()
  return user
}

/** For finance API ROUTES. */
export async function requireFinanceApi(): Promise<{ user: SessionUser } | { response: Response }> {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard
  if (!canSeeFinance(guard.user)) {
    return {
      response: Response.json(
        { ok: false, error: 'FORBIDDEN', message: 'Only the owner and managers can do this.' },
        { status: 403 },
      ),
    }
  }
  return guard
}

/**
 * For API ROUTES, which must answer with a status rather than a rendered page.
 * Returns the user, or a Response to send back untouched.
 */
export async function requireAdminApi(
  minimum: UserRole = 'ADMIN',
): Promise<{ user: SessionUser } | { response: Response }> {
  const user = await getCurrentUser()

  /* 404 for everyone who should not be here — signed out or merely a customer.
     A 401 would confirm the endpoint exists. */
  if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
    return { response: Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 }) }
  }
  if (minimum === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    return {
      response: Response.json(
        { ok: false, error: 'FORBIDDEN', message: 'This action needs a super-admin account.' },
        { status: 403 },
      ),
    }
  }
  return { user }
}

export { AuthError }

/* ----------------------------------------------------------- the overview -- */

export type AdminOverview = {
  products: { total: number; active: number }
  variants: number
  stock: { units: number; held: number; outOfStock: number; low: number }
  customers: number
  promotions: number
  promoCodes: number
  lowStock: {
    variantId: string
    sku: string
    size: string
    productName: Record<string, string>
    productSlug: string
    available: number
    onHand: number
  }[]
}

export async function getOverview(lowStockThreshold: number): Promise<AdminOverview> {
  const [productCounts] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${products.isActive})`.mapWith(Number),
    })
    .from(products)

  const [variantCount] = await db.select({ n: count() }).from(productVariants)

  const [stock] = await db
    .select({
      units: sql<number>`coalesce(sum(${inventory.onHand}), 0)`.mapWith(Number),
      held: sql<number>`coalesce(sum(${inventory.reserved}), 0)`.mapWith(Number),
      outOfStock: sql<number>`count(*) filter (where ${inventory.onHand} - ${inventory.reserved} <= 0)`.mapWith(
        Number,
      ),
      low: sql<number>`count(*) filter (where ${inventory.onHand} - ${inventory.reserved} > 0
                        and ${inventory.onHand} - ${inventory.reserved} <= ${lowStockThreshold})`.mapWith(
        Number,
      ),
    })
    .from(inventory)

  const [customerCount] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.role, 'CUSTOMER'))

  const [promotionCount] = await db
    .select({ n: count() })
    .from(promotions)
    .where(eq(promotions.isActive, true))

  const [codeCount] = await db
    .select({ n: count() })
    .from(promoCodes)
    .where(eq(promoCodes.isActive, true))

  /* What the shop needs to act on today: what is nearly gone. */
  const lowStock = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      productName: products.name,
      productSlug: products.slug,
      onHand: inventory.onHand,
      available: sql<number>`${inventory.onHand} - ${inventory.reserved}`.mapWith(Number),
    })
    .from(inventory)
    .innerJoin(productVariants, eq(productVariants.id, inventory.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(sql`${inventory.onHand} - ${inventory.reserved} <= ${lowStockThreshold}`)
    .orderBy(sql`${inventory.onHand} - ${inventory.reserved} asc`)
    .limit(25)

  return {
    products: { total: productCounts?.total ?? 0, active: productCounts?.active ?? 0 },
    variants: variantCount?.n ?? 0,
    stock: {
      units: stock?.units ?? 0,
      held: stock?.held ?? 0,
      outOfStock: stock?.outOfStock ?? 0,
      low: stock?.low ?? 0,
    },
    customers: customerCount?.n ?? 0,
    promotions: promotionCount?.n ?? 0,
    promoCodes: codeCount?.n ?? 0,
    lowStock,
  }
}

/* ------------------------------------------------------------- today -- */

/** Midnight in the shop's own time zone — "today" means today in Cyprus,
 *  not in UTC, or the numbers would flip over at 2 or 3 in the morning. */
const SHOP_DAY_START = sql`(date_trunc('day', now() at time zone 'Europe/Nicosia') at time zone 'Europe/Nicosia')`

export type TodayNumbers = {
  orders: number
  revenueCents: number
  newCustomers: number
  newSubscribers: number
  failedEmails7d: { kind: string; toEmail: string; subject: string; createdAt: Date; error: string | null }[]
}

export async function getToday(): Promise<TodayNumbers> {
  const [res, failed] = await Promise.all([
    db.execute<{ orders: number; revenue: number; customers: number; subscribers: number }>(sql`
      select
        (select count(*)::int from orders where created_at >= ${SHOP_DAY_START}) as orders,
        (select coalesce(sum(total_cents), 0)::int from orders
          where created_at >= ${SHOP_DAY_START}
            and status in ('PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED')) as revenue,
        (select count(*)::int from users where role = 'CUSTOMER' and created_at >= ${SHOP_DAY_START}) as customers,
        (select count(*)::int from newsletter_subscribers
          where status = 'SUBSCRIBED' and confirmed_at >= ${SHOP_DAY_START}) as subscribers
    `),
    db
      .select({
        kind: emailLog.kind,
        toEmail: emailLog.toEmail,
        subject: emailLog.subject,
        createdAt: emailLog.createdAt,
        error: emailLog.error,
      })
      .from(emailLog)
      .where(and(eq(emailLog.status, 'failed'), sql`${emailLog.createdAt} > now() - interval '7 days'`))
      .orderBy(desc(emailLog.createdAt))
      .limit(10),
  ])
  const r = res.rows[0]
  return {
    orders: Number(r?.orders ?? 0),
    revenueCents: Number(r?.revenue ?? 0),
    newCustomers: Number(r?.customers ?? 0),
    newSubscribers: Number(r?.subscribers ?? 0),
    failedEmails7d: failed,
  }
}

/* -------------------------------------------------------------- products -- */

/* The Products list itself lives in lib/admin-catalog.ts (search, filters,
   pagination). This is the single-product read for the editor. */

export async function getAdminProduct(id: string) {
  const [row] = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      summary: products.summary,
      description: products.description,
      sizeGuide: products.sizeGuide,
      seoTitle: products.seoTitle,
      seoDescription: products.seoDescription,
      categoryName: categories.name,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      isActive: products.isActive,
      availability: products.availability,
      currency: products.currency,
      categoryId: products.categoryId,
      createdAt: products.createdAt,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, id))
    .limit(1)

  if (!row) return null

  const variants = await db
    .select({
      variantId: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      colorName: productVariants.colorName,
      isActive: productVariants.isActive,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      available: sql<number>`${inventory.onHand} - ${inventory.reserved}`.mapWith(Number),
    })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.productId, id))
    .orderBy(productVariants.position)

  return {
    ...row,
    rows: variants
      .map((v) => ({
        ...v,
        onHand: v.onHand ?? 0,
        reserved: v.reserved ?? 0,
        available: v.available ?? 0,
      }))
      .sort((a, b) => compareSizes(a.size, b.size)),
  }
}

/* The Stock screen reads lib/admin-catalog.ts (one line per variant). */

/* ------------------------------------------------------ homepage & photos -- */

export type PickerProduct = {
  id: string
  name: string
  category: string
  image: string | null
  isActive: boolean
  isOnSale: boolean
}

/**
 * Every product, as the homepage picker shows it: a thumbnail, and the two
 * facts that decide whether picking it will actually show anything — whether
 * it is live, and (for "On sale") whether it is currently reduced. The second
 * comes from the storefront's own pricing, not from a column, so it counts
 * promotions as well as sale prices.
 */
export async function listPickerProducts(): Promise<PickerProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      categoryName: categories.name,
      isActive: products.isActive,
    })
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(desc(products.createdAt))

  const ids = rows.map((r) => r.id)
  const [images, reduced] = await Promise.all([
    ids.length
      ? db
          .select({ productId: productImages.productId, url: productImages.url, position: productImages.position })
          .from(productImages)
          .where(inArray(productImages.productId, ids))
          .orderBy(asc(productImages.position))
      : Promise.resolve([]),
    listProductsByIds(ids, { onSaleOnly: true }),
  ])
  const firstImage = new Map<string, string>()
  for (const img of images) if (!firstImage.has(img.productId)) firstImage.set(img.productId, img.url)
  const onSale = new Set(reduced.map((c) => c.id))

  return rows.map((r) => ({
    id: r.id,
    name: r.name.en ?? Object.values(r.name)[0] ?? '',
    category: r.categoryName.en ?? '',
    image: firstImage.get(r.id) ?? null,
    isActive: r.isActive,
    isOnSale: onSale.has(r.id),
  }))
}

export type AdminProductImage = { id: string; url: string; position: number; variantId: string | null }

export async function getProductImages(productId: string): Promise<AdminProductImage[]> {
  return db
    .select({ id: productImages.id, url: productImages.url, position: productImages.position, variantId: productImages.variantId })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(asc(productImages.position), asc(productImages.createdAt))
}

/**
 * Put a product's photos in this order. The first is the one on every card
 * and at the top of the product page; the second is the one a card fades to
 * on hover.
 *
 * `ids` must be exactly this product's photos — every one, once. Anything
 * else is refused: a partial list would leave two photos claiming the same
 * place, and a foreign id would move another product's picture.
 */
export async function reorderProductImages(productId: string, ids: string[]): Promise<void> {
  const current = await getProductImages(productId)
  const have = new Set(current.map((i) => i.id))
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => have.has(id))) {
    throw new AdminError('Send every photo of this product exactly once.')
  }
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx
        .update(productImages)
        .set({ position })
        .where(and(eq(productImages.id, id), eq(productImages.productId, productId)))
    }
  })
}

export class AdminError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminError'
  }
}
