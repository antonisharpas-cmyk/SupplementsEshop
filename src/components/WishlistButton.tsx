'use client'

/* The heart. Saves a product to the signed-in customer's wishlist; for a
   visitor, it explains that signing in is needed and links there. */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

export function WishlistButton({
  locale,
  productId,
  initial,
  signedIn,
  compact = false,
}: {
  locale: Locale
  productId: string
  initial: boolean
  signedIn: boolean
  compact?: boolean
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState(false)

  async function toggle() {
    if (!signedIn) return setHint(true)
    setBusy(true)
    const next = !saved
    setSaved(next)
    try {
      const res = await fetch('/api/account/wishlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, saved: next }),
      })
      if (!res.ok) setSaved(!next)
      else if (compact) router.refresh()
    } catch {
      setSaved(!next)
    }
    setBusy(false)
  }

  const label = saved ? t('wl.remove') : t('wl.add')
  return (
    <div className={compact ? '' : 'relative'}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        aria-label={label}
        title={label}
        className={
          compact
            ? 'grid h-9 w-9 place-items-center rounded-full bg-paper/85 backdrop-blur-sm transition hover:scale-105'
            : 'btn btn-ghost'
        }
      >
        <svg viewBox="0 0 24 24" className={`h-5 w-5 ${saved ? 'fill-accent text-accent' : 'fill-none text-ink'}`} stroke="currentColor" strokeWidth="1.7" aria-hidden>
          <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 5.6 3.5 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
        </svg>
        {!compact && <span>{label}</span>}
      </button>
      {hint && (
        <p role="status" className="mt-2 text-xs text-muted">
          <Link href={`/${locale}/sign-in`} className="text-accent underline">
            {t('auth.signIn')}
          </Link>{' '}
          · {t('wl.signIn')}
        </p>
      )}
    </div>
  )
}
