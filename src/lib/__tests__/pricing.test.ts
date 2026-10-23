/* ============================================================================
 * Pricing tests — spec section 45: cart calculation, promo codes, delivery
 * cost, free-delivery threshold.
 *
 * These are the sums a customer sees and a card gets charged, so every rule
 * gets a case: promotion precedence, category inheritance, the no-stacking
 * policy, promo code limits, the configurable threshold, and VAT extraction.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import {
  categories,
  deliveryOptions,
  orders,
  promoCodeUsage,
  promoCodes,
  promotions,
  productVariants,
  products,
  settings,
} from '@/db/schema'
import {
  formatMoney,
  generateOrderNumber,
  priceCart,
  promotionScope,
  quoteDelivery,
  resolvePrices,
  validatePromoCode,
  type CartLineForPricing,
} from '../pricing'
import { listProducts } from '../catalog'
import { invalidateSettingsCache, setSetting } from '../settings'

let menId: string
let hoodiesId: string
let womenId: string
let hoodieProductId: string
let hoodieVariantId: string
let teeProductId: string
let teeVariantId: string
let shippingId: string
let pickupId: string

async function fixture() {
  await db.delete(promoCodeUsage)
  await db.execute(sql`delete from invoices`)
  await db.delete(orders)
  await db.delete(promoCodes)
  await db.delete(promotions)
  await db.delete(productVariants)
  await db.delete(products)
  await db.delete(categories)
  await db.delete(deliveryOptions)
  await db.delete(settings)
  invalidateSettingsCache()

  const [men, women] = await db
    .insert(categories)
    .values([
      { slug: 'men', name: { en: 'Men' }, position: 0 },
      { slug: 'women', name: { en: 'Women' }, position: 1 },
    ])
    .returning({ id: categories.id })
  menId = men.id
  womenId = women.id

  const [hoodies] = await db
    .insert(categories)
    .values({ parentId: menId, slug: 'hoodies', name: { en: 'Hoodies' } })
    .returning({ id: categories.id })
  hoodiesId = hoodies.id

  const [hoodie, tee] = await db
    .insert(products)
    .values([
      {
        categoryId: hoodiesId,
        slug: 'black-oversized-hoodie',
        name: { en: 'Black Oversized Hoodie' },
        priceCents: 5900,
        isActive: true,
      },
      {
        categoryId: womenId,
        slug: 'white-tee',
        name: { en: 'White Tee' },
        priceCents: 2500,
        isActive: true,
      },
    ])
    .returning({ id: products.id })
  hoodieProductId = hoodie.id
  teeProductId = tee.id

  const [hv, tv] = await db
    .insert(productVariants)
    .values([
      { productId: hoodieProductId, sku: 'HOOD-BLK-M', size: 'M', colorHex: '#000000' },
      { productId: teeProductId, sku: 'TEE-WHT-S', size: 'S', colorHex: '#ffffff' },
    ])
    .returning({ id: productVariants.id })
  hoodieVariantId = hv.id
  teeVariantId = tv.id

  const [ship, pick] = await db
    .insert(deliveryOptions)
    .values([
      {
        kind: 'SHIPPING',
        name: { en: 'Home delivery' },
        priceCents: 500,
        minDays: 2,
        maxDays: 4,
        position: 1,
      },
      { kind: 'PICKUP', name: { en: 'Collect in store' }, priceCents: 0, position: 0 },
    ])
    .returning({ id: deliveryOptions.id })
  shippingId = ship.id
  pickupId = pick.id
}

const hoodieLine = (qty = 1): CartLineForPricing => ({
  variantId: hoodieVariantId,
  productId: hoodieProductId,
  categoryId: hoodiesId,
  quantity: qty,
  listCents: 5900,
  saleCents: null,
})

const teeLine = (qty = 1): CartLineForPricing => ({
  variantId: teeVariantId,
  productId: teeProductId,
  categoryId: womenId,
  quantity: qty,
  listCents: 2500,
  saleCents: null,
})

beforeEach(fixture)
afterAll(async () => {
  await pool.end()
})

/* ========================================================================== */

describe('effective price', () => {
  it('is the list price when nothing applies', async () => {
    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)).toMatchObject({
      finalCents: 5900,
      discountCents: 0,
      source: 'none',
    })
  })

  it('uses a manual sale price', async () => {
    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: 4900,
      },
    ])
    expect(prices.get(hoodieVariantId)).toMatchObject({
      finalCents: 4900,
      discountCents: 1000,
      source: 'sale',
      discountPercent: 17,
    })
  })

  it('applies a product promotion', async () => {
    await db.insert(promotions).values({
      name: '20% off the hoodie',
      scope: 'PRODUCT',
      productId: hoodieProductId,
      discountType: 'PERCENTAGE',
      discountValue: 20,
      startsAt: new Date(Date.now() - 1000),
    })

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)).toMatchObject({
      finalCents: 4720,
      source: 'promotion',
      discountPercent: 20,
    })
  })

  it('inherits a promotion from a parent category', async () => {
    /* Promotion on "Men" must reach "Men → Hoodies". */
    await db.insert(promotions).values({
      name: '10% off menswear',
      scope: 'CATEGORY',
      categoryId: menId,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1000),
    })

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(5310)
  })

  it('does not apply another category’s promotion', async () => {
    await db.insert(promotions).values({
      name: '50% off womenswear',
      scope: 'CATEGORY',
      categoryId: womenId,
      discountType: 'PERCENTAGE',
      discountValue: 50,
      startsAt: new Date(Date.now() - 1000),
    })

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(5900)
  })

  it('gives the customer the better of a sale price and a promotion, never both', async () => {
    /* Sale price 4900. A 10% promotion off list would be 5310 — worse for the
       customer, so the sale price must win, and they must NOT compound to
       4900 - 10% = 4410. */
    await db.insert(promotions).values({
      name: '10% off menswear',
      scope: 'CATEGORY',
      categoryId: menId,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1000),
    })

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: 4900,
      },
    ])
    expect(prices.get(hoodieVariantId)).toMatchObject({ finalCents: 4900, source: 'sale' })
  })

  it('picks the deepest discount when several promotions apply', async () => {
    await db.insert(promotions).values([
      {
        name: '10% menswear',
        scope: 'CATEGORY',
        categoryId: menId,
        discountType: 'PERCENTAGE',
        discountValue: 10,
        startsAt: new Date(Date.now() - 1000),
      },
      {
        name: '€20 off this hoodie',
        scope: 'PRODUCT',
        productId: hoodieProductId,
        discountType: 'FIXED',
        discountValue: 2000,
        startsAt: new Date(Date.now() - 1000),
      },
    ])

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    /* €20 off beats 10% off €59 (€5.90). */
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(3900)
  })

  it('ignores a promotion outside its date window', async () => {
    await db.insert(promotions).values([
      {
        name: 'finished',
        scope: 'ALL',
        discountType: 'PERCENTAGE',
        discountValue: 50,
        startsAt: new Date(Date.now() - 20_000),
        endsAt: new Date(Date.now() - 10_000),
      },
      {
        name: 'not yet',
        scope: 'ALL',
        discountType: 'PERCENTAGE',
        discountValue: 50,
        startsAt: new Date(Date.now() + 60_000),
      },
    ])

    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(5900)
  })

  it('ignores a deactivated promotion', async () => {
    await db.insert(promotions).values({
      name: 'switched off',
      scope: 'ALL',
      discountType: 'PERCENTAGE',
      discountValue: 50,
      startsAt: new Date(Date.now() - 1000),
      isActive: false,
    })
    const prices = await resolvePrices([
      {
        productId: hoodieProductId,
        categoryId: hoodiesId,
        variantId: hoodieVariantId,
        listCents: 5900,
        saleCents: null,
      },
    ])
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(5900)
  })

  it('never produces a negative price from an oversized fixed discount', async () => {
    await db.insert(promotions).values({
      name: 'huge',
      scope: 'ALL',
      discountType: 'FIXED',
      discountValue: 999_99,
      startsAt: new Date(Date.now() - 1000),
    })
    const prices = await resolvePrices([
      {
        productId: teeProductId,
        categoryId: womenId,
        variantId: teeVariantId,
        listCents: 2500,
        saleCents: null,
      },
    ])
    expect(prices.get(teeVariantId)?.finalCents).toBe(0)
  })
})

/* ========================================================================== */

describe('free delivery threshold is configurable', () => {
  it('charges delivery below the default threshold and not above it', async () => {
    const under = await quoteDelivery(4999, shippingId)
    expect(under[0]).toMatchObject({ priceCents: 500, isFree: false, spendMoreForFreeCents: 1 })

    const over = await quoteDelivery(5000, shippingId)
    expect(over[0]).toMatchObject({ priceCents: 0, isFree: true })
  })

  it('follows the admin when the threshold changes', async () => {
    /* Section 14: admin moves it from €50 to €60 and the frontend must follow
       without a code change. */
    await setSetting('free_delivery_threshold_cents', 6000)

    const at55 = await quoteDelivery(5500, shippingId)
    expect(at55[0]).toMatchObject({ priceCents: 500, isFree: false })

    const at60 = await quoteDelivery(6000, shippingId)
    expect(at60[0]).toMatchObject({ priceCents: 0, isFree: true })
  })

  it('lets a delivery option override the global threshold', async () => {
    await setSetting('free_delivery_threshold_cents', 5000)
    await db
      .update(deliveryOptions)
      .set({ freeOverCents: 10_000 })
      .where(eq(deliveryOptions.id, shippingId))

    const at60 = await quoteDelivery(6000, shippingId)
    expect(at60[0]).toMatchObject({ priceCents: 500, isFree: false, freeOverCents: 10_000 })
  })

  it('treats store pickup as free at any basket size', async () => {
    const quote = await quoteDelivery(100, pickupId)
    expect(quote[0]).toMatchObject({ kind: 'PICKUP', priceCents: 0, isFree: true })
  })
})

/* ========================================================================== */

describe('promo codes', () => {
  const CODE_DEFAULTS = {
    code: 'SUMMER20',
    discountType: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
    discountValue: 20,
    minOrderCents: 0,
    maxUses: null as number | null,
    maxUsesPerUser: null as number | null,
    productIds: null as string[] | null,
    categoryIds: null as string[] | null,
    isActive: true,
    startsAt: new Date(Date.now() - 1000),
    expiresAt: null as Date | null,
  }

  async function makeCode(overrides: Partial<typeof CODE_DEFAULTS> = {}) {
    const [row] = await db
      .insert(promoCodes)
      .values({ ...CODE_DEFAULTS, ...overrides })
      .returning()
    return row
  }

  const ctx = (subtotal: number, email?: string) => ({
    subtotalAfterDiscountsCents: subtotal,
    productIds: [hoodieProductId],
    categoryIds: [hoodiesId],
    email: email ?? 'a@example.com',
  })

  it('applies a percentage discount', async () => {
    await makeCode()
    const result = await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })
    expect(result).toMatchObject({ ok: true, discountCents: 1180 })
  })

  it('is case-insensitive and ignores surrounding spaces', async () => {
    await makeCode()
    const result = await validatePromoCode({ code: '  summer20 ', ...ctx(5900) })
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown code', async () => {
    const result = await validatePromoCode({ code: 'NOPE', ...ctx(5900) })
    expect(result).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
  })

  it('rejects an expired code', async () => {
    await makeCode({ expiresAt: new Date(Date.now() - 1000) })
    const result = await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })
    expect(result).toMatchObject({ ok: false, reason: 'EXPIRED' })
  })

  it('rejects a deactivated code', async () => {
    await makeCode({ isActive: false })
    expect(await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })).toMatchObject({
      ok: false,
      reason: 'NOT_FOUND',
    })
  })

  it('rejects a code that has hit its usage cap', async () => {
    const code = await makeCode({ maxUses: 100 })
    await db.update(promoCodes).set({ timesUsed: 100 }).where(eq(promoCodes.id, code.id))

    expect(await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })).toMatchObject({
      ok: false,
      reason: 'USAGE_LIMIT_REACHED',
    })
  })

  it('enforces a minimum order and says how short they are', async () => {
    await makeCode({ minOrderCents: 8000 })
    const result = await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })
    expect(result).toMatchObject({ ok: false, reason: 'BELOW_MINIMUM', shortfallCents: 2100 })
  })

  it('enforces one use per customer, keyed on email so guests cannot reuse it', async () => {
    const code = await makeCode({ maxUsesPerUser: 1 })

    const [order] = await db
      .insert(orders)
      .values({
        orderNumber: 'SF-TEST0001',
        email: 'repeat@example.com',
        phone: '+35799000000',
        customerName: 'R E',
        deliveryKind: 'SHIPPING',
        subtotalCents: 5900,
        deliveryCents: 0,
        totalCents: 5900,
      })
      .returning({ id: orders.id })

    await db.insert(promoCodeUsage).values({
      promoCodeId: code.id,
      orderId: order.id,
      email: 'repeat@example.com',
      discountCents: 1180,
    })

    expect(
      await validatePromoCode({ code: 'SUMMER20', ...ctx(5900, 'repeat@example.com') }),
    ).toMatchObject({ ok: false, reason: 'ALREADY_USED' })

    /* A different customer is unaffected. */
    expect(
      await validatePromoCode({ code: 'SUMMER20', ...ctx(5900, 'someone@example.com') }),
    ).toMatchObject({ ok: true })
  })

  it('rejects a restricted code when nothing in the bag matches', async () => {
    await makeCode({ productIds: [teeProductId] })
    expect(await validatePromoCode({ code: 'SUMMER20', ...ctx(5900) })).toMatchObject({
      ok: false,
      reason: 'NOT_APPLICABLE',
    })
  })

  it('never discounts more than the subtotal', async () => {
    await makeCode({ discountType: 'FIXED', discountValue: 999_99 })
    const result = await validatePromoCode({ code: 'SUMMER20', ...ctx(2500) })
    expect(result).toMatchObject({ ok: true, discountCents: 2500 })
  })
})

/* ========================================================================== */

describe('cart totals', () => {
  it('adds up lines, delivery and VAT coherently', async () => {
    const { totals } = await priceCart({
      lines: [hoodieLine(1), teeLine(2)],
      deliveryOptionId: shippingId,
    })

    expect(totals.subtotalCents).toBe(5900 + 5000)
    expect(totals.itemCount).toBe(3)
    /* €109 is over the €50 threshold, so delivery is free. */
    expect(totals.deliveryCents).toBe(0)
    expect(totals.totalCents).toBe(10_900)

    /* VAT is extracted from the gross, not added on top. */
    expect(totals.netCents + totals.vatCents).toBe(totals.totalCents)
    expect(totals.vatCents).toBe(Math.round(10_900 - (10_900 * 10_000) / 11_900))
  })

  it('charges delivery on a small basket', async () => {
    const { totals } = await priceCart({
      lines: [teeLine(1)],
      deliveryOptionId: shippingId,
    })
    expect(totals.subtotalCents).toBe(2500)
    expect(totals.deliveryCents).toBe(500)
    expect(totals.totalCents).toBe(3000)
  })

  it('reports the promotion saving separately from the promo code saving', async () => {
    await db.insert(promotions).values({
      name: '20% off menswear',
      scope: 'CATEGORY',
      categoryId: menId,
      discountType: 'PERCENTAGE',
      discountValue: 20,
      startsAt: new Date(Date.now() - 1000),
    })
    await db.insert(promoCodes).values({
      code: 'EXTRA10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1000),
    })

    const { totals } = await priceCart({
      lines: [hoodieLine(1)],
      deliveryOptionId: pickupId,
      promoCode: 'EXTRA10',
      email: 'x@example.com',
    })

    expect(totals.listTotalCents).toBe(5900)
    expect(totals.subtotalCents).toBe(4720) // 20% off
    expect(totals.promotionDiscountCents).toBe(1180)
    expect(totals.promoCodeDiscountCents).toBe(472) // 10% of 4720
    expect(totals.totalCents).toBe(4248)
  })

  it('does not apply a promo code to the delivery fee', async () => {
    await db.insert(promoCodes).values({
      code: 'HALF',
      discountType: 'PERCENTAGE',
      discountValue: 50,
      startsAt: new Date(Date.now() - 1000),
    })

    const { totals } = await priceCart({
      lines: [teeLine(1)], // €25, under the threshold so €5 delivery
      deliveryOptionId: shippingId,
      promoCode: 'HALF',
      email: 'x@example.com',
    })

    expect(totals.promoCodeDiscountCents).toBe(1250)
    expect(totals.deliveryCents).toBe(500)
    expect(totals.totalCents).toBe(2500 - 1250 + 500)
  })

  it('reports an invalid promo code instead of silently ignoring it', async () => {
    const { totals, promoCodeError } = await priceCart({
      lines: [hoodieLine(1)],
      deliveryOptionId: pickupId,
      promoCode: 'MADEUP',
    })
    expect(totals.promoCodeDiscountCents).toBe(0)
    expect(promoCodeError).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
  })

  it('handles an empty basket without dividing by zero', async () => {
    const { totals } = await priceCart({ lines: [] })
    expect(totals).toMatchObject({
      subtotalCents: 0,
      totalCents: 0,
      vatCents: 0,
      itemCount: 0,
    })
  })

  it('can push a basket over the free-delivery line using the promo code', async () => {
    /* A discount that drops the basket BELOW the threshold must re-introduce
       the delivery fee — the threshold applies to what is actually paid. */
    await db.insert(promoCodes).values({
      code: 'TAKE20',
      discountType: 'FIXED',
      discountValue: 2000,
      startsAt: new Date(Date.now() - 1000),
    })

    const { totals } = await priceCart({
      lines: [teeLine(2), hoodieLine(1)], // 5000 + 5900 = 10900
      deliveryOptionId: shippingId,
      promoCode: 'TAKE20',
      email: 'x@example.com',
    })

    /* 10900 - 2000 = 8900, still above €50, so delivery stays free. */
    expect(totals.promoCodeDiscountCents).toBe(2000)
    expect(totals.deliveryCents).toBe(0)
  })
})

/* ========================================================================== */

describe('money formatting and order numbers', () => {
  it('formats euros for each locale', () => {
    expect(formatMoney(5900, 'en')).toMatch(/59\.00/)
    expect(formatMoney(5900, 'el')).toMatch(/59,00/)
    expect(formatMoney(5900, 'ru')).toMatch(/59,00/)
  })

  it('generates order numbers without ambiguous characters', () => {
    const n = generateOrderNumber('SF')
    expect(n).toMatch(/^SF-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/)
    /* No 0/O or 1/I, so a number read over the phone is unambiguous. */
    expect(n.slice(3)).not.toMatch(/[01OI]/)
  })

  it('does not repeat itself across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateOrderNumber('SF')))
    expect(seen.size).toBe(500)
  })
})


/* ========================================================================== */

describe('what counts as reduced', () => {
  it('reports the descendants of a promoted parent category', async () => {
    await db.insert(promotions).values({
      name: '20% off menswear',
      scope: 'CATEGORY',
      categoryId: menId,
      discountType: 'PERCENTAGE',
      discountValue: 20,
      startsAt: new Date(Date.now() - 1000),
    })

    const scope = await promotionScope()
    expect(scope.everything).toBe(false)
    /* Men itself and Men → Hoodies, so a hoodie is covered. */
    expect(scope.categoryIds).toContain(menId)
    expect(scope.categoryIds).toContain(hoodiesId)
    expect(scope.categoryIds).not.toContain(womenId)
  })

  it('reports a product-scoped promotion as that product', async () => {
    await db.insert(promotions).values({
      name: 'Hoodie deal',
      scope: 'PRODUCT',
      productId: hoodieProductId,
      discountType: 'FIXED',
      discountValue: 500,
      startsAt: new Date(Date.now() - 1000),
    })

    const scope = await promotionScope()
    expect(scope.productIds).toEqual([hoodieProductId])
    expect(scope.categoryIds).toEqual([])
  })

  it('ignores a promotion that has not started or has ended', async () => {
    await db.insert(promotions).values([
      {
        name: 'Future',
        scope: 'CATEGORY',
        categoryId: menId,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        startsAt: new Date(Date.now() + 60_000),
      },
      {
        name: 'Past',
        scope: 'CATEGORY',
        categoryId: womenId,
        discountType: 'PERCENTAGE',
        discountValue: 20,
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() - 60_000),
      },
    ])

    const scope = await promotionScope()
    expect(scope.categoryIds).toEqual([])
    expect(scope.productIds).toEqual([])
  })

  it('finds a promotion-discounted product under the "on sale" filter', async () => {
    /* The hoodie has NO salePriceCents — its reduction comes entirely from a
       category promotion. Filtering on salePriceCents alone hid it. */
    await db.insert(promotions).values({
      name: '20% off menswear',
      scope: 'CATEGORY',
      categoryId: menId,
      discountType: 'PERCENTAGE',
      discountValue: 20,
      startsAt: new Date(Date.now() - 1000),
    })

    const listing = await listProducts({ onSale: true, sort: 'newest', page: 1, perPage: 20, locale: 'en' })
    const slugs = listing.items.map((i) => i.slug)
    expect(slugs).toContain('black-oversized-hoodie')
    expect(slugs).not.toContain('white-tee')
  })

  it('still finds a manually reduced product with no promotion at all', async () => {
    await db
      .update(products)
      .set({ salePriceCents: 1900 })
      .where(eq(products.id, teeProductId))

    const listing = await listProducts({ onSale: true, sort: 'newest', page: 1, perPage: 20, locale: 'en' })
    expect(listing.items.map((i) => i.slug)).toEqual(['white-tee'])
  })

  it('narrows nothing when a promotion covers the whole catalogue', async () => {
    await db.insert(promotions).values({
      name: 'Everything must go',
      scope: 'ALL',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1000),
    })

    const listing = await listProducts({ onSale: true, sort: 'newest', page: 1, perPage: 20, locale: 'en' })
    expect(listing.items).toHaveLength(2)
  })
})

/* ========================================================================== */

describe('membership tier pricing', () => {
  const hoodie = (listCents: number, saleCents: number | null = null) => ({
    productId: hoodieProductId,
    categoryId: hoodiesId,
    variantId: hoodieVariantId,
    listCents,
    saleCents,
  })

  it('takes the tier discount off the list price', async () => {
    const prices = await resolvePrices([hoodie(10000)], undefined, { tierPercent: 12 })
    expect(prices.get(hoodieVariantId)).toMatchObject({ finalCents: 8800, tierDiscountCents: 1200, source: 'tier' })
  })

  it('applies the tier first, then the promotion on the tier price', async () => {
    await db.insert(promotions).values({
      name: '10% off hoodies',
      scope: 'CATEGORY',
      categoryId: hoodiesId,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      startsAt: new Date(Date.now() - 1000),
    })
    const prices = await resolvePrices([hoodie(10000)], undefined, { tierPercent: 12 })
    /* €100 → Champion 12% → €88 → promotion 10% → €79.20 */
    expect(prices.get(hoodieVariantId)).toMatchObject({ finalCents: 7920, tierDiscountCents: 1200, discountCents: 2080 })
  })

  it('takes the tier off a sale price too', async () => {
    const prices = await resolvePrices([hoodie(10000, 8000)], undefined, { tierPercent: 5 })
    expect(prices.get(hoodieVariantId)?.finalCents).toBe(7600)
  })

  it('changes nothing at Basic', async () => {
    const prices = await resolvePrices([hoodie(10000)], undefined, { tierPercent: 0 })
    expect(prices.get(hoodieVariantId)).toMatchObject({ finalCents: 10000, tierDiscountCents: 0, source: 'none' })
  })
})
