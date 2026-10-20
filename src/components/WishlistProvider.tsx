'use client'

/* Which products the signed in customer has saved, shared by every heart on
   the page, so saving on one card fills the heart on the same product
   elsewhere (the marquee, a listing, the product page). */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

type Ctx = { signedIn: boolean; saved: Set<string>; toggle: (id: string) => Promise<void>; locale: Locale; staff: boolean }
const WishlistCtx = createContext<Ctx | null>(null)

export function WishlistProvider({
  locale,
  signedIn,
  initial,
  staff = false,
  children,
}: {
  locale: Locale
  signedIn: boolean
  initial: string[]
  /** An admin account: no hearts, owners do not save products. */
  staff?: boolean
  children: React.ReactNode
}) {
  const [saved, setSaved] = useState(() => new Set(initial))
  const router = useRouter()
  const path = usePathname()

  const toggle = useCallback(
    async (id: string) => {
      if (!signedIn) {
        router.push(`/${locale}/sign-in?next=${encodeURIComponent(path)}`)
        return
      }
      const next = !saved.has(id)
      const flip = (on: boolean) =>
        setSaved((s) => {
          const n = new Set(s)
          if (on) n.add(id)
          else n.delete(id)
          return n
        })
      flip(next)
      const res = await fetch('/api/account/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: id, saved: next }),
      }).catch(() => null)
      if (!res?.ok) flip(!next)
    },
    [signedIn, saved, router, locale, path],
  )

  const value = useMemo(() => ({ signedIn, saved, toggle, locale, staff }), [signedIn, saved, toggle, locale, staff])
  return <WishlistCtx.Provider value={value}>{children}</WishlistCtx.Provider>
}

/** The small heart beside a product's name on cards. */
export function CardHeart({ productId, tabIndex, className = '' }: { productId: string; tabIndex?: number; className?: string }) {
  const ctx = useContext(WishlistCtx)
  if (!ctx || ctx.staff) return null
  const on = ctx.saved.has(productId)
  const t = getTranslator(ctx.locale)
  const label = on ? t('wl.remove') : t('wl.add')
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        void ctx.toggle(productId)
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
      tabIndex={tabIndex}
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-all hover:scale-110 ${
        on ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-ink-soft hover:border-accent hover:text-accent'
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className={`h-[18px] w-[18px] ${on ? 'fill-current' : 'fill-none'}`} stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8 3.6 4.5 7.2 4.5c2 0 3.4 1.1 4.8 2.8 1.4-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.5 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" strokeLinejoin="round" />
      </svg>
    </button>
  )
}
