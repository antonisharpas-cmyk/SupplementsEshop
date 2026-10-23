/* ============================================================================
 * ADMIN: creating and editing the catalogue.
 *
 * Details (names and copy in three languages), photos, and variants (one per
 * flavour and pack size, each with its own stock and optional price). The
 * pricing and status of a product live in the existing PATCH route.
 *
 * Rules worth knowing:
 *  · A product that has been ordered is never deleted, only hidden: the order
 *    history keeps pointing at it.
 *  · A variant with units in customers' bags cannot be removed until those
 *    holds lapse, for the same reason stock cannot be set below them.
 *  · Two variants of one product cannot share flavour and size.
 * ========================================================================== */

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  categories,
  inventory,
  inventoryReservations,
  media,
  orderItems,
  productImages,
  productVariants,
  products,
} from '@/db/schema'
import { AdminError } from '@/lib/admin'
import { isUniqueViolation } from '@/lib/db-errors'

export type L10n = { en: string; el?: string; ru?: string }

const clean = (t: L10n | undefined | null): Record<string, string> | null => {
  if (!t) return null
  const out: Record<string, string> = {}
  for (const k of ['en', 'el', 'ru'] as const) {
    const v = t[k]?.trim()
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150)
}

async function uniqueSlug(base: string, exceptId?: string): Promise<string> {
  const root = slugify(base) || 'product'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    const [clash] = await db
      .select({ id: products.id })
      .from(products)
      .where(exceptId ? and(eq(products.slug, candidate), ne(products.id, exceptId)) : eq(products.slug, candidate))
      .limit(1)
    if (!clash) return candidate
  }
  return `${root}-${Date.now().toString(36)}`
}

/* ------------------------------------------------------------ products -- */

export type ProductDetailsInput = {
  name: L10n
  summary?: L10n
  description?: L10n
  usage?: L10n
  seoTitle?: L10n
  seoDescription?: L10n
  categoryId: string
  slug?: string
}

async function assertSubcategory(categoryId: string) {
  const [cat] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1)
  if (!cat) throw new AdminError('Choose a category.')
  if (!cat.parentId) throw new AdminError('Choose a category inside a range, e.g. Sports Nutrition › Protein, not the range itself.')
}

export async function createProduct(
  input: ProductDetailsInput & { priceCents: number; firstSize?: string; firstFlavour?: string; firstStock?: number },
) {
  await assertSubcategory(input.categoryId)
  const slug = await uniqueSlug(input.slug || input.name.en)
  const [row] = await db
    .insert(products)
    .values({
      categoryId: input.categoryId,
      slug,
      name: clean(input.name)!,
      summary: clean(input.summary),
      description: clean(input.description),
      sizeGuide: clean(input.usage),
      seoTitle: clean(input.seoTitle),
      seoDescription: clean(input.seoDescription),
      priceCents: input.priceCents,
      /* New products start hidden: the owner adds photos and stock first,
         then switches it to Available. */
      isActive: false,
      publishedAt: new Date(),
    })
    .returning({ id: products.id, slug: products.slug })
  /* Every product needs at least one size to have stock. Create it now, so
     the new product is in Stock from the start. */
  if (input.firstSize?.trim()) {
    await addVariant(row.id, {
      size: input.firstSize.trim(),
      flavour: { en: input.firstFlavour?.trim() || 'Unflavoured' },
      colorHex: '#9a9a9a',
      onHand: input.firstStock ?? 0,
    })
  }
  return row
}

export async function updateProductDetails(id: string, input: ProductDetailsInput) {
  await assertSubcategory(input.categoryId)
  const slug = input.slug ? await uniqueSlug(input.slug, id) : undefined
  const [row] = await db
    .update(products)
    .set({
      categoryId: input.categoryId,
      ...(slug ? { slug } : {}),
      name: clean(input.name)!,
      summary: clean(input.summary),
      description: clean(input.description),
      sizeGuide: clean(input.usage),
      seoTitle: clean(input.seoTitle),
      seoDescription: clean(input.seoDescription),
      updatedAt: new Date(),
    })
    .where(eq(products.id, id))
    .returning({ id: products.id, slug: products.slug })
  if (!row) throw new AdminError('That product no longer exists.')
  return row
}

/** Deletes a product that has never been ordered. One that has is refused,
 *  with the advice to hide it instead. */
export async function deleteProduct(id: string) {
  const [sold] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(orderItems)
    .where(eq(orderItems.productId, id))
  if ((sold?.n ?? 0) > 0) {
    throw new AdminError(
      'This product has been ordered, so it is kept for the order history. Set it to Hidden instead and it leaves the shop.',
    )
  }
  const variantIds = (
    await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.productId, id))
  ).map((v) => v.id)
  if (variantIds.length) {
    const [held] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(inventoryReservations)
      .where(and(inArray(inventoryReservations.variantId, variantIds), eq(inventoryReservations.status, 'ACTIVE')))
    if ((held?.n ?? 0) > 0) {
      throw new AdminError('Someone has this product in their bag right now. Hide it first, then delete it later.')
    }
  }
  const images = await db.select({ url: productImages.url }).from(productImages).where(eq(productImages.productId, id))
  await db.transaction(async (tx) => {
    await tx.delete(products).where(eq(products.id, id))
    const mediaIds = images.map((i) => mediaIdFromUrl(i.url)).filter((m): m is string => Boolean(m))
    if (mediaIds.length) await tx.delete(media).where(inArray(media.id, mediaIds))
  })
}

/* -------------------------------------------------------------- photos -- */

export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']

export function mediaIdFromUrl(url: string): string | null {
  const m = /^\/api\/media\/([0-9a-f-]{36})$/i.exec(url)
  return m ? m[1] : null
}

/** Store an uploaded file and add it as the product's last photo. */
export async function addProductPhoto(
  productId: string,
  file: { bytes: Buffer; contentType: string; filename?: string | null },
  alt?: L10n,
) {
  if (!ALLOWED_IMAGE_TYPES.includes(file.contentType)) {
    throw new AdminError('Upload a JPG, PNG, WebP, AVIF or GIF photo.')
  }
  if (file.bytes.length === 0) throw new AdminError('That file is empty.')
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new AdminError('That photo is over 6 MB. Save it smaller and try again.')
  if (!sniffImage(file.bytes)) throw new AdminError('That file is not a picture the shop can show.')

  const [exists] = await db.select({ id: products.id, name: products.name }).from(products).where(eq(products.id, productId))
  if (!exists) throw new AdminError('That product no longer exists.')

  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(media)
      .values({
        contentType: file.contentType,
        bytes: file.bytes,
        size: file.bytes.length,
        filename: file.filename?.slice(0, 200) ?? null,
      })
      .returning({ id: media.id })
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${productImages.position}) + 1, 0)`.mapWith(Number) })
      .from(productImages)
      .where(eq(productImages.productId, productId))
    const [image] = await tx
      .insert(productImages)
      .values({
        productId,
        url: `/api/media/${stored.id}`,
        alt: clean(alt) ?? exists.name,
        position: next,
      })
      .returning({ id: productImages.id, url: productImages.url, position: productImages.position })
    return image
  })
}

/** The first bytes of every format we accept, so a renamed .exe is refused. */
function sniffImage(b: Buffer): boolean {
  if (b.length < 12) return false
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // JPEG
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true // PNG
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return true
  if (b.subarray(0, 3).toString('ascii') === 'GIF') return true
  if (b.subarray(4, 8).toString('ascii') === 'ftyp') return true // AVIF / HEIF family
  return false
}

export async function removeProductPhoto(productId: string, imageId: string) {
  const [image] = await db
    .select({ id: productImages.id, url: productImages.url })
    .from(productImages)
    .where(and(eq(productImages.id, imageId), eq(productImages.productId, productId)))
  if (!image) throw new AdminError('That photo is already gone.')
  await db.transaction(async (tx) => {
    await tx.delete(productImages).where(eq(productImages.id, imageId))
    const mediaId = mediaIdFromUrl(image.url)
    if (mediaId) await tx.delete(media).where(eq(media.id, mediaId))
    /* Close the gap, so positions stay 0, 1, 2 … */
    const rest = await tx
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, productId))
      .orderBy(asc(productImages.position), asc(productImages.createdAt))
    for (const [position, r] of rest.entries()) {
      await tx.update(productImages).set({ position }).where(eq(productImages.id, r.id))
    }
  })
}

/* ------------------------------------------------------------ variants -- */

export type VariantInput = {
  size: string
  flavour: L10n
  colorHex: string
  sku?: string
  /** The supplier's code; '' clears it, undefined leaves it. */
  supplierCode?: string
  priceCents?: number | null
  salePriceCents?: number | null
  onHand?: number
  isActive?: boolean
}

export type AdminVariant = {
  id: string
  sku: string
  supplierCode: string | null
  size: string
  flavour: Record<string, string> | null
  colorHex: string | null
  priceCents: number | null
  salePriceCents: number | null
  isActive: boolean
  onHand: number
  reserved: number
}

export async function listAdminVariants(productId: string): Promise<AdminVariant[]> {
  const rows = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      supplierCode: productVariants.supplierCode,
      size: productVariants.size,
      flavour: productVariants.colorName,
      colorHex: productVariants.colorHex,
      priceCents: productVariants.priceCentsOverride,
      salePriceCents: productVariants.salePriceCentsOverride,
      isActive: productVariants.isActive,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
    })
    .from(productVariants)
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.position), asc(productVariants.createdAt))
  return rows.map((r) => ({ ...r, onHand: r.onHand ?? 0, reserved: r.reserved ?? 0 }))
}

function makeSku(slug: string, flavour: string, size: string) {
  return `AX-${slug.slice(0, 12).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${flavour
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 4)
    .toUpperCase()}-${size.replace(/[^A-Za-z0-9.]/g, '').toUpperCase()}`.slice(0, 60)
}

function checkPrices(v: { priceCents?: number | null; salePriceCents?: number | null }, productPrice: number) {
  const list = v.priceCents ?? productPrice
  if (v.salePriceCents != null && v.salePriceCents >= list) {
    throw new AdminError('A sale price has to be lower than the normal price.')
  }
}

function variantClash(err: unknown): never {
  if (isUniqueViolation(err, 'variants_product_size_color')) {
    throw new AdminError('This product already has that flavour in that size. Give the new flavour its own colour, or change the size.')
  }
  if (isUniqueViolation(err, 'variants_sku_unique')) {
    throw new AdminError('That SKU is already used by another variant. Leave it empty to have one made for you.')
  }
  throw err
}

export async function addVariant(productId: string, v: VariantInput) {
  const [product] = await db
    .select({ slug: products.slug, priceCents: products.priceCents })
    .from(products)
    .where(eq(products.id, productId))
  if (!product) throw new AdminError('That product no longer exists.')
  checkPrices(v, product.priceCents)
  const flavour = clean(v.flavour)
  if (!flavour?.en) throw new AdminError('Give the flavour a name in English.')

  /* Always made by the system, so every product follows one pattern. A
     generated SKU that happens to exist gets a short suffix. */
  let sku = makeSku(product.slug, flavour.en, v.size)
  const [taken] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku))
  if (taken) sku = `${sku.slice(0, 56)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`

  try {
    return await db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${productVariants.position}) + 1, 0)`.mapWith(Number) })
        .from(productVariants)
        .where(eq(productVariants.productId, productId))
      const [row] = await tx
        .insert(productVariants)
        .values({
          productId,
          sku,
          supplierCode: v.supplierCode?.trim() || null,
          size: v.size.trim(),
          colorName: flavour,
          colorHex: v.colorHex.toLowerCase(),
          priceCentsOverride: v.priceCents ?? null,
          salePriceCentsOverride: v.salePriceCents ?? null,
          position: next,
          isActive: v.isActive ?? true,
        })
        .returning({ id: productVariants.id })
      await tx.insert(inventory).values({ variantId: row.id, onHand: Math.max(0, v.onHand ?? 0), reserved: 0 })
      return row
    })
  } catch (err) {
    variantClash(err)
  }
}

export async function updateVariant(productId: string, variantId: string, v: Omit<VariantInput, 'onHand'>) {
  const [product] = await db.select({ priceCents: products.priceCents }).from(products).where(eq(products.id, productId))
  if (!product) throw new AdminError('That product no longer exists.')
  checkPrices(v, product.priceCents)
  const flavour = clean(v.flavour)
  if (!flavour?.en) throw new AdminError('Give the flavour a name in English.')
  try {
    const [row] = await db
      .update(productVariants)
      .set({
        size: v.size.trim(),
        colorName: flavour,
        colorHex: v.colorHex.toLowerCase(),
        /* The SKU never changes once made. */
        ...(v.supplierCode !== undefined ? { supplierCode: v.supplierCode.trim() || null } : {}),
        priceCentsOverride: v.priceCents ?? null,
        salePriceCentsOverride: v.salePriceCents ?? null,
        ...(v.isActive !== undefined ? { isActive: v.isActive } : {}),
      })
      .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)))
      .returning({ id: productVariants.id })
    if (!row) throw new AdminError('That variant no longer exists.')
    return row
  } catch (err) {
    if (err instanceof AdminError) throw err
    variantClash(err)
  }
}

export async function deleteVariant(productId: string, variantId: string) {
  const [held] = await db
    .select({ n: sql<number>`coalesce(sum(${inventoryReservations.quantity}), 0)`.mapWith(Number) })
    .from(inventoryReservations)
    .where(and(eq(inventoryReservations.variantId, variantId), eq(inventoryReservations.status, 'ACTIVE')))
  if ((held?.n ?? 0) > 0) {
    throw new AdminError(
      `${held.n} of this are in customers' bags right now. Switch it off instead; you can delete it once those holds lapse.`,
    )
  }
  const [row] = await db
    .delete(productVariants)
    .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId)))
    .returning({ id: productVariants.id })
  if (!row) throw new AdminError('That variant is already gone.')
}

/** The categories a product can be filed under: every section, grouped by
 *  its range. */
export async function categoryOptions() {
  const rows = await db
    .select({ id: categories.id, parentId: categories.parentId, name: categories.name, position: categories.position })
    .from(categories)
    .orderBy(asc(categories.position))
  const roots = rows.filter((r) => !r.parentId)
  return roots.map((root) => ({
    rangeId: root.id,
    range: root.name.en ?? '',
    options: rows
      .filter((r) => r.parentId === root.id)
      .flatMap((group) => [
        { id: group.id, label: group.name.en ?? '', group: true },
        /* Sections inside a group: "Men › Socks". */
        ...rows
          .filter((r) => r.parentId === group.id)
          .map((leaf) => ({ id: leaf.id, label: `${group.name.en ?? ''} › ${leaf.name.en ?? ''}` })),
      ]),
  }))
}
