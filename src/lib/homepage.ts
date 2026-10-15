/* ============================================================================
 * Homepage layout — what sits under the hero, in what order.
 *
 * Four product sections — Shop by category, Moving fast, New in ("Just
 * dropped" on the page), On sale — plus the "Be first to know" newsletter
 * sign-up, which has no items, only a place and an on/off switch. For each,
 * the shop owner decides in the admin panel:
 *
 *   · where it goes (drag the sections into order)
 *   · whether it shows at all
 *   · AUTO  — the shop fills it: newest, most viewed, currently reduced
 *     MANUAL — exactly the items the owner picked, in the order they dragged
 *
 * Nothing needs setting up: with no rows saved, every section is AUTO, visible
 * and in the original order, which is precisely how the homepage looked
 * before this existed.
 * ========================================================================== */

import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  categories,
  homepageSectionItems,
  homepageSections,
  products,
} from '@/db/schema'

/** Sections that hold items (products or categories). */
export type SectionKey = 'categories' | 'trending' | 'new_in' | 'on_sale'
/** Everything that has a place in the order, items or not. */
export type LayoutKey = SectionKey | 'newsletter'
export type SectionMode = 'auto' | 'manual'

export const SECTION_KEYS: SectionKey[] = ['categories', 'trending', 'new_in', 'on_sale']
/* The sign-up sits straight after the new arrivals by default: "just dropped"
   followed by "be first to know next time". */
export const LAYOUT_KEYS: LayoutKey[] = ['categories', 'trending', 'new_in', 'newsletter', 'on_sale']
export const hasItems = (key: LayoutKey): key is SectionKey => key !== 'newsletter'

/** How many items a hand-picked section may hold. Enough to fill several rows,
 *  few enough that the homepage stays a homepage. */
export const SECTION_LIMITS: Record<SectionKey, number> = {
  categories: 16,
  trending: 24,
  new_in: 12,
  on_sale: 12,
}

/** What AUTO shows, so the admin can say it in words and the storefront does it. */
export const AUTO_TILES_PER_DEPARTMENT = 4

export const AUTO_COUNTS: Record<SectionKey, number> = {
  categories: 8, // four per department, two departments
  trending: 12,
  new_in: 8,
  on_sale: 4,
}

export type SectionConfig = {
  key: LayoutKey
  position: number
  isVisible: boolean
  mode: SectionMode
}

const DEFAULTS: SectionConfig[] = LAYOUT_KEYS.map((key, position) => ({
  key,
  position,
  isVisible: true,
  mode: 'auto',
}))

/** Every section, in display order, saved choices over defaults.
 *
 *  A shop that arranged its homepage before the sign-up section existed has
 *  no saved row for it: it goes in straight after New in, wherever the owner
 *  put that, rather than jumping to a position of its own. */
export async function getHomepageLayout(): Promise<SectionConfig[]> {
  const rows = await db.select().from(homepageSections)
  const saved = new Map(rows.map((r) => [r.key, r]))
  const withSaved = DEFAULTS.filter((d) => saved.has(d.key) || d.key !== 'newsletter').map((d) => {
    const r = saved.get(d.key)
    return r ? { key: d.key, position: r.position, isVisible: r.isVisible, mode: r.mode } : d
  })
  withSaved.sort((a, b) => a.position - b.position)
  if (!saved.has('newsletter')) {
    const after = withSaved.findIndex((s) => s.key === 'new_in')
    withSaved.splice(after + 1, 0, { key: 'newsletter', position: 0, isVisible: true, mode: 'auto' })
  }
  return withSaved.map((s, position) => ({ ...s, position }))
}

/** The hand-picked ids for a section, in order. Products for the product
 *  sections, categories for "Shop by category". */
export async function getSectionItemIds(key: SectionKey): Promise<string[]> {
  const rows = await db
    .select({ productId: homepageSectionItems.productId, categoryId: homepageSectionItems.categoryId })
    .from(homepageSectionItems)
    .where(eq(homepageSectionItems.sectionKey, key))
    .orderBy(asc(homepageSectionItems.position))
  return rows.map((r) => (key === 'categories' ? r.categoryId : r.productId)).filter(Boolean) as string[]
}

export async function getAllSectionItemIds(): Promise<Record<SectionKey, string[]>> {
  const entries = await Promise.all(SECTION_KEYS.map(async (k) => [k, await getSectionItemIds(k)] as const))
  return Object.fromEntries(entries) as Record<SectionKey, string[]>
}

/* ------------------------------------------------------------------ saving -- */

export class HomepageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HomepageError'
  }
}

/** Save the order, visibility and mode of every section at once.
 *  A list without the sign-up section (sent by anything written before it
 *  existed) keeps the sign-up where it currently is. */
export async function saveLayout(
  sections: { key: LayoutKey; isVisible: boolean; mode: SectionMode }[],
): Promise<void> {
  const keys = sections.map((s) => s.key)
  if (new Set(keys).size !== keys.length) throw new HomepageError('A section is listed twice.')
  const missing = LAYOUT_KEYS.filter((k) => !keys.includes(k))
  if (missing.length > 1 || (missing.length === 1 && missing[0] !== 'newsletter')) {
    throw new HomepageError('Send every section exactly once, in the order they should appear.')
  }
  let full = sections
  if (missing.length === 1) {
    const current = await getHomepageLayout()
    const index = current.findIndex((s) => s.key === 'newsletter')
    const kept = current[index]
    full = [...sections]
    full.splice(Math.min(index, full.length), 0, { key: 'newsletter', isVisible: kept.isVisible, mode: 'auto' })
  }

  await db.transaction(async (tx) => {
    for (const [position, s] of full.entries()) {
      /* The sign-up has nothing to hand-pick; it is always "automatic". */
      const mode = hasItems(s.key) ? s.mode : 'auto'
      await tx
        .insert(homepageSections)
        .values({ key: s.key, position, isVisible: s.isVisible, mode })
        .onConflictDoUpdate({
          target: homepageSections.key,
          set: { position, isVisible: s.isVisible, mode, updatedAt: new Date() },
        })
    }
  })
}

/**
 * Replace a section's hand-picked items with `ids`, in that order.
 *
 * Checked here rather than trusted from the browser: every id must be a real
 * product (or, for the category section, a real subcategory — a tile needs a
 * parent to link to), with no repeats and no more than the section holds.
 */
export async function saveSectionItems(key: SectionKey, ids: string[]): Promise<void> {
  if (new Set(ids).size !== ids.length) throw new HomepageError('An item is listed twice.')
  if (ids.length > SECTION_LIMITS[key]) {
    throw new HomepageError(`This section holds up to ${SECTION_LIMITS[key]} items.`)
  }

  if (ids.length) {
    const found =
      key === 'categories'
        ? await db
            .select({ id: categories.id })
            .from(categories)
            .where(and(inArray(categories.id, ids), isNotNull(categories.parentId)))
        : await db.select({ id: products.id }).from(products).where(inArray(products.id, ids))
    if (found.length !== ids.length) {
      throw new HomepageError(
        key === 'categories'
          ? 'One of those categories no longer exists.'
          : 'One of those products no longer exists.',
      )
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(homepageSectionItems).where(eq(homepageSectionItems.sectionKey, key))
    if (ids.length) {
      await tx.insert(homepageSectionItems).values(
        ids.map((id, position) => ({
          sectionKey: key,
          position,
          productId: key === 'categories' ? null : id,
          categoryId: key === 'categories' ? id : null,
        })),
      )
    }
  })
}
