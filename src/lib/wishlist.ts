/* A customer's saved products. One wishlist per customer, created the first
   time they save something. */

import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { products, wishlistItems, wishlists } from '@/db/schema'

async function wishlistId(userId: string, create: boolean): Promise<string | null> {
  const [row] = await db.select({ id: wishlists.id }).from(wishlists).where(eq(wishlists.userId, userId))
  if (row) return row.id
  if (!create) return null
  const [made] = await db.insert(wishlists).values({ userId }).onConflictDoNothing().returning({ id: wishlists.id })
  if (made) return made.id
  const [again] = await db.select({ id: wishlists.id }).from(wishlists).where(eq(wishlists.userId, userId))
  return again?.id ?? null
}

export async function wishlistProductIds(userId: string): Promise<string[]> {
  const id = await wishlistId(userId, false)
  if (!id) return []
  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.wishlistId, id))
    .orderBy(desc(wishlistItems.addedAt))
  return rows.map((r) => r.productId)
}

export async function isInWishlist(userId: string, productId: string): Promise<boolean> {
  const id = await wishlistId(userId, false)
  if (!id) return false
  const [row] = await db
    .select({ p: wishlistItems.productId })
    .from(wishlistItems)
    .where(and(eq(wishlistItems.wishlistId, id), eq(wishlistItems.productId, productId)))
  return Boolean(row)
}

export async function setInWishlist(userId: string, productId: string, saved: boolean): Promise<boolean> {
  const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId))
  if (!exists) return false
  const id = await wishlistId(userId, true)
  if (!id) return false
  if (saved) {
    await db.insert(wishlistItems).values({ wishlistId: id, productId }).onConflictDoNothing()
  } else {
    await db.delete(wishlistItems).where(and(eq(wishlistItems.wishlistId, id), eq(wishlistItems.productId, productId)))
  }
  return saved
}
