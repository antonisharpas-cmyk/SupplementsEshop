'use client'

/* In the shop header, for someone signed in with an admin account (the
   owners and support): the profile icon with an ADMIN flag, and a small menu
   with the admin panel and sign out. Owners do not shop, so there are no
   orders, wishlist or addresses here. */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { UserIcon } from './HeaderIcons'

export function StaffMenu({ locale, name }: { locale: Locale; name: string }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}, admin`}
        title={`${name} (admin)`}
        onClick={() => setOpen((o) => !o)}
        className="relative grid h-9 w-9 place-items-center hover:text-ink-soft sm:h-10 sm:w-10"
      >
        <UserIcon />
        <span className="bg-gold absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded px-1 text-[8px] font-bold leading-[13px] tracking-wider text-paper">
          ADMIN
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]">
          <p className="border-b border-line px-4 py-3 text-xs text-muted">
            <span className="block truncate text-sm font-medium text-heading">{name}</span>
            Admin account
          </p>
          <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-paper-2 hover:text-accent">
            Admin panel
          </Link>
          <Link role="menuitem" href="/admin/account" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-sm hover:bg-paper-2 hover:text-accent">
            Change password
          </Link>
          <button
            role="menuitem"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await fetch('/api/auth/logout', { method: 'POST' })
              } finally {
                setOpen(false)
                router.push(`/${locale}`)
                router.refresh()
                setBusy(false)
              }
            }}
            className="block w-full border-t border-line px-4 py-2.5 text-left text-sm text-sale hover:bg-paper-2 disabled:opacity-50"
          >
            {t('auth.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
