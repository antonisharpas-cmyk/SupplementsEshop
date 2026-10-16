'use client'

/* ============================================================================
 * The admin's left-hand menu, CRM style: the logo at the top, one line per
 * section with its icon, live counts where something is waiting, and who is
 * signed in at the bottom. On a phone it folds away behind a menu button.
 * ========================================================================== */

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Item = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; also?: string[] }
type Group = { title?: string; items: Item[] }

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ICONS = {
  overview: (
    <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
  ),
  orders: (
    <svg viewBox="0 0 24 24" {...s}><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
  ),
  customers: (
    <svg viewBox="0 0 24 24" {...s}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M17 14.5c2.4.2 4 1.8 4.5 4.5" /></svg>
  ),
  products: (
    <svg viewBox="0 0 24 24" {...s}><path d="M7 4h10l1 3H6l1-3z" /><rect x="5" y="7" width="14" height="14" rx="2" /><path d="M9 12h6" /></svg>
  ),
  stock: (
    <svg viewBox="0 0 24 24" {...s}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
  ),
  homepage: (
    <svg viewBox="0 0 24 24" {...s}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" {...s}><path d="M4 5h16v11H9l-5 4V5z" /><path d="M8 9.5h8M8 12.5h5" /></svg>
  ),
  emails: (
    <svg viewBox="0 0 24 24" {...s}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></svg>
  ),
  categories: (
    <svg viewBox="0 0 24 24" {...s}><rect x="3" y="3" width="7" height="7" rx="2" /><path d="M6.5 10v4.5a2 2 0 0 0 2 2H14" /><rect x="14" y="13.5" width="7" height="6" rx="2" /><path d="M10 6.5h4" /><rect x="14" y="3.5" width="7" height="6" rx="2" /></svg>
  ),
  promotions: (
    <svg viewBox="0 0 24 24" {...s}><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" /><circle cx="8" cy="8" r="1.5" /><path d="M10 16l6-6" /></svg>
  ),
  accounting: (
    <svg viewBox="0 0 24 24" {...s}><path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2V2z" /><path d="M9 7h6M9 11h6M9 15h3" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  shop: (
    <svg viewBox="0 0 24 24" {...s}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" {...s}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" {...s}><path d="M6 6l12 12M18 6L6 18" /></svg>
  ),
}

function NavList({ groups, onPick }: { groups: Group[]; onPick: () => void }) {
  const path = usePathname()
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`))
  return (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 py-4">
      {groups.map((g, gi) => (
        <div key={gi} className={gi ? 'mt-6' : ''}>
          {g.title && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const on = [item.href, ...(item.also ?? [])].some(active)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onPick}
                    aria-current={on ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                      on ? 'bg-gold font-semibold text-black' : 'text-ink-soft hover:bg-paper-2 hover:text-heading'
                    }`}
                  >
                    <span className={`h-5 w-5 shrink-0 ${on ? 'text-black' : 'text-muted group-hover:text-accent'}`}>{ICONS[item.icon]}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span
                        className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
                          on ? 'bg-black text-accent' : 'bg-accent text-black'
                        }`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AdminSidebar({
  groups,
  user,
  logo,
  signOut,
}: {
  groups: Group[]
  user: { name: string; role: string }
  logo: { mark: string; wordmark: string; name: string }
  signOut: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.mark} alt="" className="h-6 w-auto" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo.wordmark} alt={logo.name} className="h-3.5 w-auto" />
      <span className="ml-1 rounded-sm bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-black">Admin</span>
    </Link>
  )

  const footer = (
    <div className="border-t border-line px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-2 text-sm font-semibold text-accent">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-heading">{user.name}</span>
          <span className="block text-[10px] uppercase tracking-wider text-muted">{user.role}</span>
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/en" className="inline-flex items-center gap-1.5 text-muted hover:text-accent" target="_blank">
          <span className="h-4 w-4">{ICONS.shop}</span>
          View shop
        </Link>
        {signOut}
      </div>
    </div>
  )

  return (
    <>
      {/* phone: a bar with the menu button */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-paper px-4 lg:hidden print:hidden">
        {brand}
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="h-9 w-9 p-1.5 text-ink">
          {ICONS.menu}
        </button>
      </div>
      {open && <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`print:hidden fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-paper transition-transform lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          {brand}
        </div>
        <NavList groups={groups} onPick={() => setOpen(false)} />
        {footer}
      </aside>
    </>
  )
}
