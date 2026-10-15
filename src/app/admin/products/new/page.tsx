/* Admin: start a new product. Only what is needed to create it; everything
   else (photos, flavours, sizes, text) is on the product's own page. */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { categoryOptions } from '@/lib/admin-products'
import { NewProductForm } from '@/components/admin/ProductDetails'
import { PageHead } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'New product' }

export default async function NewProductPage() {
  await guardAdmin('/admin/products/new')
  const groups = await categoryOptions()
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex gap-2 text-xs text-muted">
        <Link href="/admin/products" className="hover:underline">
          Products
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">New</span>
      </nav>
      <PageHead title="New product" sub="Name, category and price. You add photos, flavours and stock on the next screen." />
      <NewProductForm groups={groups} />
    </>
  )
}
