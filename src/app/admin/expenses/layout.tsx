/* Admin → Expenses: money out that is not stock. */

import { guardFinance } from '@/lib/admin'
import { EXPENSE_TABS, SectionTabs } from '@/components/admin/SectionTabs'

export default async function ExpensesLayout({ children }: { children: React.ReactNode }) {
  await guardFinance('/admin/expenses')
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <p className="mt-1 text-sm text-muted">Rent, ads, delivery and payment fees, staff and services, with their receipts.</p>
      </div>
      <SectionTabs label="Expenses" tabs={EXPENSE_TABS} />
      {children}
    </>
  )
}
