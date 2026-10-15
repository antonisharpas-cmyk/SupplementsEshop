/* ============================================================================
 * PRICING — spec sections 13, 14, 23, 24 and business rules 10–14, 18.
 *
 * One rule governs this whole file: the browser tells us WHAT was ordered, and
 * this module decides WHAT IT COSTS. Nothing here reads a price, a discount or
 * a total from the client.
 *
 * Money is integer cents throughout. The only place a decimal appears is in
 * `formatMoney`, at the very edge.
 *
 * Two policy decisions worth stating, because the spec allows either:
 *
 *  · A manual sale price and an automatic promotion do NOT stack. The customer
 *    gets whichever is cheaper. Stacking them is how a €59 hoodie ends up at
 *    €12 because two well-meaning rules combined.
 *
 *  · A promo code applies to the order subtotal AFTER product-level discounts,
 *    and never to the delivery fee.
 * ========================================================================== */

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  categories,
  deliveryOptions,
  products,
  promoCodes,
  promoCodeUsage,
  promotions,
  type PromoCode,
  type Promotion,
} from '@/db/schema'
import { getSettings } from './settings'

/* ------------------------------------------------------------------ money -- */

export function formatMoney(cents: number, locale = 'en', currency = 'EUR'): string {
  const tag = locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE'
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

/** Percentage off, applied to cents, rounded so the shop never loses a cent to
 *  rounding and the customer never gains one. */
function applyPercent(cents: number, percent: number): number {
  return Math.round((cents * percent) / 100)
}

/* ------------------------------------------------------- effective price -- */

export type PriceInput = {
  productId: string
  categoryId: string
  variantId: string
  /** Product base price, or the variant's override if it has one. */
  listCents: number
  /** Manual sale price, if the admin set one. */
  saleCents: number | null
}

export type EffectivePrice = {
  variantId: string
  listCents: number
  /** What the customer actually pays per unit. */
  finalCents: number
  /** listCents - finalCents, always >= 0. */
  discountCents: number
  discountPercent: number
  source: 'none' | 'sale' | 'promotion'
  promotionId: string | null
  promotionSnapshot: Record<string, unknown> | null
}

/** Promotions that are live right now, newest-priority first. */
export async function loadActivePromotions(at = new Date()): Promise<Promotion[]> {
  return db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        lte(promotions.startsAt, at),
        or(isNull(promotions.endsAt), sql`${promotions.endsAt} > ${at}`),
      ),
    )
    .orderBy(sql`${promotions.priority} desc, ${promotions.createdAt} desc`)
}

/**
 * Every ancestor of a category, so a promotion on "Men" also reaches
 * "Men → Hoodies". Walks up the tree; depth is capped to make a cycle
 * impossible to hang on even though a CHECK constraint forbids self-parenting.
 */
async function categoryAncestry(categoryIds: string[]): Promise<Map<string, string[]>> {
  if (categoryIds.length === 0) return new Map()

  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
  const parentOf = new Map(rows.map((r) => [r.id, r.parentId]))

  const out = new Map<string, string[]>()
  for (const id of new Set(categoryIds)) {
    const chain: string[] = [id]
    let cursor = parentOf.get(id) ?? null
    let depth = 0
    while (cursor && depth < 10) {
      chain.push(cursor)
      cursor = parentOf.get(cursor) ?? null
      depth++
    }
    out.set(id, chain)
  }
  return out
}

/**
 * Which products an active promotion currently touches, expressed as something
 * a SQL filter can use.
 *
 * The "on sale only" filter used to mean "salePriceCents is set", which quietly
 * excluded everything discounted by a promotion — a customer filtering for
 * reductions would not see a product whose price the shop had just cut by 20%.
 * A category promotion reaches every DESCENDANT category, mirroring the
 * ancestry walk that `resolvePrices` does per product.
 */
export async function promotionScope(at = new Date()): Promise<{
  everything: boolean
  productIds: string[]
  categoryIds: string[]
}> {
  const active = await loadActivePromotions(at)
  if (active.length === 0) return { everything: false, productIds: [], categoryIds: [] }

  if (active.some((p) => p.scope === 'ALL')) {
    return { everything: true, productIds: [], categoryIds: [] }
  }

  const productIds = active.map((p) => p.productId).filter((id): id is string => id !== null)
  const roots = active.map((p) => p.categoryId).filter((id): id is string => id !== null)

  if (roots.length === 0) return { everything: false, productIds, categoryIds: [] }

  /* Expand each promoted category downwards. One query, then a walk in memory —
     the tree is small and this runs once per listing request. */
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)

  const childrenOf = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    const siblings = childrenOf.get(row.parentId) ?? []
    siblings.push(row.id)
    childrenOf.set(row.parentId, siblings)
  }

  const reached = new Set<string>()
  const queue = [...roots]
  let guard = 0
  while (queue.length && guard++ < 1000) {
    const id = queue.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    for (const child of childrenOf.get(id) ?? []) queue.push(child)
  }

  return { everything: false, productIds, categoryIds: [...reached] }
}

/**
 * The price a customer pays, as a SQL expression over the `products` row —
 * for filtering and sorting listings by the same number the card shows.
 *
 * This is `resolvePrices` restated for the database, rule for rule: the
 * cheapest of the list price, a manual sale price below it, and each live
 * promotion that reaches the product (computed off the LIST price, so a sale
 * and a promotion never compound). A test compares the two over every
 * product, so they cannot drift apart silently.
 *
 * Without it a €69 hoodie shown at €55.20 by a promotion would be missing
 * from "up to €60", and "price: low to high" would put it in the wrong place.
 */
export async function effectivePriceSql(at = new Date()) {
  const list = sql`${products.priceCents}`
  const candidates = [
    sql`case when ${products.salePriceCents} is not null and ${products.salePriceCents} < ${list}
             then ${products.salePriceCents} else ${list} end`,
  ]
  const active = await loadActivePromotions(at)
  if (active.length) {
    const descendants = await categoryDescendants(
      active.map((p) => p.categoryId).filter((id): id is string => id !== null),
    )
    for (const promo of active) {
      const applies =
        promo.scope === 'ALL'
          ? sql`true`
          : promo.scope === 'PRODUCT'
            ? promo.productId
              ? sql`${products.id} = ${promo.productId}::uuid`
              : sql`false`
            : promo.categoryId
              ? sql`${products.categoryId} in (${sql.join(
                  (descendants.get(promo.categoryId) ?? [promo.categoryId]).map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : sql`false`
      const discounted =
        promo.discountType === 'PERCENTAGE'
          ? /* Math.round(list * pct / 100), which rounds halves up — as round() does for positives. */
            sql`(${list} - round((${list} * ${promo.discountValue})::numeric / 100)::int)`
          : sql`greatest(0, ${list} - ${promo.discountValue})`
      candidates.push(sql`case when ${applies} then ${discounted} else ${list} end`)
    }
  }
  return sql`greatest(0, least(${sql.join(candidates, sql`, `)}))`
}

/** Each category with every category beneath it (itself included). */
async function categoryDescendants(roots: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (roots.length === 0) return out
  const rows = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories)
  const childrenOf = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id])
  }
  for (const root of new Set(roots)) {
    const reached = new Set<string>()
    const queue = [root]
    let guard = 0
    while (queue.length && guard++ < 1000) {
      const id = queue.pop()!
      if (reached.has(id)) continue
      reached.add(id)
      queue.push(...(childrenOf.get(id) ?? []))
    }
    out.set(root, [...reached])
  }
  return out
}

/**
 * Resolve the price a customer pays for each variant.
 *
 * Returns a map keyed by variantId. Pure given its inputs — the promotions are
 * passed in so a cart can price many lines with one promotion query.
 */
export async function resolvePrices(
  inputs: PriceInput[],
  activePromotions?: Promotion[],
): Promise<Map<string, EffectivePrice>> {
  if (inputs.length === 0) return new Map()

  const promos = activePromotions ?? (await loadActivePromotions())
  const ancestry = await categoryAncestry(inputs.map((i) => i.categoryId))

  const out = new Map<string, EffectivePrice>()

  for (const input of inputs) {
    const list = input.listCents

    /* Candidate 1: the manual sale price. */
    let bestCents = input.saleCents !== null && input.saleCents < list ? input.saleCents : list
    let source: EffectivePrice['source'] = bestCents < list ? 'sale' : 'none'
    let promotionId: string | null = null
    let snapshot: Record<string, unknown> | null = null

    /* Candidate 2: the best applicable promotion, computed off the LIST price
       so a promotion and a sale price cannot compound. */
    const chain = ancestry.get(input.categoryId) ?? [input.categoryId]

    for (const promo of promos) {
      const applies =
        promo.scope === 'ALL' ||
        (promo.scope === 'PRODUCT' && promo.productId === input.productId) ||
        ((promo.scope === 'CATEGORY' || promo.scope === 'SUBCATEGORY') &&
          promo.categoryId !== null &&
          chain.includes(promo.categoryId))

      if (!applies) continue

      const candidate =
        promo.discountType === 'PERCENTAGE'
          ? list - applyPercent(list, promo.discountValue)
          : Math.max(0, list - promo.discountValue)

      if (candidate < bestCents) {
        bestCents = candidate
        source = 'promotion'
        promotionId = promo.id
        /* Rule 18: the order stores this, so expiring the promotion later
           cannot rewrite what the customer was charged. */
        snapshot = {
          id: promo.id,
          name: promo.name,
          scope: promo.scope,
          discountType: promo.discountType,
          discountValue: promo.discountValue,
        }
      }
    }

    const finalCents = Math.max(0, Math.min(bestCents, list))
    const discountCents = list - finalCents

    out.set(input.variantId, {
      variantId: input.variantId,
      listCents: list,
      finalCents,
      discountCents,
      discountPercent: list > 0 ? Math.round((discountCents / list) * 100) : 0,
      source,
      promotionId,
      promotionSnapshot: snapshot,
    })
  }

  return out
}

/* ------------------------------------------------------------- promo codes -- */

export type PromoCodeResult =
  | { ok: true; code: PromoCode; discountCents: number }
  | {
      ok: false
      reason:
        | 'NOT_FOUND'
        | 'INACTIVE'
        | 'NOT_STARTED'
        | 'EXPIRED'
        | 'USAGE_LIMIT_REACHED'
        | 'ALREADY_USED'
        | 'BELOW_MINIMUM'
        | 'NOT_APPLICABLE'
      message: string
      /** For BELOW_MINIMUM, how much more they need to spend. */
      shortfallCents?: number
    }

/** Just the refusal half of the union — what a caller reports to a customer. */
export type PromoCodeRefusal = Extract<PromoCodeResult, { ok: false }>

/**
 * Business rules 10–12: validated server-side, can expire, can have usage
 * limits. Called both when the code is typed in and again at checkout — a code
 * can hit its limit in between.
 */
export async function validatePromoCode(args: {
  code: string
  subtotalAfterDiscountsCents: number
  /** Product and category ids in the cart, for restricted codes. */
  productIds: string[]
  categoryIds: string[]
  email?: string | null
  userId?: string | null
  at?: Date
}): Promise<PromoCodeResult> {
  const at = args.at ?? new Date()
  const normalised = args.code.trim().toUpperCase()

  const [code] = await db
    .select()
    .from(promoCodes)
    .where(sql`upper(${promoCodes.code}) = ${normalised}`)
    .limit(1)

  if (!code) {
    return { ok: false, reason: 'NOT_FOUND', message: 'That promo code was not recognised.' }
  }
  if (!code.isActive) {
    return { ok: false, reason: 'INACTIVE', message: 'That promo code is no longer active.' }
  }
  if (code.startsAt > at) {
    return { ok: false, reason: 'NOT_STARTED', message: 'That promo code is not active yet.' }
  }
  if (code.expiresAt && code.expiresAt <= at) {
    return { ok: false, reason: 'EXPIRED', message: 'That promo code has expired.' }
  }
  if (code.maxUses !== null && code.timesUsed >= code.maxUses) {
    return {
      ok: false,
      reason: 'USAGE_LIMIT_REACHED',
      message: 'That promo code has been fully redeemed.',
    }
  }

  /* Per-customer limit, keyed on email so a guest cannot reuse a one-per-person
     code by not signing in. */
  if (code.maxUsesPerUser !== null && args.email) {
    const [used] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(promoCodeUsage)
      .where(
        and(
          eq(promoCodeUsage.promoCodeId, code.id),
          sql`lower(${promoCodeUsage.email}) = ${args.email.toLowerCase()}`,
        ),
      )
    if (used && used.n >= code.maxUsesPerUser) {
      return {
        ok: false,
        reason: 'ALREADY_USED',
        message: 'You have already used that promo code.',
      }
    }
  }

  if (args.subtotalAfterDiscountsCents < code.minOrderCents) {
    return {
      ok: false,
      reason: 'BELOW_MINIMUM',
      message: `That code needs a minimum order of ${formatMoney(code.minOrderCents)}.`,
      shortfallCents: code.minOrderCents - args.subtotalAfterDiscountsCents,
    }
  }

  /* Restricted to particular products or categories. */
  const restrictedProducts = (code.productIds as string[] | null) ?? null
  const restrictedCategories = (code.categoryIds as string[] | null) ?? null

  if (restrictedProducts?.length || restrictedCategories?.length) {
    const productMatch = restrictedProducts?.some((id) => args.productIds.includes(id)) ?? false
    const categoryMatch = restrictedCategories?.some((id) => args.categoryIds.includes(id)) ?? false
    if (!productMatch && !categoryMatch) {
      return {
        ok: false,
        reason: 'NOT_APPLICABLE',
        message: 'That code does not apply to anything in your bag.',
      }
    }
  }

  const discountCents =
    code.discountType === 'PERCENTAGE'
      ? applyPercent(args.subtotalAfterDiscountsCents, code.discountValue)
      : Math.min(code.discountValue, args.subtotalAfterDiscountsCents)

  return { ok: true, code, discountCents }
}

/* ---------------------------------------------------------------- delivery -- */

export type DeliveryQuote = {
  optionId: string
  kind: 'PICKUP' | 'SHIPPING'
  name: Record<string, string>
  priceCents: number
  /** What it would cost without the free-delivery rule, for "you saved" copy. */
  baseCents: number
  isFree: boolean
  freeOverCents: number | null
  /** How much more to spend to unlock free delivery, or null if already free. */
  spendMoreForFreeCents: number | null
  minDays: number | null
  maxDays: number | null
}

/**
 * Section 14: the free-delivery threshold is configurable and read at request
 * time. An option may override the global threshold with its own.
 */
export async function quoteDelivery(
  subtotalAfterDiscountsCents: number,
  optionId?: string,
): Promise<DeliveryQuote[]> {
  const { free_delivery_threshold_cents: globalThreshold } = await getSettings([
    'free_delivery_threshold_cents',
  ])

  const conditions = [eq(deliveryOptions.isActive, true)]
  if (optionId) conditions.push(eq(deliveryOptions.id, optionId))

  const options = await db
    .select()
    .from(deliveryOptions)
    .where(and(...conditions))
    .orderBy(deliveryOptions.position)

  return options.map((option) => {
    const threshold = option.freeOverCents ?? globalThreshold
    /* Pickup is free by definition; shipping is free above the threshold. */
    const qualifies =
      option.kind === 'PICKUP' ||
      option.priceCents === 0 ||
      subtotalAfterDiscountsCents >= threshold

    return {
      optionId: option.id,
      kind: option.kind,
      name: option.name,
      baseCents: option.priceCents,
      priceCents: qualifies ? 0 : option.priceCents,
      isFree: qualifies,
      freeOverCents: option.kind === 'SHIPPING' ? threshold : null,
      spendMoreForFreeCents:
        option.kind === 'SHIPPING' && !qualifies
          ? Math.max(0, threshold - subtotalAfterDiscountsCents)
          : null,
      minDays: option.minDays,
      maxDays: option.maxDays,
    }
  })
}

/* ------------------------------------------------------------------- totals -- */

export type CartLineForPricing = {
  variantId: string
  productId: string
  categoryId: string
  quantity: number
  listCents: number
  saleCents: number | null
}

export type PricedLine = CartLineForPricing & {
  unitFinalCents: number
  unitDiscountCents: number
  lineListCents: number
  lineFinalCents: number
  lineDiscountCents: number
  promotionId: string | null
  promotionSnapshot: Record<string, unknown> | null
}

export type CartTotals = {
  lines: PricedLine[]
  /** Sum of list prices — what it would cost with nothing applied. */
  listTotalCents: number
  /** Sum of what the lines actually cost. This is the "subtotal". */
  subtotalCents: number
  /** listTotal - subtotal. */
  promotionDiscountCents: number
  promoCode: { id: string; code: string; discountCents: number } | null
  promoCodeDiscountCents: number
  deliveryCents: number
  deliveryOptionId: string | null
  totalCents: number
  /** Extracted from the total, because displayed prices are VAT-inclusive. */
  vatCents: number
  netCents: number
  vatRateBp: number
  currency: string
  itemCount: number
}

/**
 * The single source of truth for what a basket costs. The cart page, the
 * checkout page and the Stripe PaymentIntent all read from this, so the number
 * the customer sees and the number they are charged cannot diverge.
 */
export async function priceCart(args: {
  lines: CartLineForPricing[]
  deliveryOptionId?: string | null
  promoCode?: string | null
  email?: string | null
  userId?: string | null
}): Promise<{ totals: CartTotals; promoCodeError: PromoCodeRefusal | null }> {
  const { vat_rate_bp: vatRateBp, currency } = await getSettings(['vat_rate_bp', 'currency'])

  const prices = await resolvePrices(
    args.lines.map((l) => ({
      productId: l.productId,
      categoryId: l.categoryId,
      variantId: l.variantId,
      listCents: l.listCents,
      saleCents: l.saleCents,
    })),
  )

  const lines: PricedLine[] = args.lines.map((line) => {
    const price = prices.get(line.variantId)
    const unitFinal = price?.finalCents ?? line.listCents
    const unitDiscount = price?.discountCents ?? 0
    return {
      ...line,
      unitFinalCents: unitFinal,
      unitDiscountCents: unitDiscount,
      lineListCents: line.listCents * line.quantity,
      lineFinalCents: unitFinal * line.quantity,
      lineDiscountCents: unitDiscount * line.quantity,
      promotionId: price?.promotionId ?? null,
      promotionSnapshot: price?.promotionSnapshot ?? null,
    }
  })

  const listTotalCents = lines.reduce((s, l) => s + l.lineListCents, 0)
  const subtotalCents = lines.reduce((s, l) => s + l.lineFinalCents, 0)
  const promotionDiscountCents = listTotalCents - subtotalCents

  /* --- promo code --- */
  let promoCodeDiscountCents = 0
  let appliedCode: CartTotals['promoCode'] = null
  let promoCodeError: PromoCodeRefusal | null = null

  if (args.promoCode) {
    const result = await validatePromoCode({
      code: args.promoCode,
      subtotalAfterDiscountsCents: subtotalCents,
      productIds: [...new Set(lines.map((l) => l.productId))],
      categoryIds: [...new Set(lines.map((l) => l.categoryId))],
      email: args.email,
      userId: args.userId,
    })
    if (result.ok) {
      promoCodeDiscountCents = Math.min(result.discountCents, subtotalCents)
      appliedCode = {
        id: result.code.id,
        code: result.code.code,
        discountCents: promoCodeDiscountCents,
      }
    } else {
      /* Do not silently drop an invalid code — the customer typed it and needs
         to know why it did nothing. */
      promoCodeError = result
    }
  }

  /* --- delivery, quoted on the post-discount subtotal --- */
  const afterDiscounts = subtotalCents - promoCodeDiscountCents
  let deliveryCents = 0
  let deliveryOptionId: string | null = null

  if (args.deliveryOptionId) {
    const [quote] = await quoteDelivery(afterDiscounts, args.deliveryOptionId)
    if (quote) {
      deliveryCents = quote.priceCents
      deliveryOptionId = quote.optionId
    }
  }

  const totalCents = subtotalCents - promoCodeDiscountCents + deliveryCents

  /* Prices include VAT, so VAT is extracted from the gross rather than added:
     vat = total - total / (1 + rate). */
  const vatCents = Math.round(totalCents - (totalCents * 10_000) / (10_000 + vatRateBp))

  return {
    totals: {
      lines,
      listTotalCents,
      subtotalCents,
      promotionDiscountCents,
      promoCode: appliedCode,
      promoCodeDiscountCents,
      deliveryCents,
      deliveryOptionId,
      totalCents,
      vatCents,
      netCents: totalCents - vatCents,
      vatRateBp,
      currency,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
    },
    promoCodeError,
  }
}

/* --------------------------------------------------------------- order refs -- */

/** Human-readable, unambiguous, and not guessable in sequence. Order numbers
 *  are half of guest order lookup, so they must not be enumerable. */
export function generateOrderNumber(prefix: string, rand: () => number = Math.random): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let body = ''
  for (let i = 0; i < 8; i++) body += alphabet[Math.floor(rand() * alphabet.length)]
  return `${prefix}-${body}`
}
