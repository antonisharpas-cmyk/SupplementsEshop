/* One expense: change it, keep its receipt. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardFinance } from '@/lib/admin'
import { getExpense, listCategories } from '@/lib/expenses'
import { attachmentsOf } from '@/lib/finance'
import { getSettings } from '@/lib/settings'
import { UUID } from '@/lib/api'
import { btn } from '@/components/admin/ui'
import { ExpenseForm } from '@/components/admin/finance/ExpenseForm'
import { FileBox } from '@/components/admin/finance/FileBox'
import { DeleteExpense } from '@/components/admin/finance/DeleteExpense'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Expense' }

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await guardFinance(`/admin/expenses/${id}`)
  if (!UUID.test(id)) notFound()
  const e = await getExpense(id)
  if (!e) notFound()
  const [categories, files, { vat_rate_bp }] = await Promise.all([listCategories({ all: true }), attachmentsOf('expense', [id]), getSettings(['vat_rate_bp'])])
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <Link href={`/admin/expenses?month=${e.expenseDate.slice(0, 7)}`} className={btn.quiet}>
          ← Expenses
        </Link>
        <DeleteExpense id={id} month={e.expenseDate.slice(0, 7)} />
      </div>
      <section className="mb-6 rounded-2xl border border-line bg-paper p-5">
        <ExpenseForm categories={categories} vatRateBp={vat_rate_bp} initial={e} />
      </section>
      <FileBox type="expense" id={id} files={files} label="Receipt" />
    </>
  )
}
