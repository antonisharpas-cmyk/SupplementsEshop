/* ============================================================================
 * Reports: one card per report, grouped. Click a card to open it.
 * Finance reports show only to staff who may see the money; the stock
 * report (units only) shows to everyone.
 * ========================================================================== */

import Link from 'next/link'
import { canSeeFinance, guardAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reports' }

type Card = { href: string; title: string; sub: string; finance?: boolean }

const GROUPS: { title: string; cards: Card[] }[] = [
  {
    title: 'Sales and profit',
    cards: [
      { href: '/admin/reports/profit', title: 'Profit and loss', sub: 'Sales, costs and profit, month by month', finance: true },
      { href: '/admin/reports/margins', title: 'Margin by category', sub: 'What each category sold and earned', finance: true },
      { href: '/admin/reports/spending', title: 'Spending', sub: 'Stock bought and expenses, by category', finance: true },
      { href: '/admin/reports/vat', title: 'VAT', sub: 'VAT on sales and purchases, month by month', finance: true },
    ],
  },
  {
    title: 'Products and stock',
    cards: [
      { href: '/admin/reports/stock', title: 'Where the stock went', sub: 'Bought, sold, samples, opened, lost, on the shelf' },
      { href: '/admin/reports/stock-value', title: 'Stock value', sub: 'What the stock on the shelf cost, each month', finance: true },
    ],
  },
  {
    title: 'Partners',
    cards: [{ href: '/admin/partners', title: 'Partners and commission', sub: 'Sales with partner codes, commission owed' }],
  },
  {
    title: 'Accounting',
    cards: [
      { href: '/admin/reports/accountant', title: 'For the accountant', sub: 'Close a month, download the monthly pack', finance: true },
      { href: '/admin/accounting', title: 'Invoices and credit notes', sub: 'Every invoice, filter and export', finance: true },
    ],
  },
]

export default async function ReportsHub() {
  const user = await guardAdmin('/admin/reports')
  const finance = canSeeFinance(user)
  const groups = GROUPS.map((g) => ({ ...g, cards: g.cards.filter((c) => finance || !c.finance) })).filter((g) => g.cards.length > 0)

  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">Reports</h1>
      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="label mb-3 text-muted">{g.title}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.cards.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  className="group flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-6 py-5 transition-colors hover:border-accent"
                >
                  <span>
                    <span className="block text-lg font-semibold text-accent">{c.title}</span>
                    <span className="mt-1 block text-sm text-muted">{c.sub}</span>
                  </span>
                  <span aria-hidden className="text-xl text-muted transition-transform group-hover:translate-x-1 group-hover:text-accent">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
