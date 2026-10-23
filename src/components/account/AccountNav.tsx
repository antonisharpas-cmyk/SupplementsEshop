'use client'

/* The account menu: an icon and a name per section. Down the side on a
   computer, a scrolling row of pills on a phone. */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const ACCOUNT_ICONS = {
  orders: (
    <svg viewBox="0 0 24 24" {...s}><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" {...s}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" /></svg>
  ),
  wishlist: (
    <svg viewBox="0 0 24 24" {...s}><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.2 4.5c2 0 3.4 1.1 4.8 2.8 1.4-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" /></svg>
  ),
  addresses: (
    <svg viewBox="0 0 24 24" {...s}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
  ),
  membership: (
    <svg viewBox="0 0 24 24" {...s}><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8-4.3-4.1 5.9-.9z" /></svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="8" r="4" /><path d="M4 20.5c1-4 4.2-6 8-6s7 2 8 6" /></svg>
  ),
}

export type AccountNavItem = { href: string; label: string; icon: keyof typeof ACCOUNT_ICONS; badge?: number }

export function AccountNav({ items }: { items: AccountNavItem[] }) {
  const path = usePathname()
  return (
    <nav aria-label="Account" className="-mx-[var(--spacing-gutter)] overflow-x-auto px-[var(--spacing-gutter)] lg:mx-0 lg:overflow-visible lg:px-0">
      <ul className="flex gap-2 lg:flex-col lg:gap-1">
        {items.map((i) => {
          const on = path === i.href || path.startsWith(`${i.href}/`)
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={on ? 'page' : undefined}
                className={`flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2.5 text-sm transition-colors lg:rounded-xl ${
                  on
                    ? 'bg-gold font-semibold text-black shadow-[0_8px_24px_-14px_rgb(242_183_5/0.8)]'
                    : 'border border-line text-ink-soft hover:border-line-strong hover:text-heading lg:border-transparent lg:hover:bg-paper'
                }`}
              >
                <span aria-hidden className="h-[18px] w-[18px] shrink-0">
                  {ACCOUNT_ICONS[i.icon]}
                </span>
                <span className="flex-1">{i.label}</span>
                {i.badge ? (
                  <span className={`rounded-full px-2 text-xs tabular-nums ${on ? 'bg-black/15' : 'bg-accent/15 text-accent'}`}>{i.badge}</span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
