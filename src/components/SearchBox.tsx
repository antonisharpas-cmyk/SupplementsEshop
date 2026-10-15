'use client'

/* Header search with autocomplete (spec section 6).
   Falls back to a plain form submission when JavaScript is unavailable, so the
   search still works, the suggestions are an enhancement, not the mechanism. */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { SearchIcon } from './HeaderIcons'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'

type Suggestion = { slug: string; name: string; finalCents: number; imageUrl: string | null }

/* A stable identity, so `items` does not become a new array on every render. */
const EMPTY: Suggestion[] = []

export function SearchBox({
  locale,
  placeholder,
  label,
}: {
  locale: Locale
  placeholder: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [fetched, setFetched] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  /* Debounced lookup. 200ms is short enough to feel instant and long enough
     that typing "hoodie" is one request, not six. */
  /* Whether there is anything to show is DERIVED from the term rather than
     stored: clearing state inside the effect made React re-render twice for
     every keystroke, and a stale list could flash for a term that no longer
     asks for suggestions. */
  const query = term.trim()
  const items = query.length < 2 ? EMPTY : fetched

  useEffect(() => {
    if (term.trim().length < 2) return

    const controller = new AbortController()
    const id = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(term)}&locale=${locale}`,
          { signal: controller.signal },
        )
        if (res.ok) {
          const data = (await res.json()) as { items: Suggestion[] }
          setFetched(data.items ?? [])
        }
      } catch {
        /* aborted or offline — leave the previous suggestions in place */
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => {
      clearTimeout(id)
      controller.abort()
    }
  }, [term, locale])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const fmt = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
    }).format(c / 100)

  return (
    <div ref={boxRef} className="relative">
      {/* On a phone the icon stays put and the field drops below the header;
          on a wide screen the field takes the icon's place. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`grid h-10 w-10 place-items-center hover:text-ink-soft ${open ? 'md:hidden' : ''}`}
      >
        <SearchIcon />
      </button>

      {open && (
        <form
          action={`/${locale}/search`}
          method="get"
          className="absolute right-0 top-full z-50 mt-3 flex w-[min(92vw,26rem)] items-center gap-2 border border-line bg-paper p-2 shadow-xl md:static md:mt-0 md:w-auto md:border-0 md:p-0 md:shadow-none"
          onSubmit={(e) => {
            e.preventDefault()
            if (term.trim()) router.push(`/${locale}/search?q=${encodeURIComponent(term.trim())}`)
            setOpen(false)
          }}
        >
          <input
            name="q"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
            autoFocus
            className="h-10 min-w-0 flex-1 border border-line bg-paper px-3 text-sm outline-none focus:border-accent md:w-72 md:flex-none"
          />
          <button type="submit" className="label px-2 py-2 hover:text-ink-soft">
            {label}
          </button>
        </form>
      )}

      {open && term.trim().length >= 2 && (
        <div className="absolute top-full right-0 z-50 mt-[4.25rem] w-[min(92vw,26rem)] md:mt-1 border border-line bg-paper shadow-xl">
          {loading && items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted">No matches.</p>
          )}
          <ul>
            {items.map((item) => (
              <li key={item.slug}>
                <Link
                  href={`/${locale}/products/${item.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 hover:bg-paper-2"
                >
                  <span className="h-14 w-11 shrink-0 overflow-hidden bg-paper-2">
                    {item.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                  <span className="text-sm font-medium">{fmt(item.finalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
