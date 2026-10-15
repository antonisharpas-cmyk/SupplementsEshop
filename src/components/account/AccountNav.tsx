'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AccountNav({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname()
  return (
    <nav aria-label="Account" className="-mx-[var(--spacing-gutter)] overflow-x-auto px-[var(--spacing-gutter)] lg:mx-0 lg:px-0">
      <ul className="flex gap-1 lg:flex-col">
        {items.map((i) => {
          const on = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`)
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={on ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors lg:border-b-0 lg:border-l-2 ${
                  on ? 'border-accent text-heading' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {i.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
