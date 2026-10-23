'use client'

/* Tabs across the top of a grouped admin section (Catalogue, Promotions),
   in the same style as Marketing & Emails. Links, so each tab keeps its
   own address. A tab is current on its page and on the pages beneath it. */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type SectionTab = { href: string; label: string; /** Also current on these. */ also?: string[] }

export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  const path = usePathname()
  const under = (href: string) => path === href || path.startsWith(`${href}/`)
  /* The most specific tab wins, so /admin/promotions/codes is not also
     "Promotions". */
  const matches = tabs.filter((t) => [t.href, ...(t.also ?? [])].some(under))
  const best = matches.sort((a, b) => b.href.length - a.href.length)[0]
  return (
    <nav aria-label={label} className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = best?.href === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${
              on ? 'border-accent font-medium text-heading' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

export const CATALOGUE_TABS: SectionTab[] = [
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/categories', label: 'Categories' },
  { href: '/admin/stock', label: 'Stock' },
  { href: '/admin/stock-moves', label: 'Stock movements' },
]

export const PROMOTION_TABS: SectionTab[] = [
  { href: '/admin/promotions', label: 'Automatic promotions' },
  { href: '/admin/promotions/codes', label: 'Promo codes' },
]

export const PURCHASE_TABS: SectionTab[] = [
  { href: '/admin/purchases', label: 'Purchases' },
  { href: '/admin/purchases/suppliers', label: 'Suppliers' },
  { href: '/admin/purchases/opening', label: 'Opening stock' },
  { href: '/admin/purchases/prices', label: 'Price history' },
]

export const WHOLESALE_TABS: SectionTab[] = [
  { href: '/admin/wholesale', label: 'Sales' },
  { href: '/admin/wholesale/retailers', label: 'Retailers' },
  { href: '/admin/wholesale/prices', label: 'Wholesale prices' },
]

export const EXPENSE_TABS: SectionTab[] = [
  { href: '/admin/expenses', label: 'Expenses' },
  { href: '/admin/expenses/repeating', label: 'Repeating' },
  { href: '/admin/expenses/categories', label: 'Categories' },
]
