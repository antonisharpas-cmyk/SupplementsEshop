/* ============================================================================
 * Many products at once, from a sheet.
 *
 *   One row per flavour and size:
 *     Product name, Flavour, Size, Category, Selling price, EAN
 *     (and optionally Name in Greek, Name in Russian)
 *
 *   Rows with the same product name become one product with several
 *   flavours and sizes. A product that already exists (same English name)
 *   gets the new flavours added. New products start Hidden, with stock 0:
 *   the stock comes in with the supplier's purchase, the photos with the
 *   photo upload (files named by EAN), then the owner switches them on.
 *
 *   The EAN is saved as the supplier code, so the supplier's invoice and
 *   the photos find the right flavour by its barcode.
 *
 * Also: turn a supplier invoice pasted as text into that sheet, filled in as
 * far as the invoice allows (name, size, flavour guessed from the line).
 * ========================================================================== */

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { categories, productImages, productVariants, products } from '@/db/schema'
import { addVariant, createProduct, type L10n } from '@/lib/admin-products'
import { parseNumber, pickColumns, type Rows } from '@/lib/sheet-read'
import { toXlsx, type Sheet } from '@/lib/spreadsheet'
import { AdminError } from '@/lib/admin'

export type ImportRow = {
  row: number
  name: string
  nameEl: string
  nameRu: string
  flavourEl: string
  flavourRu: string
  flavour: string
  size: string
  category: string
  categoryId: string | null
  priceCents: number | null
  ean: string
  /** What applying does with this row. */
  action: 'new product' | 'new flavour' | 'already there'
  productId: string | null
  /** Already there without an EAN: applying saves the EAN on it. */
  saveCode?: boolean
  /** The flavour this row is, when it is already there. */
  variantId?: string | null
  problem?: string
  note?: string
}

const key = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()
const code = (s: string) => s.replace(/\s+/g, '').replace(/\.0+$/, '').toLowerCase()

/* ----------------------------------------------------------- categories -- */

type CategoryChoice = { id: string; label: string; name: string }

/** Every category a product can go in, as "Range › Category". */
export async function categoryChoices(): Promise<CategoryChoice[]> {
  const rows = await db.select({ id: categories.id, parentId: categories.parentId, name: categories.name, position: categories.position }).from(categories)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return rows
    .filter((r) => r.parentId)
    .map((r) => {
      const parent = byId.get(r.parentId!)
      const name = r.name.en ?? ''
      return { id: r.id, name, label: parent ? `${parent.name.en ?? ''} › ${name}` : name, order: (parent?.position ?? 0) * 1000 + r.position }
    })
    .sort((a, b) => a.order - b.order)
    .map(({ id, name, label }) => ({ id, name, label }))
}

function findCategory(raw: string, choices: CategoryChoice[]): { id: string | null; problem?: string } {
  const want = key(raw.replace(/\s*(>|›|\/)\s*/g, ' › '))
  if (!want) return { id: null, problem: 'No category' }
  const full = choices.find((c) => key(c.label) === want)
  if (full) return { id: full.id }
  const plain = choices.filter((c) => key(c.name) === want)
  if (plain.length === 1) return { id: plain[0].id }
  if (plain.length > 1) return { id: null, problem: `"${raw}" is in more than one range. Write it as ${plain.map((c) => `"${c.label}"`).join(' or ')}.` }
  return { id: null, problem: `No category called "${raw}". See the Categories tab of the sheet.` }
}

/* --------------------------------------------------------- the template -- */

export const TEMPLATE_COLUMNS: Sheet['columns'] = [
  { header: 'Product name', width: 38 },
  { header: 'Flavour', width: 22 },
  { header: 'Size', width: 10 },
  { header: 'Category', width: 26 },
  { header: 'Selling price', kind: 'money', width: 13 },
  { header: 'EAN', width: 16 },
  { header: 'Name in Greek', width: 28 },
  { header: 'Name in Russian', width: 28 },
  { header: 'Supplier description', width: 40 },
  { header: 'Cost price', kind: 'money', width: 11 },
  { header: 'Quantity', kind: 'int', width: 10 },
  { header: 'Flavour in Greek', width: 22 },
  { header: 'Flavour in Russian', width: 22 },
]

async function categoriesSheet(): Promise<Sheet> {
  const choices = await categoryChoices()
  return {
    name: 'Categories',
    columns: [
      { header: 'Write in Category', width: 30 },
      { header: 'Range', width: 22 },
    ],
    rows: choices.map((c) => [c.name, c.label.split(' › ')[0]]),
  }
}

/** The empty sheet, with one example row and the list of categories. */
export async function templateFile(): Promise<Buffer> {
  return toXlsx([
    {
      name: 'Products',
      columns: TEMPLATE_COLUMNS,
      rows: [['Example: Whey Protein Complex 100%', 'Chocolate', '700 g', 'Protein', 39.9, '5901330000000', '', '', 'Delete this row', null, null, '', '']],
    },
    await categoriesSheet(),
  ])
}

/* ------------------------------------------------ supplier invoice text -- */

export type InvoiceLine = { description: string; ean: string; costCents: number | null; quantity: number; name: string; size: string; flavour: string }

const SIZE = /(\d+(?:[.,]\d+)?\s?(?:x\s?\d+(?:[.,]\d+)?\s?)?(?:kg|g|gr|ml|l|caps?|capsules|tabs?|tablets|softgels?|sachets?|servings|pcs|amp|vials?)\b)/i
const PACKAGING = /\b(bag|jar|box|can|pouch|tub|bottle|doypack|blister|tube|pack|carton|display)\b/gi
const FLAVOUR_AT_END =
  /\s((?:salted |white |double |milk |dark )?(?:vanilla|chocolate|strawberry|banana|natural|neutral|unflavou?red|lemon|orange|cherry|blueberry|raspberry|caramel|coconut|cookies? (?:and |& )?cream|peanut butter|tropical|mango|apple|grapefruit|pineapple|watermelon|cola|coffee|mocha|cappuccino|pistachio|hazelnut|blackcurrant|peach|lime|kiwi|fruit punch)(?: (?:flavou?r|cream|cookie))?)$/i
const UNIT = /^(pce|pcs|pc|szt|st|unit|units|ea)$/i

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim()
}

/** Guess product name, size and flavour from an invoice description such as
 *  "Protein Complex 700g cookies cream bag". The owner corrects the rest. */
export function splitDescription(description: string): { name: string; size: string; flavour: string } {
  const d = description.replace(/\s+/g, ' ').trim()
  const m = SIZE.exec(d)
  if (!m) return { name: d, size: '', flavour: '' }
  let name = d.slice(0, m.index).trim()
  const size = m[1].replace(/\s+/g, ' ').replace(/(\d)\s?(kg|g|gr|ml|l)\b/i, '$1 $2').replace(/\bgr\b/i, 'g')
  let flavour = titleCase(d.slice(m.index + m[0].length).replace(PACKAGING, ' '))
  /* "Whey Protein Complex 100% vanilla 1800 g": the flavour came first. */
  const before = !flavour ? FLAVOUR_AT_END.exec(name) : null
  if (before) {
    flavour = titleCase(before[1])
    name = name.slice(0, before.index).trim()
  }
  return { name: name || d, size, flavour }
}

/**
 * Read invoice lines pasted as text (from the supplier's PDF): every line
 * with a barcode becomes a row. Price is the first decimal after the
 * barcode, quantity the number before PCE (or the next whole number).
 * The same barcode twice is merged into one row.
 */
export function readInvoiceText(text: string): InvoiceLine[] {
  const flat = text.replace(/\r/g, '').replace(/\s+/g, ' ')
  const out = new Map<string, InvoiceLine>()
  const re = /(?<![\d.,])(\d{12,14})(?![\d.,])/g
  let from = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(flat))) {
    const ean = m[1]
    let description = flat.slice(from, m.index)
    /* What follows the barcode: price, VAT, quantity, unit, value. */
    const tail = flat.slice(m.index + ean.length).trim().split(' ').slice(0, 10)
    let used = 0
    let costCents: number | null = null
    let quantity = 0
    for (let i = 0; i < tail.length; i++) {
      const t = tail[i]
      if (/^\d{12,14}$/.test(t)) break
      if (UNIT.test(t)) {
        const q = parseNumber(tail[i - 1])
        if (Number.isFinite(q)) quantity = Math.round(q)
        used = i + 1
        /* A line value right after the unit belongs to this line. */
        if (tail[i + 1] && /^\d+([.,]\d+)?$/.test(tail[i + 1]) && /[.,]/.test(tail[i + 1])) {
          used++
          if (tail[i + 2] && /^(eur|€)$/i.test(tail[i + 2])) used++
        }
        break
      }
      if (costCents === null && /^\d+[.,]\d{1,4}$/.test(t)) costCents = Math.round(parseNumber(t) * 100)
      else if (costCents !== null && !quantity && /^\d+$/.test(t)) quantity = Number(t)
      used = i + 1
    }
    from = m.index + ean.length
    /* Skip what was read after the barcode. */
    const skipped = flat.slice(from).trim().split(' ').slice(0, used).join(' ')
    from = flat.indexOf(skipped, from) + skipped.length
    re.lastIndex = from

    /* The description: drop a header before the first line and the line number. */
    description = description
      .replace(/^.*\bnet value\b\s*/i, '')
      .replace(/^\s*\d{1,3}\s+/, '')
      .trim()
    if (!description) continue
    const prev = out.get(ean)
    if (prev) {
      prev.quantity += quantity
      continue
    }
    out.set(ean, { description, ean, costCents, quantity, ...splitDescription(description) })
  }
  return [...out.values()]
}

/** The products sheet, filled in from an invoice: Category and Selling
 *  price are left for the owner. The same file also works as the
 *  purchase's "Upload a file" (EAN, Quantity, Cost price). */
export async function invoiceSheet(lines: InvoiceLine[]): Promise<Buffer> {
  const existing = await variantsByCode()
  return toXlsx([
    {
      name: 'Products',
      columns: TEMPLATE_COLUMNS,
      rows: lines.map((l) => {
        const v = existing.get(code(l.ean))
        return [
          v ? v.productName : l.name,
          v ? v.flavour : l.flavour,
          v ? v.size : l.size,
          v ? v.category : '',
          v ? v.priceCents / 100 : null,
          l.ean,
          '',
          '',
          l.description,
          l.costCents === null ? null : l.costCents / 100,
          l.quantity,
          '',
          '',
        ]
      }),
    },
    await categoriesSheet(),
  ])
}

/* ------------------------------------------------------ check and apply -- */

async function variantsByCode() {
  const rows = await db
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      supplierCode: productVariants.supplierCode,
      sku: productVariants.sku,
      size: productVariants.size,
      colorName: productVariants.colorName,
      productName: products.name,
      priceCents: products.priceCents,
      override: productVariants.priceCentsOverride,
      categoryId: products.categoryId,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
  const cats = new Map((await db.select({ id: categories.id, name: categories.name }).from(categories)).map((c) => [c.id, c.name.en ?? '']))
  const map = new Map<string, { id: string; productId: string; productName: string; flavour: string; size: string; category: string; priceCents: number; supplierCode: string | null }>()
  for (const r of rows) {
    const v = {
      id: r.id,
      productId: r.productId,
      productName: r.productName.en ?? '',
      flavour: r.colorName?.en ?? '',
      size: r.size,
      category: cats.get(r.categoryId) ?? '',
      priceCents: r.override ?? r.priceCents,
      supplierCode: r.supplierCode,
    }
    if (r.supplierCode) map.set(code(r.supplierCode), v)
    if (!map.has(code(r.sku))) map.set(code(r.sku), v)
  }
  return map
}

/** Read the filled sheet and say what applying it would do, row by row. */
export async function checkImport(rows: Rows): Promise<ImportRow[]> {
  if (rows.length === 0) return []
  const { cols, hasHeader } = pickColumns(
    rows[0],
    {
      name: ['productname', 'product', 'name'],
      flavour: ['flavour', 'flavor', 'taste', 'γευσ', 'вкус'],
      size: ['size', 'weight', 'μεγεθ', 'размер'],
      category: ['category', 'κατηγορ', 'категор'],
      price: ['sellingprice', 'price', 'retail', 'τιμ', 'цена'],
      ean: ['ean', 'barcode', 'suppliercode', 'code'],
      el: ['nameingreek', 'greek'],
      ru: ['nameinrussian', 'russian'],
      fel: ['flavouringreek', 'flavoringreek'],
      fru: ['flavourinrussian', 'flavorinrussian'],
    },
    { name: 0, flavour: 1, size: 2, category: 3, price: 4, ean: 5, el: 6, ru: 7, fel: 11, fru: 12 },
  )
  const body = hasHeader ? rows.slice(1) : rows
  const [choices, byCode, all] = await Promise.all([
    categoryChoices(),
    variantsByCode(),
    db
      .select({ id: products.id, name: products.name, priceCents: products.priceCents })
      .from(products),
  ])
  const productByName = new Map(all.map((p) => [key(p.name.en ?? ''), p]))
  const variantsOf = new Map<string, { id: string; size: string; flavour: string }[]>()
  for (const v of byCode.values()) variantsOf.set(v.productId, [...(variantsOf.get(v.productId) ?? []), { id: v.id, size: key(v.size), flavour: key(v.flavour) }])

  const seenCodes = new Set<string>()
  const seenCombos = new Set<string>()
  const out: ImportRow[] = []
  body.forEach((r, i) => {
    const cell = (c: number) => (c >= 0 ? (r[c] ?? '').trim() : '')
    const name = cell(cols.name).replace(/\s+/g, ' ')
    if (!name && !cell(cols.ean)) return
    if (/^example:/i.test(name)) return
    const price = parseNumber(cell(cols.price))
    const cat = findCategory(cell(cols.category), choices)
    const row: ImportRow = {
      row: i + (hasHeader ? 2 : 1),
      name,
      nameEl: cell(cols.el),
      nameRu: cell(cols.ru),
      flavourEl: cell(cols.fel),
      flavourRu: cell(cols.fru),
      flavour: cell(cols.flavour).replace(/\s+/g, ' ') || 'Unflavoured',
      size: cell(cols.size).replace(/\s+/g, ' '),
      category: cell(cols.category),
      categoryId: cat.id,
      priceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
      ean: cell(cols.ean).replace(/\s+/g, '').replace(/\.0+$/, ''),
      action: 'new product',
      productId: null,
    }
    const existingVariant = row.ean ? byCode.get(code(row.ean)) : undefined
    const existingProduct = productByName.get(key(name))
    const combo = `${key(name)}|${key(row.size)}|${key(row.flavour)}`

    if (existingVariant) {
      row.action = 'already there'
      row.productId = existingVariant.productId
      row.variantId = existingVariant.id
      row.note = `${existingVariant.productName}, ${existingVariant.flavour}, ${existingVariant.size}`
    } else if (existingProduct && variantsOf.get(existingProduct.id)?.some((v) => v.size === key(row.size) && v.flavour === key(row.flavour))) {
      row.action = 'already there'
      row.variantId = variantsOf.get(existingProduct.id)!.find((v) => v.size === key(row.size) && v.flavour === key(row.flavour))!.id
      row.productId = existingProduct.id
      row.saveCode = Boolean(row.ean)
      row.note = row.ean ? 'This flavour and size exist; the EAN will be saved on it' : 'This flavour and size exist'
    } else if (existingProduct) {
      row.action = 'new flavour'
      row.productId = existingProduct.id
    }

    if (!name) row.problem = 'No product name'
    else if (!row.size) row.problem = 'No size'
    else if (row.ean && seenCodes.has(code(row.ean))) row.problem = 'This EAN is on an earlier row too'
    else if (seenCombos.has(combo)) row.problem = 'Same product, flavour and size as an earlier row'
    else if (row.action === 'new product' && !row.categoryId) row.problem = cat.problem
    else if (row.action !== 'already there' && row.priceCents === null) row.problem = 'No selling price'
    if (row.ean) seenCodes.add(code(row.ean))
    seenCombos.add(combo)
    out.push(row)
  })
  return out
}

/* Each flavour of a size needs its own colour (the shop's flavour dots):
   a colour close to the flavour, nudged when two would be the same. */
const FLAVOUR_COLOURS: [RegExp, string][] = [
  [/choc|cocoa|brownie|mocha/i, '#5a3a22'],
  [/vanil|cream|white|banana|coconut|milk/i, '#efe2bf'],
  [/strawber|raspber|cherry|berry|red/i, '#c8323c'],
  [/cookie|biscuit|caramel|toffee|peanut|hazel|nut|salted/i, '#a8743c'],
  [/lemon|lime|pineapple|mango|passion|yellow/i, '#e6c229'],
  [/orange|peach|apricot|grapefr/i, '#ec8a2c'],
  [/apple|green|mint|kiwi|matcha/i, '#6fae3c'],
  [/blue|blueberr|bilberr|ice/i, '#3c6fc8'],
  [/grape|blackcurr|cassis|purple|plum/i, '#6b3c8c'],
  [/cola|coffee|espresso/i, '#3a2a1e'],
  [/water ?melon|pink|bubble/i, '#e66a8a'],
  [/tropic|exotic|fruit|punch/i, '#e0663c'],
]

function colourFor(flavour: string, taken: Set<string>): string {
  const base = FLAVOUR_COLOURS.find(([re]) => re.test(flavour))?.[1] ?? '#9a9a9a'
  let hex = base
  for (let k = 1; taken.has(hex) && k < 200; k++) {
    const n = (parseInt(base.slice(1), 16) + k * 0x030303) & 0xffffff
    hex = `#${n.toString(16).padStart(6, '0')}`
  }
  taken.add(hex)
  return hex
}

/** Create what the check said, row by row: new products (hidden), new
 *  flavours, and the EAN saved on flavours that were already there. */
export async function applyImport(rows: ImportRow[]) {
  const good = rows.filter((r) => !r.problem)
  const created: string[] = []
  let flavours = 0
  let codes = 0
  const failed: { row: number; problem: string }[] = []

  /* New products: grouped by name; the product's price is its lowest. */
  const groups = new Map<string, ImportRow[]>()
  for (const r of good) {
    if (r.action === 'already there') continue
    const k = r.productId ?? `new:${key(r.name)}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }

  for (const list of groups.values()) {
    let productId = list[0].productId
    let productPrice: number
    try {
      if (!productId) {
        const first = list[0]
        const name: L10n = { en: first.name, el: list.find((r) => r.nameEl)?.nameEl, ru: list.find((r) => r.nameRu)?.nameRu }
        productPrice = Math.min(...list.map((r) => r.priceCents!))
        const p = await createProduct({ name, categoryId: first.categoryId!, priceCents: productPrice })
        productId = p.id
        created.push(first.name)
      } else {
        const [p] = await db.select({ priceCents: products.priceCents }).from(products).where(eq(products.id, productId))
        if (!p) throw new AdminError('That product no longer exists.')
        productPrice = p.priceCents
      }
    } catch (err) {
      for (const r of list) failed.push({ row: r.row, problem: err instanceof Error ? err.message : 'Could not create it' })
      continue
    }
    /* One colour per flavour across the whole product: two sizes of one
       flavour share it (the shop groups them as one flavour), two flavours
       never do. */
    const existing = await db
      .select({ colorName: productVariants.colorName, colorHex: productVariants.colorHex })
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
    const hexOf = new Map<string, string>()
    const used = new Set<string>()
    for (const v of existing) {
      if (v.colorHex) used.add(v.colorHex)
      if (v.colorName?.en && v.colorHex) hexOf.set(key(v.colorName.en), v.colorHex)
    }
    for (const r of list) {
      let hex = hexOf.get(key(r.flavour))
      if (!hex) {
        hex = colourFor(r.flavour, used)
        hexOf.set(key(r.flavour), hex)
      }
      try {
        await addVariant(productId, {
          size: r.size,
          flavour: { en: r.flavour, el: r.flavourEl || undefined, ru: r.flavourRu || undefined },
          colorHex: hex,
          supplierCode: r.ean,
          priceCents: r.priceCents !== productPrice ? r.priceCents : null,
          onHand: 0,
        })
        flavours++
      } catch (err) {
        failed.push({ row: r.row, problem: err instanceof Error ? err.message : 'Could not add it' })
      }
    }
  }

  /* Flavours that were there already: save the EAN when they have none. */
  for (const r of good) {
    if (!r.saveCode || !r.productId) continue
    const res = await db
      .update(productVariants)
      .set({ supplierCode: r.ean })
      .where(
        and(
          eq(productVariants.productId, r.productId),
          sql`lower(${productVariants.size}) = ${r.size.toLowerCase()}`,
          sql`lower(${productVariants.colorName}->>'en') = ${r.flavour.toLowerCase()}`,
          sql`coalesce(${productVariants.supplierCode}, '') = ''`,
        ),
      )
      .returning({ id: productVariants.id })
    codes += res.length
  }
  /* Products and flavours that were there already: fill in the Greek and
     Russian names from the sheet, so running the sheet again brings in
     translations added after the first import. English is never changed. */
  let translated = 0
  const doneProducts = new Set<string>()
  for (const r of good) {
    if (r.action !== 'already there' || !r.productId) continue
    const names = { ...(r.nameEl ? { el: r.nameEl } : {}), ...(r.nameRu ? { ru: r.nameRu } : {}) }
    if (Object.keys(names).length && !doneProducts.has(r.productId)) {
      doneProducts.add(r.productId)
      const res = await db
        .update(products)
        .set({ name: sql`${products.name} || ${JSON.stringify(names)}::jsonb` })
        .where(and(eq(products.id, r.productId), sql`not (${products.name} @> ${JSON.stringify(names)}::jsonb)`))
        .returning({ id: products.id })
      translated += res.length
    }
    const flav = { ...(r.flavourEl ? { el: r.flavourEl } : {}), ...(r.flavourRu ? { ru: r.flavourRu } : {}) }
    if (Object.keys(flav).length && r.variantId) {
      const res = await db
        .update(productVariants)
        .set({ colorName: sql`coalesce(${productVariants.colorName}, '{}'::jsonb) || ${JSON.stringify(flav)}::jsonb` })
        .where(and(eq(productVariants.id, r.variantId), sql`not (coalesce(${productVariants.colorName}, '{}'::jsonb) @> ${JSON.stringify(flav)}::jsonb)`))
        .returning({ id: productVariants.id })
      translated += res.length
    }
  }
  return { products: created.length, flavours, codes, translated, skipped: rows.length - good.length, failed }
}

/* ------------------------------------------------------ photos by code -- */

/** "5901330098765.jpg", "5901330098765_2.png", "5901330098765 (2).webp"
 *  all belong to the flavour with that EAN (or SKU). */
export function codeFromFilename(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[_\s-]+\d{1,2}$/, '')
    .trim()
}

export type PhotoMatch = { filename: string; code: string; productId: string | null; variantId: string | null; label: string | null; photos: number }

/** Which flavour each photo goes to, before anything is uploaded. */
export async function matchPhotos(filenames: string[]): Promise<PhotoMatch[]> {
  const byCode = await variantsByCode()
  const counts = new Map(
    (
      await db
        .select({ variantId: productImages.variantId, n: sql<number>`count(*)`.mapWith(Number) })
        .from(productImages)
        .where(isNotNull(productImages.variantId))
        .groupBy(productImages.variantId)
    ).map((r) => [r.variantId!, r.n]),
  )
  return filenames.map((filename) => {
    const c = codeFromFilename(filename)
    const v = byCode.get(code(c))
    return {
      filename,
      code: c,
      productId: v?.productId ?? null,
      variantId: v?.id ?? null,
      label: v ? `${v.productName}, ${v.flavour}, ${v.size}` : null,
      photos: v ? (counts.get(v.id) ?? 0) : 0,
    }
  })
}
