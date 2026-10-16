/* ============================================================================
 * Promotions, for the admin: automatic discounts with a start and an end,
 * on one product, on a category (and everything inside it), or on the whole
 * shop. The storefront picks them up by itself (see pricing.ts); a manual
 * sale price and a promotion never stack, the customer gets the cheaper.
 * ========================================================================== */

import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { categories, products, promotions } from '@/db/schema'
import { AdminError } from '@/lib/admin'

export type PromotionState = 'live' | 'scheduled' | 'ended' | 'paused'

export type AdminPromotion = {
  id: string
  name: string
  scope: 'PRODUCT' | 'CATEGORY' | 'SUBCATEGORY' | 'ALL'
  productId: string | null
  categoryId: string | null
  /** What it applies to, in words: "Sports Nutrition › Protein". */
  target: string
  discountType: 'PERCENTAGE' | 'FIXED'
  discountValue: number
  badge: { en: string; el: string; ru: string }
  startsAt: string
  endsAt: string | null
  showOnHomepage: boolean
  isActive: boolean
  state: PromotionState
  /** How many products it reaches right now. */
  products: number
}

export type PromotionInput = {
  name: string
  scope: 'PRODUCT' | 'CATEGORY' | 'ALL'
  productId?: string | null
  categoryId?: string | null
  discountType: 'PERCENTAGE' | 'FIXED'
  /** Percent (1 to 90) or cents. */
  discountValue: number
  badge?: { en?: string; el?: string; ru?: string }
  startsAt: Date
  endsAt: Date | null
  showOnHomepage: boolean
  isActive: boolean
}

function stateOf(p: { isActive: boolean; startsAt: Date; endsAt: Date | null }, now = new Date()): PromotionState {
  if (!p.isActive) return 'paused'
  if (p.endsAt && p.endsAt <= now) return 'ended'
  if (p.startsAt > now) return 'scheduled'
  return 'live'
}

export async function listAdminPromotions(): Promise<AdminPromotion[]> {
  const [rows, cats] = await Promise.all([
    db.select().from(promotions).orderBy(desc(promotions.isActive), desc(promotions.startsAt)),
    db.select({ id: categories.id, parentId: categories.parentId, name: categories.name }).from(categories),
  ])
  const byId = new Map(cats.map((c) => [c.id, c]))
  const path = (id: string) => {
    const parts: string[] = []
    let cur = byId.get(id)
    let guard = 0
    while (cur && guard++ < 5) {
      parts.unshift(cur.name.en ?? '')
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
    return parts.join(' › ')
  }
  const below = (id: string) => {
    const out = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const c of cats) {
        if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
          out.add(c.id)
          grew = true
        }
      }
    }
    return [...out]
  }

  const productIds = rows.map((r) => r.productId).filter((x): x is string => !!x)
  const productNames = productIds.length
    ? await db.select({ id: products.id, name: products.name }).from(products).where(inArray(products.id, productIds))
    : []
  const nameOf = new Map(productNames.map((p) => [p.id, p.name.en ?? '']))

  const counts = await db
    .select({ categoryId: products.categoryId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(products)
    .where(eq(products.isActive, true))
    .groupBy(products.categoryId)
  const countIn = new Map(counts.map((c) => [c.categoryId, c.n]))
  const allProducts = counts.reduce((n, c) => n + c.n, 0)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.scope,
    productId: r.productId,
    categoryId: r.categoryId,
    target:
      r.scope === 'ALL'
        ? 'The whole shop'
        : r.scope === 'PRODUCT'
          ? (r.productId && nameOf.get(r.productId)) || 'A product that no longer exists'
          : r.categoryId
            ? path(r.categoryId)
            : 'A category that no longer exists',
    discountType: r.discountType,
    discountValue: r.discountValue,
    badge: { en: r.badgeText?.en ?? '', el: r.badgeText?.el ?? '', ru: r.badgeText?.ru ?? '' },
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt?.toISOString() ?? null,
    showOnHomepage: r.showOnHomepage,
    isActive: r.isActive,
    state: stateOf(r),
    products:
      r.scope === 'ALL'
        ? allProducts
        : r.scope === 'PRODUCT'
          ? r.productId && nameOf.has(r.productId) ? 1 : 0
          : r.categoryId
            ? below(r.categoryId).reduce((n, id) => n + (countIn.get(id) ?? 0), 0)
            : 0,
  }))
}

/** For the form: every product by name. */
export async function promotionProductOptions() {
  return db
    .select({ id: products.id, name: sql<string>`${products.name}->>'en'` })
    .from(products)
    .orderBy(asc(sql`${products.name}->>'en'`))
}

function values(input: PromotionInput) {
  if (input.discountType === 'PERCENTAGE' && (input.discountValue < 1 || input.discountValue > 90))
    throw new AdminError('A percentage must be between 1 and 90.')
  if (input.discountType === 'FIXED' && input.discountValue < 1) throw new AdminError('Enter an amount off.')
  if (input.endsAt && input.endsAt <= input.startsAt) throw new AdminError('The end must be after the start.')
  if (input.scope === 'PRODUCT' && !input.productId) throw new AdminError('Choose the product.')
  if (input.scope === 'CATEGORY' && !input.categoryId) throw new AdminError('Choose the category.')
  const badge = Object.fromEntries(
    Object.entries(input.badge ?? {})
      .map(([k, v]) => [k, (v ?? '').trim()])
      .filter(([, v]) => v),
  )
  return {
    name: input.name.trim(),
    scope: input.scope,
    productId: input.scope === 'PRODUCT' ? input.productId! : null,
    categoryId: input.scope === 'CATEGORY' ? input.categoryId! : null,
    discountType: input.discountType,
    discountValue: Math.round(input.discountValue),
    badgeText: Object.keys(badge).length ? badge : null,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    showOnHomepage: input.showOnHomepage,
    isActive: input.isActive,
  }
}

export async function createPromotion(input: PromotionInput) {
  const [row] = await db.insert(promotions).values(values(input)).returning({ id: promotions.id })
  return row
}

export async function updatePromotion(id: string, input: PromotionInput) {
  const [row] = await db.update(promotions).set(values(input)).where(eq(promotions.id, id)).returning({ id: promotions.id })
  if (!row) throw new AdminError('That promotion is already gone.')
}

export async function setPromotionActive(id: string, isActive: boolean) {
  const [row] = await db.update(promotions).set({ isActive }).where(eq(promotions.id, id)).returning({ id: promotions.id })
  if (!row) throw new AdminError('That promotion is already gone.')
}

/** End now: keeps the history (past orders point at it), stops the discount. */
export async function endPromotion(id: string) {
  const [row] = await db.update(promotions).set({ endsAt: new Date() }).where(eq(promotions.id, id)).returning({ id: promotions.id })
  if (!row) throw new AdminError('That promotion is already gone.')
}

export async function deletePromotion(id: string) {
  await db.delete(promotions).where(eq(promotions.id, id))
}

/** For the form: every category, ranges first, as "Range › Group › Section". */
export async function promotionCategoryOptions() {
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId, name: categories.name, position: categories.position })
    .from(categories)
    .orderBy(asc(categories.position))
  const out: { id: string; label: string; depth: number }[] = []
  const walk = (parent: string | null, prefix: string, depth: number) => {
    for (const r of rows.filter((x) => x.parentId === parent)) {
      const label = prefix ? `${prefix} › ${r.name.en ?? ''}` : (r.name.en ?? '')
      out.push({ id: r.id, label, depth })
      if (depth < 3) walk(r.id, label, depth + 1)
    }
  }
  walk(null, '', 1)
  return out
}
