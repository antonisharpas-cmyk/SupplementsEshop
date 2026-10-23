/* Expense categories. */

import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { guardFinance } from '@/lib/admin'
import { listCategories } from '@/lib/expenses'
import { CategoryList } from '@/components/admin/finance/CategoryList'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Expense categories' }

export default async function CategoriesPage() {
  await guardFinance('/admin/expenses/categories')
  const cats = await listCategories({ all: true })
  const counts = (await db.execute(sql`select category_id, count(*)::int as n from expenses group by 1`)).rows as { category_id: string; n: number }[]
  const n = new Map(counts.map((c) => [c.category_id, Number(c.n)]))
  return <CategoryList categories={cats.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, count: n.get(c.id) ?? 0 }))} />
}
