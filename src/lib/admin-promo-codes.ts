/* ============================================================================
 * Promo codes, for the admin: a code the customer types at checkout
 * ("WELCOME10"). Percent or euros off the bag, an optional minimum order,
 * limits on how many times it can be used, a start and an expiry, and an
 * optional rule that the bag must hold something from a category.
 *
 * A code that has been used is never deleted (its orders point at it); it is
 * switched off instead.
 * ========================================================================== */

import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { categories, promoCodes } from '@/db/schema'
import { AdminError } from '@/lib/admin'
import { isUniqueViolation } from '@/lib/db-errors'

export type PromoCodeState = 'live' | 'scheduled' | 'expired' | 'used_up' | 'off'

export type AdminPromoCode = {
  id: string
  code: string
  discountType: 'PERCENTAGE' | 'FIXED'
  discountValue: number
  minOrderCents: number
  maxUses: number | null
  maxUsesPerUser: number | null
  timesUsed: number
  /** The category chosen in the form (the first stored; the rest are its children). */
  categoryId: string | null
  category: string | null
  startsAt: string
  expiresAt: string | null
  isActive: boolean
  state: PromoCodeState
}

export type PromoCodeInput = {
  code: string
  discountType: 'PERCENTAGE' | 'FIXED'
  discountValue: number
  minOrderCents: number
  maxUses: number | null
  maxUsesPerUser: number | null
  categoryId: string | null
  startsAt: Date
  expiresAt: Date | null
  isActive: boolean
}

function stateOf(c: { isActive: boolean; startsAt: Date; expiresAt: Date | null; maxUses: number | null; timesUsed: number }, now = new Date()): PromoCodeState {
  if (!c.isActive) return 'off'
  if (c.expiresAt && c.expiresAt <= now) return 'expired'
  if (c.maxUses !== null && c.timesUsed >= c.maxUses) return 'used_up'
  if (c.startsAt > now) return 'scheduled'
  return 'live'
}

async function categoryTree() {
  return db.select({ id: categories.id, parentId: categories.parentId, name: categories.name }).from(categories)
}

export async function listAdminPromoCodes(): Promise<AdminPromoCode[]> {
  const [rows, cats] = await Promise.all([
    db.select().from(promoCodes).orderBy(desc(promoCodes.isActive), desc(promoCodes.createdAt)),
    categoryTree(),
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
    return parts.join(' › ') || null
  }
  return rows.map((r) => {
    const first = (r.categoryIds as string[] | null)?.[0] ?? null
    return {
      id: r.id,
      code: r.code,
      discountType: r.discountType,
      discountValue: r.discountValue,
      minOrderCents: r.minOrderCents,
      maxUses: r.maxUses,
      maxUsesPerUser: r.maxUsesPerUser,
      timesUsed: r.timesUsed,
      categoryId: first,
      category: first ? path(first) : null,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      isActive: r.isActive,
      state: stateOf(r),
    }
  })
}

async function values(input: PromoCodeInput) {
  const code = input.code.trim().toUpperCase()
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new AdminError('A code is 3 to 40 letters or numbers, no spaces.')
  if (input.discountType === 'PERCENTAGE' && (input.discountValue < 1 || input.discountValue > 90))
    throw new AdminError('A percentage must be between 1 and 90.')
  if (input.discountType === 'FIXED' && input.discountValue < 1) throw new AdminError('Enter an amount off.')
  if (input.expiresAt && input.expiresAt <= input.startsAt) throw new AdminError('The expiry must be after the start.')

  /* The checkout compares the bag's own categories, so store the chosen one
     with everything beneath it: "Sports Nutrition" then also matches a
     protein in "Sports Nutrition › Protein". */
  let categoryIds: string[] | null = null
  if (input.categoryId) {
    const cats = await categoryTree()
    const out = [input.categoryId]
    for (let i = 0; i < out.length; i++) for (const c of cats) if (c.parentId === out[i]) out.push(c.id)
    categoryIds = out
  }
  return {
    code,
    discountType: input.discountType,
    discountValue: Math.round(input.discountValue),
    minOrderCents: Math.max(0, Math.round(input.minOrderCents)),
    maxUses: input.maxUses,
    maxUsesPerUser: input.maxUsesPerUser,
    categoryIds,
    productIds: null,
    startsAt: input.startsAt,
    expiresAt: input.expiresAt,
    isActive: input.isActive,
  }
}

const taken = (err: unknown) => isUniqueViolation(err, 'promo_codes_code_unique')

export async function createPromoCode(input: PromoCodeInput) {
  try {
    const [row] = await db.insert(promoCodes).values(await values(input)).returning({ id: promoCodes.id })
    return row
  } catch (err) {
    if (taken(err)) throw new AdminError('That code already exists.')
    throw err
  }
}

export async function updatePromoCode(id: string, input: PromoCodeInput) {
  try {
    const [row] = await db.update(promoCodes).set(await values(input)).where(eq(promoCodes.id, id)).returning({ id: promoCodes.id })
    if (!row) throw new AdminError('That code is already gone.')
  } catch (err) {
    if (taken(err)) throw new AdminError('That code already exists.')
    throw err
  }
}

export async function setPromoCodeActive(id: string, isActive: boolean) {
  const [row] = await db.update(promoCodes).set({ isActive }).where(eq(promoCodes.id, id)).returning({ id: promoCodes.id })
  if (!row) throw new AdminError('That code is already gone.')
}

export async function deletePromoCode(id: string) {
  const [row] = await db.select({ used: promoCodes.timesUsed }).from(promoCodes).where(eq(promoCodes.id, id))
  if (!row) return
  if (row.used > 0) throw new AdminError('This code has been used on orders, so it is kept. Turn it off instead.')
  await db.delete(promoCodes).where(sql`${promoCodes.id} = ${id}::uuid`)
}
