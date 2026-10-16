/* Orders → New order: one taken on the phone or in the shop. */

import Link from 'next/link'
import { eq, and } from 'drizzle-orm'
import { guardAdmin } from '@/lib/admin'
import { db } from '@/db'
import { deliveryOptions } from '@/db/schema'
import { manualOrderCatalogue } from '@/lib/manual-orders'
import { PageHead } from '@/components/admin/ui'
import { ManualOrderForm } from '@/components/admin/ManualOrderForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New order' }

export default async function NewOrderPage() {
  await guardAdmin('/admin/orders/new')
  const [catalogue, [shipping]] = await Promise.all([
    manualOrderCatalogue(),
    db
      .select({ priceCents: deliveryOptions.priceCents })
      .from(deliveryOptions)
      .where(and(eq(deliveryOptions.kind, 'SHIPPING'), eq(deliveryOptions.isActive, true)))
      .limit(1),
  ])
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex gap-2 text-xs text-muted">
        <Link href="/admin/orders" className="hover:underline">
          Orders
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">New order</span>
      </nav>
      <PageHead title="New order" sub="For an order taken on the phone or in the shop. It starts as Being prepared." />
      <ManualOrderForm catalogue={catalogue} shippingCents={shipping?.priceCents ?? 0} />
    </>
  )
}
