/* Admin → Promotions & codes: automatic discounts and checkout codes. */

import { PROMOTION_TABS, SectionTabs } from '@/components/admin/SectionTabs'

export default function PromotionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Promotions &amp; codes</h1>
        <p className="mt-1 text-sm text-muted">
          Automatic discounts that lower prices by themselves, and promo codes customers type at checkout.
        </p>
      </div>
      <SectionTabs label="Promotions & codes" tabs={PROMOTION_TABS} />
      {children}
    </>
  )
}
