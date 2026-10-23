/* A new supplier invoice. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listSuppliers } from '@/lib/purchases'
import { stockWithCosts, variantLabel } from '@/lib/stock'
import { getSettings } from '@/lib/settings'
import { Empty, btn } from '@/components/admin/ui'
import { PurchaseForm } from '@/components/admin/finance/PurchaseForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New purchase' }

export default async function NewPurchasePage() {
  await guardFinance('/admin/purchases/new')
  const [suppliers, stock, { vat_rate_bp }] = await Promise.all([listSuppliers({ activeOnly: true }), stockWithCosts(), getSettings(['vat_rate_bp'])])
  if (suppliers.length === 0) {
    return (
      <Empty>
        Add a supplier first. <Link href="/admin/purchases/suppliers" className={`${btn.quiet} ml-1`}>Suppliers →</Link>
      </Empty>
    )
  }
  return (
    <>
      <h2 className="mb-5 text-lg font-semibold">New purchase</h2>
      <PurchaseForm
        suppliers={suppliers.map((s) => ({ id: s.supplier.id, name: s.supplier.name, vatTreatment: s.supplier.vatTreatment, country: s.supplier.country }))}
        variants={stock.map((v) => ({ variantId: v.variantId, label: variantLabel(v), sku: v.sku, supplierCode: v.supplierCode, avgCostCents: v.avgCostCents, onHand: v.onHand }))}
        vatRateBp={vat_rate_bp}
      />
    </>
  )
}
