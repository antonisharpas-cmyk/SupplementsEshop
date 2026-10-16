/* Catalogue → Promotions: automatic discounts with a start and an end. */

import { guardAdmin } from '@/lib/admin'
import { listAdminPromotions, promotionCategoryOptions, promotionProductOptions } from '@/lib/admin-promotions'
import { PromotionManager } from '@/components/admin/PromotionManager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Promotions' }

export default async function PromotionsPage() {
  await guardAdmin('/admin/promotions')
  const [promotions, products, categories] = await Promise.all([
    listAdminPromotions(),
    promotionProductOptions(),
    promotionCategoryOptions(),
  ])
  return (
    <>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        Discounts on a product, a category or the whole shop. The price drops by itself while it runs. A sale price set on a product
        never adds to a promotion, the customer gets whichever is cheaper.
      </p>
      <PromotionManager
        promotions={promotions}
        products={products.map((p) => ({ id: p.id, label: p.name }))}
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
      />
    </>
  )
}
