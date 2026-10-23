/* A new sale to a retailer. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listRetailers, priceList } from '@/lib/wholesale'
import { stockWithCosts } from '@/lib/stock'
import { getSettings } from '@/lib/settings'
import { Empty } from '@/components/admin/ui'
import { SaleForm } from '@/components/admin/finance/SaleForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New wholesale sale' }

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ retailer?: string }> }) {
  await guardFinance('/admin/wholesale/new')
  const [retailers, stock, { vat_rate_bp }] = await Promise.all([listRetailers(), stockWithCosts(), getSettings(['vat_rate_bp'])])
  const active = retailers.filter((r) => r.retailer.isActive).map((r) => r.retailer)
  if (active.length === 0) {
    return (
      <Empty>
        Add a retailer first.{' '}
        <Link href="/admin/wholesale/retailers" className="underline">
          Retailers →
        </Link>
      </Empty>
    )
  }
  const { retailer } = await searchParams
  const preselect = active.some((r) => r.id === retailer) ? retailer : undefined
  const preselectPrices = preselect ? await priceList(preselect) : []
  return (
    <>
      <h2 className="mb-5 text-lg font-semibold">New sale</h2>
      <SaleForm
        retailers={active.map((r) => ({ id: r.id, name: r.name, paymentTermsDays: r.paymentTermsDays, vatTreatment: r.vatTreatment, defaultDiscountPercent: r.defaultDiscountPercent }))}
        stock={Object.fromEntries(stock.map((s) => [s.variantId, Math.max(0, s.onHand - s.reserved)]))}
        vatRateBp={vat_rate_bp}
        preselect={preselect}
        preselectPrices={preselectPrices}
      />
    </>
  )
}
