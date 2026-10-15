'use client'

/* ============================================================================
 * The pieces of a listing page around the product grid:
 *
 *   FilterSidebar   desktop — every change applies at once
 *   MobileFilters   phone   — "Filter & sort" opens a drawer; choices collect
 *                             until "Show 12 results", with a live count
 *   ResultsBar      the count, the active filters as removable chips,
 *                   "Clear all", and Sort by
 *   Results         the grid, dimmed while new results load
 *   NoResults       what an empty result says, and the way out of it
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getTranslator } from '@/i18n/messages'
import {
  activeFilterCount,
  clearFilters,
  listingSearchParams,
  SORTS,
  type ListingFilters,
  type ListingSort,
} from '@/lib/listing-filters'
import { activeChips, FilterGroups } from './FilterGroups'
import { useListing } from './ListingShell'

const SORT_KEYS: Record<ListingSort, Parameters<ReturnType<typeof getTranslator>>[0]> = {
  newest: 'list.sort.newest',
  'price-asc': 'list.sort.priceAsc',
  'price-desc': 'list.sort.priceDesc',
  'name-asc': 'list.sort.nameAsc',
  popular: 'list.sort.popular',
}

/* ------------------------------------------------------------ desktop -- */

export function FilterSidebar() {
  const l = useListing()
  const t = getTranslator(l.locale)
  return (
    /* Not sticky: a sticky sidebar taller than the window needs a scrollbar
       of its own, which hides groups and feels like an app, not a shop. */
    <aside aria-label={t('list.filters')} className="hidden lg:block">
      <div className="pb-10">
        <FilterGroups
          locale={l.locale}
          scope={l.scope}
          salePage={l.salePage}
          facets={l.facets}
          value={l.current}
          onChange={l.apply}
        />
      </div>
    </aside>
  )
}

/* -------------------------------------------------------------- phone -- */

export function MobileFilters() {
  const l = useListing()
  const t = getTranslator(l.locale)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ListingFilters>(l.current)
  const [count, setCount] = useState<number | null>(l.total)
  const [counting, setCounting] = useState(false)
  const sheet = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const active = activeFilterCount(l.current)

  function openSheet() {
    setDraft(l.current)
    setCount(l.total)
    setOpen(true)
  }
  function close() {
    setOpen(false)
    trigger.current?.focus()
  }

  /* The live count for the choices so far — the same query as the page. */
  const draftKey = listingSearchParams({ ...draft, page: 1 }).toString()
  const appliedKey = listingSearchParams({ ...l.current, page: 1 }).toString()
  useEffect(() => {
    if (!open || draftKey === appliedKey) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setCounting(true)
      try {
        const res = await fetch(`/api/products/count?ctx=${encodeURIComponent(l.ctx)}&locale=${l.locale}&${draftKey}`, {
          signal: controller.signal,
        })
        const data = (await res.json()) as { total?: number }
        setCount(typeof data.total === 'number' ? data.total : null)
      } catch {
        /* aborted by a newer choice, or offline — the button keeps its last number */
      } finally {
        if (!controller.signal.aborted) setCounting(false)
      }
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, draftKey, appliedKey, l.ctx, l.locale])
  const shownCount = draftKey === appliedKey ? l.total : count

  /* While open: the page behind does not scroll, Escape closes, focus
     starts inside the sheet. */
  useEffect(() => {
    if (!open) return
    const html = document.documentElement
    const previous = html.style.overflow
    html.style.overflow = 'hidden'
    sheet.current?.querySelector<HTMLElement>('button, [href], input')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      html.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="lg:hidden">
      <button
        ref={trigger}
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-12 w-full items-center justify-between border border-ink px-4 text-left"
      >
        <span className="label">{t('list.filterAndSort')}</span>
        <span className="flex items-center gap-2.5">
          {active > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] text-paper">
              {active}
            </span>
          )}
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 6h9M15 6h2M3 14h2M8 14h9" />
            <circle cx="13.5" cy="6" r="1.8" />
            <circle cx="6.5" cy="14" r="1.8" />
          </svg>
        </span>
      </button>

      {/* Rendered at the end of <body>: the trigger sits in a sticky bar,
          and anything inside that bar would be layered beneath the header. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" role="presentation">
            <button
              type="button"
              aria-label={t('nav.close')}
              tabIndex={-1}
              onClick={close}
              className="absolute inset-0 bg-black/40 transition-opacity duration-300 starting:opacity-0"
            />
            <div
              ref={sheet}
              role="dialog"
              aria-modal="true"
              aria-label={t('list.filterAndSort')}
              className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-2xl bg-paper shadow-2xl transition-transform duration-300 ease-out starting:translate-y-full"
            >
              <header className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="label">{t('list.filterAndSort')}</h2>
                <button type="button" onClick={close} aria-label={t('nav.close')} className="-mr-2 p-2">
                  <svg
                    viewBox="0 0 20 20"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden
                  >
                    <path d="M5 5l10 10M15 5 5 15" />
                  </svg>
                </button>
              </header>

              <div className="flex-1 overflow-y-auto overscroll-contain px-5">
                <fieldset className="border-b border-line py-4">
                  <legend className="label float-left mb-3 w-full">{t('list.sortBy')}</legend>
                  <div className="clear-both flex flex-wrap gap-2">
                    {SORTS.map((s) => {
                      const on = draft.sort === s
                      return (
                        <label
                          key={s}
                          className={`cursor-pointer border px-3 py-2 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                            on ? 'border-ink bg-accent text-paper' : 'border-line'
                          }`}
                        >
                          <input
                            type="radio"
                            name="sort"
                            className="sr-only"
                            checked={on}
                            onChange={() => setDraft({ ...draft, sort: s })}
                          />
                          {t(SORT_KEYS[s])}
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
                <FilterGroups
                  locale={l.locale}
                  scope={l.scope}
                  salePage={l.salePage}
                  facets={l.facets}
                  value={draft}
                  onChange={setDraft}
                />
                <div className="h-4" />
              </div>

              {/* Always in reach: no scrolling back up to apply. */}
              <footer
                className="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-line bg-paper px-5 pt-3"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
              >
                <button
                  type="button"
                  onClick={() => setDraft(clearFilters(draft))}
                  disabled={activeFilterCount(draft) === 0}
                  className="h-12 px-2 text-sm underline underline-offset-4 disabled:text-line-strong disabled:no-underline"
                >
                  {t('list.clearAll')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    l.apply(draft)
                    close()
                  }}
                  disabled={shownCount === 0}
                  className="btn btn-primary h-12"
                  aria-live="polite"
                >
                  <span className={`transition-opacity ${counting ? 'opacity-60' : ''}`}>
                    {shownCount === null ? t('list.filterAndSort') : t('list.showResults', { n: shownCount })}
                  </span>
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/* ------------------------------------------------- count, chips, sort -- */

export function ResultsBar() {
  const l = useListing()
  const t = getTranslator(l.locale)
  const chips = activeChips(l.current, l.facets, l.locale, l.salePage)

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3">
      <p className="text-sm text-muted" aria-live="polite">
        <span className={`tabular-nums transition-opacity ${l.pending ? 'opacity-50' : ''}`}>
          {t('list.results', { n: l.total })}
        </span>
        {l.pending && <span className="sr-only">{t('list.updating')}</span>}
      </p>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('list.activeFilters')}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => l.apply(chip.without)}
              aria-label={t('list.remove', { filter: chip.label })}
              className="group inline-flex h-8 items-center gap-2 border border-line bg-paper pl-3 pr-2.5 text-xs transition-colors hover:border-ink"
            >
              {chip.label}
              <svg
                aria-hidden
                viewBox="0 0 10 10"
                className="h-2.5 w-2.5 text-muted group-hover:text-ink"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <path d="M2 2l6 6M8 2 2 8" />
              </svg>
            </button>
          ))}
          <button
            type="button"
            onClick={() => l.apply(clearFilters(l.current))}
            className="ml-1 text-xs underline underline-offset-4 hover:text-muted"
          >
            {t('list.clearAll')}
          </button>
        </div>
      )}

      <label className="ml-auto hidden items-center gap-2 text-sm lg:flex">
        <span className="text-muted">{t('list.sortBy')}</span>
        <span className="relative">
          <select
            value={l.current.sort}
            onChange={(e) => l.apply({ ...l.current, sort: e.target.value as ListingSort })}
            className="h-9 cursor-pointer appearance-none bg-transparent pl-1 pr-6 text-sm font-medium outline-none focus-visible:underline"
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(SORT_KEYS[s])}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </span>
      </label>
    </div>
  )
}

/* ------------------------------------------------------------ results -- */

export function Results({ children }: { children: React.ReactNode }) {
  const { bindResults, pending } = useListing()
  return (
    <div
      ref={bindResults}
      aria-busy={pending}
      className={`transition-opacity duration-200 ${pending ? 'pointer-events-none opacity-50' : 'opacity-100'}`}
    >
      {children}
    </div>
  )
}

export function NoResults() {
  const l = useListing()
  const t = getTranslator(l.locale)
  const chips = activeChips(l.current, l.facets, l.locale, l.salePage)
  return (
    <div className="border-y border-line px-6 py-20 text-center">
      <p className="text-xl font-semibold tracking-tight">{t('list.noProductsTitle')}</p>
      {chips.length > 0 ? (
        <>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{t('list.noProductsBody')}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => l.apply(chip.without)}
                className="inline-flex h-8 items-center gap-2 border border-line pl-3 pr-2.5 text-xs hover:border-ink"
              >
                {t('list.remove', { filter: chip.label })}
                <span aria-hidden className="text-muted">
                  ×
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => l.apply(clearFilters(l.current))}
            className="btn btn-primary mt-7"
          >
            {t('list.clearFilters')}
          </button>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted">{t('list.noResults')}</p>
      )}
    </div>
  )
}
