/* Many products at once: a sheet for the products, then their photos named
   by barcode. */

import { guardAdmin } from '@/lib/admin'
import { PageHead } from '@/components/admin/ui'
import { CATALOGUE_TABS, SectionTabs } from '@/components/admin/SectionTabs'
import { ProductImport } from '@/components/admin/ProductImport'
import { PhotoImport } from '@/components/admin/PhotoImport'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Import products' }

export default async function ImportProductsPage() {
  await guardAdmin('/admin/products/import')
  return (
    <>
      <PageHead title="Import products" sub="Many products at once from a sheet, then their photos named by barcode" />
      <SectionTabs label="Catalogue" tabs={CATALOGUE_TABS} />
      <h2 className="mb-3 mt-2 font-display text-xl">1. The products</h2>
      <ProductImport />
      <h2 className="mb-3 mt-12 font-display text-xl">2. The photos</h2>
      <PhotoImport />
    </>
  )
}
