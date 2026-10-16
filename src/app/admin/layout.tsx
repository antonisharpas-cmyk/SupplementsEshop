/* ============================================================================
 * The admin shell.
 *
 * Its own layout, OUTSIDE [locale]: this is a staff tool in one language, and
 * routing it through locale negotiation would only put /en/ in front of every
 * URL for no one's benefit. `src/proxy.ts` excludes /admin for the same reason.
 *
 * The guard runs HERE, so every page beneath it is protected by construction
 * rather than by each page remembering. Pages still call guardAdmin() for the
 * user object — it is cheap, and a page that reads it cannot be moved out from
 * under this layout and quietly lose its protection.
 * ========================================================================== */

import type { Metadata } from 'next'
import { BRAND } from '@/config/brand'
import { guardAdmin } from '@/lib/admin'
import { assertSchemaReady } from '@/db/ready'
import { inboxCounts } from '@/lib/support'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import '../globals.css'

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  /* Never in a search index, never followed. */
  robots: { index: false, follow: false, nocache: true },
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  /* Before anything reads a table: on this machine's database, new code's
     migrations are applied here rather than surfacing as a failed query. */
  await assertSchemaReady()
  const user = await guardAdmin()
  /* The one live number in the nav: conversations waiting for a reply. */
  const support = await inboxCounts().catch(() => ({ open: 0, unread: 0 }))
  /* And orders waiting for someone: new cash orders and paid card orders. */
  const { orderCounts } = await import('@/lib/orders')
  const oc = await orderCounts().catch(() => ({}) as Record<string, number>)
  const toDo = (oc.PENDING ?? 0) + (oc.PAID ?? 0)

  const groups = [
    {
      items: [
        { href: '/admin', label: 'Overview', icon: 'overview' as const },
        { href: '/admin/orders', label: 'Orders', icon: 'orders' as const, badge: toDo },
        { href: '/admin/customers', label: 'Customers', icon: 'customers' as const },
      ],
    },
    {
      title: 'Catalogue',
      items: [
        { href: '/admin/products', label: 'Products & stock', icon: 'products' as const, also: ['/admin/categories', '/admin/stock'] },
        { href: '/admin/promotions', label: 'Promotions & codes', icon: 'promotions' as const },
        { href: '/admin/homepage', label: 'Homepage', icon: 'homepage' as const },
      ],
    },
    {
      title: 'Customers & marketing',
      items: [
        { href: '/admin/support', label: 'Customer service', icon: 'support' as const, badge: support.unread },
        { href: '/admin/emails', label: 'Marketing & emails', icon: 'emails' as const },
      ],
    },
    {
      title: 'Shop',
      items: [
        { href: '/admin/accounting', label: 'Accounting', icon: 'accounting' as const },
        { href: '/admin/settings', label: 'Settings', icon: 'settings' as const },
      ],
    },
  ]

  return (
    <html lang="en">
      <body className="min-h-screen bg-paper-2 print:bg-white">
        <AdminSidebar
          groups={groups}
          user={{ name: `${user.firstName} ${user.lastName}`.trim(), role: user.role.replace('_', ' ') }}
          logo={{ mark: BRAND.logo.mark, wordmark: BRAND.logo.wordmark, name: BRAND.name }}
          signOut={<SignOutButton locale="en" />}
        />
        <main className="min-w-0 px-5 py-8 sm:px-8 lg:ml-64 lg:px-10 lg:py-10 print:m-0 print:p-0">
          <div className="mx-auto max-w-[96rem]">{children}</div>
        </main>
      </body>
    </html>
  )
}
