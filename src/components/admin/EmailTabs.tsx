'use client'

/* The section tabs of Admin → Marketing & Emails. Links, not buttons: each
   section is its own page with its own URL. */

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin/emails', label: 'Automated emails' },
  { href: '/admin/emails/campaigns', label: 'Campaigns' },
  { href: '/admin/emails/subscribers', label: 'Subscribers' },
  { href: '/admin/emails/activity', label: 'Email activity' },
  { href: '/admin/emails/settings', label: 'Settings' },
]

export function EmailTabs() {
  const path = usePathname()
  const current = (href: string) =>
    href === '/admin/emails'
      ? path === href || !TABS.slice(1).some((t) => path.startsWith(t.href))
      : path.startsWith(href)
  return (
    <nav aria-label="Marketing & Emails" className="mb-8 flex gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={current(t.href) ? 'page' : undefined}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm transition-colors ${
            current(t.href) ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
