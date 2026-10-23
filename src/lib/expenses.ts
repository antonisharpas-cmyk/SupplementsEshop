/* ============================================================================
 * Expenses: money out that is not stock. Rent, ads, delivery and payment
 * fees, salaries, the accountant, software.
 *
 * VAT per expense:
 *   DOMESTIC    VAT on the receipt, reclaimed (not part of the cost)
 *   EU_REVERSE  a service from another EU country with no VAT on the invoice
 *               (online ads, software): reverse charge, due and reclaimed
 *   NONE        no VAT, or VAT that cannot be reclaimed: the whole amount is cost
 *
 * Repeating expenses (rent) are written once a month by themselves, on their
 * day, from their start month; each month at most once.
 * ========================================================================== */

import { and, asc, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { expenseCategories, expenses, recurringExpenses } from '@/db/schema'
import { getSettings } from '@/lib/settings'
import { assertOpen, closedThrough, FinanceError, isVatTreatment, monthOf, todayCy, vatOn, type VatTreatment } from '@/lib/finance'

export type Expense = typeof expenses.$inferSelect
export type ExpenseCategory = typeof expenseCategories.$inferSelect

export const DEFAULT_CATEGORIES = ['Rent and utilities', 'Marketing', 'Delivery and fees', 'Staff and services', 'Other']

/** The categories, creating the starting five the first time. */
export async function listCategories(opts: { all?: boolean } = {}) {
  let rows = await db.select().from(expenseCategories).orderBy(asc(expenseCategories.position), asc(expenseCategories.name))
  if (rows.length === 0) {
    await db.insert(expenseCategories).values(DEFAULT_CATEGORIES.map((name, i) => ({ name, position: i })))
    rows = await db.select().from(expenseCategories).orderBy(asc(expenseCategories.position), asc(expenseCategories.name))
  }
  return opts.all ? rows : rows.filter((c) => c.isActive)
}

export async function saveCategory(name: string, id?: string, isActive = true) {
  const clean = name.trim().slice(0, 80)
  if (!clean) throw new FinanceError('Give the category a name.')
  if (id) {
    await db.update(expenseCategories).set({ name: clean, isActive }).where(eq(expenseCategories.id, id))
    return id
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(expenseCategories)
  const [c] = await db.insert(expenseCategories).values({ name: clean, position: n }).returning({ id: expenseCategories.id })
  return c.id
}

/** Net and VAT from what was typed: either the total paid, or net and VAT. */
export function expenseAmounts(input: { vatTreatment: VatTreatment; netCents: number; vatCents?: number | null; rateBp: number }) {
  const net = input.netCents
  if (input.vatTreatment === 'DOMESTIC') {
    const vat = input.vatCents ?? vatOn(net, input.rateBp)
    return { netCents: net, vatCents: vat, reverseVatCents: 0, totalCents: net + vat }
  }
  if (input.vatTreatment === 'EU_REVERSE') return { netCents: net, vatCents: 0, reverseVatCents: vatOn(net, input.rateBp), totalCents: net }
  return { netCents: net, vatCents: 0, reverseVatCents: 0, totalCents: net }
}

export type ExpenseInput = {
  expenseDate: string
  categoryId: string
  payee: string
  description?: string | null
  reference?: string | null
  vatTreatment: VatTreatment
  netCents: number
  vatCents?: number | null
  paymentMethod?: string | null
}

export async function saveExpense(input: ExpenseInput, by: string, id?: string) {
  if (!isVatTreatment(input.vatTreatment) || input.vatTreatment === 'IMPORT') throw new FinanceError('Choose how VAT works on this expense.')
  if (!input.payee.trim()) throw new FinanceError('Who was it paid to?')
  if (!Number.isInteger(input.netCents) || input.netCents < 0) throw new FinanceError('Enter the amount.')
  await assertOpen(input.expenseDate)
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const amounts = expenseAmounts({ ...input, rateBp: vat_rate_bp })
  const values = {
    expenseDate: input.expenseDate,
    categoryId: input.categoryId,
    payee: input.payee.trim().slice(0, 160),
    description: input.description?.trim().slice(0, 300) || null,
    reference: input.reference?.trim().slice(0, 80) || null,
    vatTreatment: input.vatTreatment,
    paymentMethod: input.paymentMethod || null,
    ...amounts,
  }
  if (id) {
    const [old] = await db.select().from(expenses).where(eq(expenses.id, id))
    if (!old) throw new FinanceError('That expense no longer exists.')
    await assertOpen(old.expenseDate)
    await db.update(expenses).set(values).where(eq(expenses.id, id))
    return id
  }
  const [e] = await db.insert(expenses).values({ ...values, createdBy: by }).returning({ id: expenses.id })
  return e.id
}

export async function deleteExpense(id: string) {
  const [e] = await db.select().from(expenses).where(eq(expenses.id, id))
  if (!e) return
  await assertOpen(e.expenseDate)
  /* Deleted, the repeating expense would simply write it again. */
  if (e.recurringId) throw new FinanceError('This was written by a repeating expense. To skip this month, set its amount to 0; to end it, change the repeating expense.')
  await db.delete(expenses).where(eq(expenses.id, id))
}

export async function listExpenses(f: { from?: string; to?: string; categoryId?: string; q?: string }) {
  const conds = []
  if (f.from) conds.push(gte(expenses.expenseDate, f.from))
  if (f.to) conds.push(lt(expenses.expenseDate, f.to))
  if (f.categoryId) conds.push(eq(expenses.categoryId, f.categoryId))
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`
    conds.push(or(ilike(expenses.payee, like), ilike(expenses.description, like), ilike(expenses.reference, like))!)
  }
  return db
    .select({
      expense: expenses,
      category: expenseCategories.name,
      files: sql<number>`(select count(*) from attachments a where a.owner_type = 'expense' and a.owner_id = ${expenses.id})`.mapWith(Number),
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
    .limit(1000)
}

export async function getExpense(id: string) {
  const [e] = await db.select().from(expenses).where(eq(expenses.id, id))
  return e ?? null
}

/* ----------------------------------------------------------- repeating -- */

export type RecurringInput = {
  categoryId: string
  payee: string
  description?: string | null
  vatTreatment: VatTreatment
  netCents: number
  vatCents?: number | null
  paymentMethod?: string | null
  dayOfMonth: number
  startMonth: string
  endMonth?: string | null
  isActive?: boolean
}

export async function saveRecurring(input: RecurringInput, id?: string) {
  if (!input.payee.trim()) throw new FinanceError('Who is it paid to?')
  if (input.dayOfMonth < 1 || input.dayOfMonth > 28) throw new FinanceError('Choose a day from 1 to 28.')
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const a = expenseAmounts({ ...input, rateBp: vat_rate_bp })
  const values = {
    categoryId: input.categoryId,
    payee: input.payee.trim().slice(0, 160),
    description: input.description?.trim().slice(0, 300) || null,
    vatTreatment: input.vatTreatment,
    netCents: a.netCents,
    vatCents: a.vatCents,
    paymentMethod: input.paymentMethod || null,
    dayOfMonth: input.dayOfMonth,
    startMonth: input.startMonth,
    endMonth: input.endMonth || null,
    isActive: input.isActive ?? true,
  }
  if (id) {
    await db.update(recurringExpenses).set(values).where(eq(recurringExpenses.id, id))
    return id
  }
  const [r] = await db.insert(recurringExpenses).values(values).returning({ id: recurringExpenses.id })
  return r.id
}

export async function listRecurring() {
  return db
    .select({ recurring: recurringExpenses, category: expenseCategories.name })
    .from(recurringExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
    .orderBy(asc(recurringExpenses.payee))
}

export async function deleteRecurring(id: string) {
  await db.delete(recurringExpenses).where(eq(recurringExpenses.id, id))
}

function monthsBetween(from: string, to: string) {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
    if (out.length > 120) break
  }
  return out
}

/** Write every repeating expense that is due and not written yet. */
export async function writeRecurring(now = new Date()) {
  const today = todayCy(now)
  const thisMonth = monthOf(today)
  const closed = await closedThrough()
  const list = await db.select().from(recurringExpenses).where(eq(recurringExpenses.isActive, true))
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  let written = 0
  for (const r of list) {
    const last = r.endMonth && r.endMonth < thisMonth ? r.endMonth : thisMonth
    for (const month of monthsBetween(r.startMonth, last)) {
      if (closed && month <= closed) continue
      const day = `${month}-${String(r.dayOfMonth).padStart(2, '0')}`
      if (day > today) continue
      const a = expenseAmounts({ vatTreatment: r.vatTreatment as VatTreatment, netCents: r.netCents, vatCents: r.vatCents, rateBp: vat_rate_bp })
      const res = await db
        .insert(expenses)
        .values({
          expenseDate: day,
          categoryId: r.categoryId,
          payee: r.payee,
          description: r.description,
          vatTreatment: r.vatTreatment,
          paymentMethod: r.paymentMethod,
          recurringId: r.id,
          recurringMonth: month,
          ...a,
        })
        .onConflictDoNothing()
        .returning({ id: expenses.id })
      written += res.length
    }
  }
  return written
}
