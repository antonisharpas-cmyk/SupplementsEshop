/* ============================================================================
 * Admin: the category tree, edited by the shop owner.
 *
 *   Range      Clothing                 shown in the main menu
 *   Group      Clothing › Men           a page of its own, with its sections
 *   Section    Clothing › Men › Socks   the deepest level
 *
 * Products are filed under a group or a section, never straight under a
 * range. A category with products or categories inside cannot be deleted;
 * hide it instead.
 * ========================================================================== */

import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { categories, media, products } from '@/db/schema'
import { AdminError } from '@/lib/admin'
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, mediaIdFromUrl, sniffImage, slugify } from '@/lib/admin-products'
import { MAX_CATEGORY_DEPTH } from '@/lib/catalog'

export type L10n = { en: string; el?: string; ru?: string }

export type AdminCategory = {
  id: string
  parentId: string | null
  slug: string
  name: Record<string, string>
  isActive: boolean
  position: number
  depth: number
  /** The homepage tile picture, if any. */
  imageUrl: string | null
  products: number
  children: AdminCategory[]
}

/* Top level addresses already taken by pages of the shop. */
const RESERVED = new Set([
  'account', 'admin', 'api', 'cart', 'checkout', 'contact', 'forgot-password', 'new', 'newsletter', 'order',
  'privacy', 'products', 'register', 'sale', 'search', 'sign-in', 'sms-stop', 'en', 'el', 'ru',
])

const clean = (n: L10n) => {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(n)) if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 80)
  return out
}

export async function adminCategoryTree(): Promise<AdminCategory[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(categories).orderBy(asc(categories.position), asc(categories.slug)),
    db
      .select({ id: products.categoryId, n: sql<number>`count(*)::int` })
      .from(products)
      .groupBy(products.categoryId),
  ])
  const n = new Map(counts.map((c) => [c.id, c.n]))
  const build = (parentId: string | null, depth: number): AdminCategory[] =>
    depth > MAX_CATEGORY_DEPTH
      ? []
      : rows
          .filter((r) => r.parentId === parentId)
          .map((r) => ({
            id: r.id,
            parentId: r.parentId,
            slug: r.slug,
            name: r.name,
            isActive: r.isActive,
            position: r.position,
            depth,
            imageUrl: r.imageUrl,
            products: n.get(r.id) ?? 0,
            children: build(r.id, depth + 1),
          }))
  return build(null, 1)
}

async function depthOf(id: string): Promise<number> {
  let depth = 0
  let cur: string | null = id
  while (cur && depth < 10) {
    const [row] = await db.select({ parentId: categories.parentId }).from(categories).where(eq(categories.id, cur))
    if (!row) throw new AdminError('That category no longer exists.')
    depth++
    cur = row.parentId
  }
  return depth
}

async function uniqueSlug(name: string, parentId: string | null, exceptId?: string) {
  const base = slugify(name) || 'category'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    if (!parentId && RESERVED.has(candidate)) continue
    const [clash] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slug, candidate), parentId ? eq(categories.parentId, parentId) : isNull(categories.parentId)))
      .limit(1)
    if (!clash || clash.id === exceptId) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

export async function createCategory(input: { parentId: string | null; name: L10n }) {
  const name = clean(input.name)
  if (!name.en) throw new AdminError('Give the category a name in English.')
  if (input.parentId) {
    const depth = await depthOf(input.parentId)
    if (depth >= MAX_CATEGORY_DEPTH) {
      throw new AdminError('Categories go three levels deep at most, e.g. Clothing › Men › Socks.')
    }
  }
  const slug = await uniqueSlug(name.en, input.parentId)
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${categories.position}) + 1, 0)::int` })
    .from(categories)
    .where(input.parentId ? eq(categories.parentId, input.parentId) : isNull(categories.parentId))
  const [row] = await db
    .insert(categories)
    .values({ parentId: input.parentId, slug, name, position: next, isActive: true })
    .returning()
  return row
}

export async function updateCategory(id: string, patch: { name?: L10n; isActive?: boolean }) {
  const [current] = await db.select().from(categories).where(eq(categories.id, id))
  if (!current) throw new AdminError('That category no longer exists.')
  const set: Partial<typeof categories.$inferInsert> = { updatedAt: new Date() }
  if (patch.name) {
    const name = clean(patch.name)
    if (!name.en) throw new AdminError('Give the category a name in English.')
    set.name = name
  }
  if (patch.isActive !== undefined) set.isActive = patch.isActive
  const [row] = await db.update(categories).set(set).where(eq(categories.id, id)).returning()
  return row
}

/** Swap with the neighbour above or below, among siblings. */
export async function moveCategory(id: string, direction: 'up' | 'down') {
  const [current] = await db.select().from(categories).where(eq(categories.id, id))
  if (!current) throw new AdminError('That category no longer exists.')
  const siblings = await db
    .select({ id: categories.id, position: categories.position })
    .from(categories)
    .where(current.parentId ? eq(categories.parentId, current.parentId) : isNull(categories.parentId))
    .orderBy(asc(categories.position), asc(categories.slug))
  const i = siblings.findIndex((s) => s.id === id)
  const j = direction === 'up' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= siblings.length) return
  /* Renumber the whole row, so equal positions can never get stuck. */
  const order = siblings.map((s) => s.id)
  ;[order[i], order[j]] = [order[j], order[i]]
  await db.transaction(async (tx) => {
    for (const [pos, sid] of order.entries()) {
      await tx.update(categories).set({ position: pos, updatedAt: new Date() }).where(eq(categories.id, sid))
    }
  })
}

export async function deleteCategory(id: string) {
  const [[child], [product]] = await Promise.all([
    db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1),
    db.select({ id: products.id }).from(products).where(eq(products.categoryId, id)).limit(1),
  ])
  if (child) throw new AdminError('Move or delete the categories inside it first, or hide it instead.')
  if (product) throw new AdminError('Products are filed under it. Move them to another category first, or hide it instead.')
  const rows = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id })
  if (!rows.length) throw new AdminError('That category no longer exists.')
}

/* ------------------------------------------------------ tile pictures -- */

/** The picture on the category's homepage tile (and its page header). It
 *  replaces the drawn placeholder; the old uploaded picture is removed. */
export async function setCategoryPhoto(id: string, file: { bytes: Buffer; contentType: string; filename?: string | null }) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.contentType)) throw new AdminError('Upload a JPG, PNG, WebP, AVIF or GIF picture.')
  if (file.bytes.length === 0) throw new AdminError('That file is empty.')
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new AdminError('That picture is over 6 MB. Save it smaller and try again.')
  if (!sniffImage(file.bytes)) throw new AdminError('That file is not a picture the shop can show.')
  const [cat] = await db.select({ imageUrl: categories.imageUrl }).from(categories).where(eq(categories.id, id))
  if (!cat) throw new AdminError('That category no longer exists.')
  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(media)
      .values({ contentType: file.contentType, bytes: file.bytes, size: file.bytes.length, filename: file.filename?.slice(0, 200) ?? null })
      .returning({ id: media.id })
    const url = `/api/media/${stored.id}`
    await tx.update(categories).set({ imageUrl: url }).where(eq(categories.id, id))
    const old = cat.imageUrl ? mediaIdFromUrl(cat.imageUrl) : null
    if (old) await tx.delete(media).where(eq(media.id, old))
    return url
  })
}

/** Back to no picture: the tile shows just the name. */
export async function removeCategoryPhoto(id: string) {
  const [cat] = await db.select({ imageUrl: categories.imageUrl }).from(categories).where(eq(categories.id, id))
  if (!cat) throw new AdminError('That category no longer exists.')
  await db.transaction(async (tx) => {
    await tx.update(categories).set({ imageUrl: null }).where(eq(categories.id, id))
    const old = cat.imageUrl ? mediaIdFromUrl(cat.imageUrl) : null
    if (old) await tx.delete(media).where(eq(media.id, old))
  })
}
