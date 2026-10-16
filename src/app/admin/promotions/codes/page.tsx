/* Promotions & codes → Promo codes. */

import { guardAdmin } from '@/lib/admin'
import { listAdminPromoCodes } from '@/lib/admin-promo-codes'
import { promotionCategoryOptions } from '@/lib/admin-promotions'
import { PromoCodeManager } from '@/components/admin/PromoCodeManager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Promo codes' }

export default async function PromoCodesPage() {
  await guardAdmin('/admin/promotions/codes')
  const [codes, categories] = await Promise.all([listAdminPromoCodes(), promotionCategoryOptions()])
  return (
    <>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        A code the customer types in the bag or at checkout, for example WELCOME10. It comes off the bag after any automatic
        promotion. A code that has been used is kept for the records, turn it off to stop it.
      </p>
      <PromoCodeManager codes={codes} categories={categories.map((c) => ({ id: c.id, label: c.label }))} />
    </>
  )
}
