/* ============================================================================
 * Stock with its cost.
 *
 * Every change of stock that is not an online sale goes through
 * applyMovement(): purchases received, wholesale sales and returns, samples,
 * gifts, own use, damaged or expired goods, stock counts, supplier extras and
 * the opening stock. Each one is written to stock_movements with its cost.
 *
 * Cost is the WEIGHTED AVERAGE per variant, before VAT:
 *   stock coming in at a cost   avg = (onHand × avg + qty × cost) / (onHand + qty)
 *   stock going out             avg stays; the movement records qty × avg
 *   free goods from a supplier  come in at 0, which lowers the average
 * Online sales take stock through lib/inventory.ts as before; each order line
 * records the average cost at the moment of the sale (unitCostCents).
 * ========================================================================== */

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { inventory, productVariants, products, stockMovements, variantCosts } from '@/db/schema'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Runner = typeof db | Tx

export class StockError extends Error {}

/* ---------------------------------------------------------------- kinds -- */

export const MOVEMENT_KINDS = {
  PURCHASE: { label: 'Purchase received', sign: 1 },
  PURCHASE_UNDO: { label: 'Purchase receipt undone', sign: -1 },
  OPENING: { label: 'Opening stock', sign: 0 },
  WHOLESALE: { label: 'Sold to a retailer', sign: -1 },
  WHOLESALE_RETURN: { label: 'Returned by a retailer', sign: 1 },
  SAMPLE: { label: 'Sample', sign: -1 },
  GIFT: { label: 'Gift or sponsorship', sign: -1 },
  OWN_USE: { label: 'Own or staff use', sign: -1 },
  DAMAGED: { label: 'Damaged', sign: -1 },
  EXPIRED: { label: 'Expired', sign: -1 },
  SUPPLIER_EXTRA: { label: 'Free goods from a supplier', sign: 1 },
  COUNT: { label: 'Stock count correction', sign: 0 },
} as const
export type MovementKind = keyof typeof MOVEMENT_KINDS

/** The kinds staff record by hand on the Stock history page. */
export const MANUAL_KINDS = ['SAMPLE', 'GIFT', 'OWN_USE', 'DAMAGED', 'EXPIRED', 'SUPPLIER_EXTRA', 'COUNT'] as const
export type ManualKind = (typeof MANUAL_KINDS)[number]

/** Stock that left without being sold: counted at cost in the reports. */
export const OUT_WITHOUT_SALE: MovementKind[] = ['SAMPLE', 'GIFT', 'OWN_USE', 'DAMAGED', 'EXPIRED']

/* --------------------------------------------------------------- costs -- */

export async function costsOf(variantIds: string[], runner: Runner = db): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map()
  const rows = await runner
    .select({ id: variantCosts.variantId, avg: variantCosts.avgCostCents })
    .from(variantCosts)
    .where(inArray(variantCosts.variantId, [...new Set(variantIds)]))
  return new Map(rows.map((r) => [r.id, r.avg]))
}

/** The pure arithmetic, kept apart so it can be tested on its own. */
export function nextAverage(onHand: number, avg: number, qty: number, unitCost: number, mode: 'in' | 'undo-in'): number {
  const have = Math.max(0, onHand)
  if (mode === 'in') {
    if (qty <= 0) return avg
    if (have === 0) return unitCost
    return (have * avg + qty * unitCost) / (have + qty)
  }
  /* Taking back a receipt exactly: remove its value from the pool. */
  const left = have - qty
  if (left <= 0) return avg
  return Math.max(0, (have * avg - qty * unitCost) / left)
}

/* ------------------------------------------------------------ movement -- */

export type MovementInput = {
  variantId: string
  /** Signed change of the physical stock. */
  delta: number
  kind: MovementKind
  /** For stock coming in: what one unit cost. Out: ignored (the average). */
  unitCostCents?: number
  /** Opening stock: set the average to this, whatever it was. */
  setAverageTo?: number
  /** Undoing a receipt: the landed cost it came in at. */
  undoOfCost?: number
  refType?: 'purchase' | 'wholesale' | null
  refId?: string | null
  note?: string | null
  occurredAt?: Date
  by?: string | null
}

async function lockRow(tx: Tx, variantId: string) {
  const [row] = await tx
    .select({ onHand: inventory.onHand, reserved: inventory.reserved })
    .from(inventory)
    .where(eq(inventory.variantId, variantId))
    .for('update')
  if (row) return row
  const [v] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, variantId))
  if (!v) throw new StockError('That product no longer exists.')
  await tx.insert(inventory).values({ variantId, onHand: 0, reserved: 0 }).onConflictDoNothing()
  const [again] = await tx
    .select({ onHand: inventory.onHand, reserved: inventory.reserved })
    .from(inventory)
    .where(eq(inventory.variantId, variantId))
    .for('update')
  return again
}

/**
 * Change one variant's stock and cost, inside the caller's transaction.
 * Refuses to take stock that carts are holding or that is not there.
 */
export async function applyMovement(tx: Tx, m: MovementInput) {
  if (!Number.isInteger(m.delta)) throw new StockError('Quantities are whole numbers.')
  const row = await lockRow(tx, m.variantId)
  const [c] = await tx.select({ avg: variantCosts.avgCostCents }).from(variantCosts).where(eq(variantCosts.variantId, m.variantId)).for('update')
  const avg = c?.avg ?? 0
  const after = row.onHand + m.delta
  if (m.delta < 0 && after < row.reserved) {
    const free = Math.max(0, row.onHand - row.reserved)
    throw new StockError(
      row.reserved > 0
        ? `Only ${free} in stock that is not held in customers' bags.`
        : `Only ${row.onHand} in stock.`,
    )
  }

  let newAvg = avg
  let unitCost = avg
  if (m.setAverageTo !== undefined) {
    newAvg = Math.max(0, m.setAverageTo)
    unitCost = newAvg
  } else if (m.undoOfCost !== undefined) {
    newAvg = nextAverage(row.onHand, avg, -m.delta, m.undoOfCost, 'undo-in')
    unitCost = m.undoOfCost
  } else if (m.delta > 0 && m.unitCostCents !== undefined) {
    newAvg = nextAverage(row.onHand, avg, m.delta, m.unitCostCents, 'in')
    unitCost = m.unitCostCents
  }

  if (m.delta !== 0) {
    await tx.update(inventory).set({ onHand: after, updatedAt: new Date() }).where(eq(inventory.variantId, m.variantId))
  }
  if (newAvg !== avg || !c) {
    await tx
      .insert(variantCosts)
      .values({ variantId: m.variantId, avgCostCents: newAvg })
      .onConflictDoUpdate({ target: variantCosts.variantId, set: { avgCostCents: newAvg, updatedAt: new Date() } })
  }
  if (m.delta !== 0 || m.setAverageTo !== undefined) {
    await tx.insert(stockMovements).values({
      variantId: m.variantId,
      kind: m.kind,
      quantity: m.delta,
      unitCostCents: unitCost,
      refType: m.refType ?? null,
      refId: m.refId ?? null,
      note: m.note?.slice(0, 1000) ?? null,
      occurredAt: m.occurredAt ?? new Date(),
      createdBy: m.by ?? null,
    })
  }
  return {
    variantId: m.variantId,
    wasAvailable: row.onHand - row.reserved,
    available: after - row.reserved,
  }
}

/** After a transaction that added stock: tell anyone waiting for it. */
export async function announceRestocks(results: { variantId: string; wasAvailable: number; available: number }[]) {
  for (const r of results) {
    if (r.wasAvailable <= 0 && r.available > 0) {
      try {
        const { stockReplenished } = await import('@/lib/automations')
        await stockReplenished(r.variantId)
      } catch (err) {
        console.error('[stock] back in stock scheduling failed', err)
      }
    }
  }
}

/* ------------------------------------------------- by hand (staff page) -- */

export async function recordManualMovement(input: {
  variantId: string
  kind: ManualKind
  /** Units out or in; for COUNT the number actually counted. */
  quantity: number
  note?: string | null
  occurredAt?: Date
  by: string
}) {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new StockError('Enter a whole number of zero or more.')
  if (input.kind !== 'COUNT' && input.quantity === 0) throw new StockError('Enter how many.')
  const results = await db.transaction(async (tx) => {
    let delta: number
    if (input.kind === 'COUNT') {
      const [row] = await tx.select({ onHand: inventory.onHand }).from(inventory).where(eq(inventory.variantId, input.variantId))
      delta = input.quantity - (row?.onHand ?? 0)
      if (delta === 0) throw new StockError('The count matches the system already.')
    } else {
      delta = MOVEMENT_KINDS[input.kind].sign * input.quantity
    }
    const r = await applyMovement(tx, {
      variantId: input.variantId,
      delta,
      kind: input.kind,
      unitCostCents: input.kind === 'SUPPLIER_EXTRA' ? 0 : undefined,
      note: input.note,
      occurredAt: input.occurredAt,
      by: input.by,
    })
    return [r]
  })
  await announceRestocks(results)
  return results[0]
}

/* ------------------------------------------------------------- reading -- */

export type MovementRow = {
  id: string
  kind: string
  quantity: number
  unitCostCents: number
  note: string | null
  occurredAt: Date
  refType: string | null
  refId: string | null
  variantId: string
  sku: string
  size: string
  productName: Record<string, string>
  photoCount: number
}

export async function listMovements(f: { from?: Date; to?: Date; kind?: string; variantId?: string; page?: number }) {
  const page = Math.max(1, f.page ?? 1)
  const conds = []
  if (f.from) conds.push(gte(stockMovements.occurredAt, f.from))
  if (f.to) conds.push(lt(stockMovements.occurredAt, f.to))
  if (f.kind) conds.push(eq(stockMovements.kind, f.kind))
  if (f.variantId) conds.push(eq(stockMovements.variantId, f.variantId))
  const where = conds.length ? and(...conds) : undefined
  const PER = 15
  const [rows, [{ n }]] = await Promise.all([
    db
      .select({
        id: stockMovements.id,
        kind: stockMovements.kind,
        quantity: stockMovements.quantity,
        unitCostCents: stockMovements.unitCostCents,
        note: stockMovements.note,
        occurredAt: stockMovements.occurredAt,
        refType: stockMovements.refType,
        refId: stockMovements.refId,
        variantId: stockMovements.variantId,
        sku: productVariants.sku,
        size: productVariants.size,
        productName: products.name,
        photoCount: sql<number>`(select count(*) from attachments a where a.owner_type = 'movement' and a.owner_id = ${stockMovements.id})`.mapWith(Number),
      })
      .from(stockMovements)
      .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where)
      .orderBy(desc(stockMovements.occurredAt), desc(stockMovements.createdAt))
      .limit(PER)
      .offset((page - 1) * PER),
    db.select({ n: sql<number>`count(*)::int` }).from(stockMovements).where(where),
  ])
  return { rows: rows as MovementRow[], total: n, page, pages: Math.max(1, Math.ceil(n / PER)) }
}

/** Every variant with its stock and cost, for pickers, the template and the value. */
export async function stockWithCosts() {
  return db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      sku: productVariants.sku,
      supplierCode: productVariants.supplierCode,
      size: productVariants.size,
      colorName: productVariants.colorName,
      productName: products.name,
      categoryId: products.categoryId,
      priceCents: sql<number>`coalesce(${productVariants.priceCentsOverride}, ${products.priceCents})`.mapWith(Number),
      onHand: sql<number>`coalesce(${inventory.onHand}, 0)`.mapWith(Number),
      reserved: sql<number>`coalesce(${inventory.reserved}, 0)`.mapWith(Number),
      avgCostCents: sql<number>`coalesce(${variantCosts.avgCostCents}, 0)`.mapWith(Number),
      isActive: products.isActive,
      variantActive: productVariants.isActive,
      availability: products.availability,
      categoryName: sql<string | null>`(select coalesce(top.name->>'en', c.name->>'en') from categories c left join categories top on top.id = c.parent_id where c.id = ${products.categoryId})`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventory, eq(inventory.variantId, productVariants.id))
    .leftJoin(variantCosts, eq(variantCosts.variantId, productVariants.id))
    .orderBy(sql`${products.name}->>'en'`, productVariants.position, productVariants.sku)
}

/** What the stock on the shelves cost: units × average cost. */
export async function stockValue(): Promise<{ valueCents: number; units: number; uncosted: number }> {
  const [r] = await db
    .select({
      value: sql<number>`coalesce(sum(greatest(${inventory.onHand}, 0) * coalesce(${variantCosts.avgCostCents}, 0)), 0)`.mapWith(Number),
      units: sql<number>`coalesce(sum(greatest(${inventory.onHand}, 0)), 0)`.mapWith(Number),
      uncosted: sql<number>`count(*) filter (where ${inventory.onHand} > 0 and coalesce(${variantCosts.avgCostCents}, 0) = 0)`.mapWith(Number),
    })
    .from(inventory)
    .leftJoin(variantCosts, eq(variantCosts.variantId, inventory.variantId))
  return { valueCents: Math.round(r.value), units: r.units, uncosted: r.uncosted }
}

/** Display name of a variant, for movement lists and documents. */
export function variantLabel(v: { productName: Record<string, string>; size?: string | null; colorName?: Record<string, string> | null }) {
  const name = v.productName.en ?? Object.values(v.productName)[0] ?? ''
  const flavour = v.colorName ? (v.colorName.en ?? Object.values(v.colorName)[0]) : ''
  return [name, flavour, v.size].filter(Boolean).join(', ')
}
