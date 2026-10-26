'use client'

/* The bag link in the header, with a live item count.
 *
 * It starts from the count the server rendered, then follows `bag:count`
 * events (lib/bag-events.ts) sent by Add to bag and the bag page as soon as
 * the server confirms a change. A fresh server render (navigation, refresh)
 * also resets it, so it can never drift from the real bag for long. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { BAG_EVENT } from '@/lib/bag-events'

export function HeaderBag({ locale, initialCount }: { locale: Locale; initialCount: number }) {
  const t = getTranslator(locale)
  const label = (n: number) => t('nav.bagCount', { n })
  const [count, setCount] = useState(initialCount)
  const [seen, setSeen] = useState(initialCount)
  /* A new server count wins (adjusting state during render, not in an effect). */
  if (initialCount !== seen) {
    setSeen(initialCount)
    setCount(initialCount)
  }

  useEffect(() => {
    const on = (e: Event) => {
      const n = (e as CustomEvent<{ count?: number }>).detail?.count
      if (typeof n === 'number') setCount(n)
    }
    window.addEventListener(BAG_EVENT, on)
    return () => window.removeEventListener(BAG_EVENT, on)
  }, [])

  return (
    <Link
      href={`/${locale}/cart`}
      aria-label={label(count)}
      title={label(count)}
      className="relative grid h-9 w-9 place-items-center hover:text-ink-soft sm:h-10 sm:w-10"
    >
      <BagIcon />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-paper tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

export function BagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M5 8h14l-1 12.5H6L5 8z" strokeLinejoin="round" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" strokeLinecap="round" />
    </svg>
  )
}

export function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="12" cy="8.5" r="3.75" />
      <path d="M4.75 20c.9-3.6 3.8-5.75 7.25-5.75S18.35 16.4 19.25 20" strokeLinecap="round" />
    </svg>
  )
}

export function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="M15.5 15.5 20 20" strokeLinecap="round" />
    </svg>
  )
}
