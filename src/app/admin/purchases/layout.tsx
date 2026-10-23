/* Admin → Purchases: what the shop buys, from whom, and what it really cost. */

import { canSeeFinance, guardAdmin } from '@/lib/admin'
import { PURCHASE_TABS, SectionTabs } from '@/components/admin/SectionTabs'

export default async function PurchasesLayout({ children }: { children: React.ReactNode }) {
  const user = await guardAdmin('/admin/purchases')
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Purchases &amp; suppliers</h1>
        <p className="mt-1 text-sm text-muted">Supplier invoices, the goods they brought in, and the true cost of every unit.</p>
      </div>
      {canSeeFinance(user) && <SectionTabs label="Purchases" tabs={PURCHASE_TABS} />}
      {children}
    </>
  )
}
