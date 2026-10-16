/* Catalogue → Categories: the shop's own menu, three levels deep. */

import { guardAdmin } from '@/lib/admin'
import { adminCategoryTree } from '@/lib/admin-categories'
import { PageHead } from '@/components/admin/ui'
import { CategoryManager } from '@/components/admin/CategoryManager'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Categories' }

export default async function CategoriesPage() {
  await guardAdmin('/admin/categories')
  const tree = await adminCategoryTree()
  return (
    <>
      <PageHead
        title="Categories"
        sub="Ranges show in the main menu. Inside a range add groups (e.g. Men), and inside a group add sections (e.g. Socks). Products go in a group or a section."
      />
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded-full border border-line px-3 py-1">Clothing</span>
        <span aria-hidden>›</span>
        <span className="rounded-full border border-line px-3 py-1">Men</span>
        <span aria-hidden>›</span>
        <span className="rounded-full border border-line px-3 py-1">Socks</span>
        <span className="ml-2">An example of the three levels.</span>
      </div>
      <CategoryManager tree={tree} />
    </>
  )
}
