'use client'

/* ============================================================================
 * The state every part of a listing page shares: the filters in force, the
 * facets to offer, and one way to change them.
 *
 * Changing a filter is a navigation (router.push), not client-side filtering:
 * the URL updates, the server runs the real query, and only the results
 * re-render — no page reload, scroll kept, back and forward work. While the
 * server answers, `useOptimistic` shows the new choice at once, so a chip
 * turns dark the moment it is tapped rather than when the grid arrives.
 * ========================================================================== */

import { createContext, useCallback, useContext, useOptimistic, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import type { ProductListing } from '@/lib/catalog'
import { listingHref, type ListingFilters } from '@/lib/listing-filters'

export type ListingScope = 'department' | 'subcategory' | 'all'

export type ListingData = {
  locale: Locale
  basePath: string
  /** For /api/products/count: "women", "women/leggings", "new", "sale", "search". */
  ctx: string
  scope: ListingScope
  /** The Sale page: every product is reduced, so "On sale" is not offered. */
  salePage: boolean
  filters: ListingFilters
  facets: ProductListing['facets']
  total: number
}

type Shell = ListingData & {
  /** The filters as the shopper last set them (optimistic). */
  current: ListingFilters
  pending: boolean
  apply: (next: ListingFilters) => void
  /** Callback ref for the results, so a filter change can bring them into view. */
  bindResults: (el: HTMLDivElement | null) => void
}

const Ctx = createContext<Shell | null>(null)

export function useListing(): Shell {
  const value = useContext(Ctx)
  if (!value) throw new Error('useListing() outside <ListingShell>')
  return value
}

export function ListingShell({ data, children }: { data: ListingData; children: React.ReactNode }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [current, setCurrent] = useOptimistic(data.filters)
  const resultsRef = useRef<HTMLDivElement>(null)

  const apply = useCallback(
    (next: ListingFilters) => {
      /* A new filter starts at page 1; staying on page 3 of a smaller set
         would show nothing. (Pages themselves are plain links.) */
      const target = { ...next, page: 1 }
      /* Scrolled past the top of the results? Bring them back into view, so
         the change is visible, otherwise stay exactly where you are. */
      const top = resultsRef.current?.getBoundingClientRect().top ?? 0
      if (top < 0) {
        window.scrollTo({ top: window.scrollY + top - 120, behavior: 'smooth' })
      }
      startTransition(() => {
        setCurrent(target)
        router.push(listingHref(data.basePath, target), { scroll: false })
      })
    },
    [data.basePath, router, setCurrent],
  )

  const bindResults = useCallback((el: HTMLDivElement | null) => {
    resultsRef.current = el
  }, [])

  return <Ctx.Provider value={{ ...data, current, pending, apply, bindResults }}>{children}</Ctx.Provider>
}
