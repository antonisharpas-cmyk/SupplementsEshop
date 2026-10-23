/* Admin → Wholesale: selling to shops and gyms. */

import { guardFinance } from '@/lib/admin'
import { SectionTabs, WHOLESALE_TABS } from '@/components/admin/SectionTabs'

export default async function WholesaleLayout({ children }: { children: React.ReactNode }) {
  await guardFinance('/admin/wholesale')
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Wholesale</h1>
        <p className="mt-1 text-sm text-muted">Sales to retailers with their invoices, what is still to be paid, and their prices.</p>
      </div>
      <SectionTabs label="Wholesale" tabs={WHOLESALE_TABS} />
      {children}
    </>
  )
}
