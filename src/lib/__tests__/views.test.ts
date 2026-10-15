/* Product views: one row per viewer per product, and a guest's history
   following them into their account at sign-in. */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, productViews, products, users } from '@/db/schema'
import {
  getProductCardsByIds,
  getRecentlyViewed,
  mergeGuestViews,
  recordProductView,
} from '../views'

let categoryId: string
let hoodieId: string
let teeId: string
let userId: string

async function fixture() {
  await db.delete(productViews)
  await db.delete(products)
  await db.delete(categories)
  await db.delete(users)

  const [cat] = await db
    .insert(categories)
    .values({ slug: 'men', name: { en: 'Men' }, position: 0 })
    .returning({ id: categories.id })
  categoryId = cat.id

  const [hoodie, tee] = await db
    .insert(products)
    .values([
      {
        categoryId,
        slug: 'hoodie',
        name: { en: 'Hoodie' },
        priceCents: 5900,
        isActive: true,
      },
      { categoryId, slug: 'tee', name: { en: 'Tee' }, priceCents: 2500, isActive: true },
    ])
    .returning({ id: products.id })
  hoodieId = hoodie.id
  teeId = tee.id

  const [user] = await db
    .insert(users)
    .values({
      email: 'viewer@example.com',
      passwordHash: 'x',
      firstName: 'V',
      lastName: 'Iewer',
      phone: '+35799000001',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id })
  userId = user.id
}

async function rowCount() {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(productViews)
  return row.n
}

beforeEach(fixture)
afterAll(async () => {
  await pool.end()
})

describe('recordProductView', () => {
  it('records a view for an anonymous visitor', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    expect(await rowCount()).toBe(1)
  })

  it('keeps one row per viewer per product however often they look', async () => {
    for (let i = 0; i < 5; i++) await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    expect(await rowCount()).toBe(1)
  })

  it('counts two different visitors separately', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await recordProductView(hoodieId, { anonymousToken: 'tok-b' })
    expect(await rowCount()).toBe(2)
  })

  it('keeps an account and a token apart', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await recordProductView(hoodieId, { userId })
    expect(await rowCount()).toBe(2)
  })

  it('ignores the token once someone is signed in', async () => {
    await recordProductView(hoodieId, { userId, anonymousToken: 'tok-a' })
    const [row] = await db.select().from(productViews)
    expect(row.userId).toBe(userId)
    expect(row.anonymousToken).toBeNull()
  })

  it('does not throw on a product that does not exist', async () => {
    /* A view is analytics. It must never be able to break a page. */
    await expect(
      recordProductView('00000000-0000-0000-0000-000000000000', { anonymousToken: 'tok-a' }),
    ).resolves.toBeUndefined()
    expect(await rowCount()).toBe(0)
  })
})

describe('getRecentlyViewed', () => {
  it('returns nothing for a visitor with no identity', async () => {
    expect(await getRecentlyViewed({}, { locale: 'en' })).toEqual([])
  })

  it('returns the newest first', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await new Promise((r) => setTimeout(r, 15))
    await recordProductView(teeId, { anonymousToken: 'tok-a' })

    const seen = await getRecentlyViewed({ anonymousToken: 'tok-a' }, { locale: 'en' })
    expect(seen.map((s) => s.slug)).toEqual(['tee', 'hoodie'])
  })

  it('excludes the product being looked at', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await recordProductView(teeId, { anonymousToken: 'tok-a' })

    const seen = await getRecentlyViewed(
      { anonymousToken: 'tok-a' },
      { locale: 'en', excludeProductId: teeId },
    )
    expect(seen.map((s) => s.slug)).toEqual(['hoodie'])
  })

  it('does not leak another visitor’s history', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    expect(await getRecentlyViewed({ anonymousToken: 'tok-b' }, { locale: 'en' })).toEqual([])
  })

  it('hides a product the shop has deactivated', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await db.update(products).set({ isActive: false }).where(eq(products.id, hoodieId))
    expect(await getRecentlyViewed({ anonymousToken: 'tok-a' }, { locale: 'en' })).toEqual([])
  })

  it('translates the name for the locale', async () => {
    await db
      .update(products)
      .set({ name: { en: 'Hoodie', el: 'Φούτερ' } })
      .where(eq(products.id, hoodieId))
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })

    const [seen] = await getRecentlyViewed({ anonymousToken: 'tok-a' }, { locale: 'el' })
    expect(seen.name).toBe('Φούτερ')
  })
})

describe('mergeGuestViews', () => {
  it('carries a guest history into the account', async () => {
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })
    await recordProductView(teeId, { anonymousToken: 'tok-a' })

    await mergeGuestViews('tok-a', userId)

    const mine = await getRecentlyViewed({ userId }, { locale: 'en' })
    expect(mine.map((m) => m.slug).sort()).toEqual(['hoodie', 'tee'])
    /* And the guest rows are gone rather than duplicated. */
    expect(await rowCount()).toBe(2)
  })

  it('does not duplicate a product the account had already seen', async () => {
    await recordProductView(hoodieId, { userId })
    await recordProductView(hoodieId, { anonymousToken: 'tok-a' })

    await mergeGuestViews('tok-a', userId)
    expect(await rowCount()).toBe(1)
  })

  it('is harmless when the guest has no history', async () => {
    await expect(mergeGuestViews('tok-nothing', userId)).resolves.toBeUndefined()
    expect(await rowCount()).toBe(0)
  })
})


describe('getProductCardsByIds', () => {
  it('keeps the order the device asked for', async () => {
    const first = await getProductCardsByIds([teeId, hoodieId], 'en')
    expect(first.map((c) => c.slug)).toEqual(['tee', 'hoodie'])

    const reversed = await getProductCardsByIds([hoodieId, teeId], 'en')
    expect(reversed.map((c) => c.slug)).toEqual(['hoodie', 'tee'])
  })

  it('drops an id that is not a product', async () => {
    const cards = await getProductCardsByIds(
      ['00000000-0000-0000-0000-000000000000', teeId],
      'en',
    )
    expect(cards.map((c) => c.slug)).toEqual(['tee'])
  })

  it('drops a deactivated product', async () => {
    await db.update(products).set({ isActive: false }).where(eq(products.id, teeId))
    const cards = await getProductCardsByIds([teeId, hoodieId], 'en')
    expect(cards.map((c) => c.slug)).toEqual(['hoodie'])
  })

  it('ignores duplicates and honours the limit', async () => {
    const cards = await getProductCardsByIds([teeId, teeId, hoodieId], 'en', 1)
    expect(cards.map((c) => c.slug)).toEqual(['tee'])
  })

  it('returns nothing for an empty list', async () => {
    expect(await getProductCardsByIds([], 'en')).toEqual([])
  })

  it('prices through the same resolver, so a promotion shows', async () => {
    await db
      .update(products)
      .set({ salePriceCents: 4900 })
      .where(eq(products.id, hoodieId))

    const [card] = await getProductCardsByIds([hoodieId], 'en')
    expect(card.listCents).toBe(5900)
    expect(card.finalCents).toBe(4900)
    expect(card.discountPercent).toBeGreaterThan(0)
  })
})
