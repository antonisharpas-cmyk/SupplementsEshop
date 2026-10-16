'use client'

/* ============================================================================
 * Search, filters, chips and sort for an admin list.
 *
 * The address bar is the state. Every choice here rewrites the query string
 * and the server page re-renders with the new rows — so a filtered view can be
 * bookmarked, shared with a colleague, or survive a refresh, and filtering
 * never happens on a half-loaded list in the browser.
 *
 * Search waits until typing pauses (300 ms) before asking, so "leggings" is
 * one request, not eight. Changing any filter goes back to page 1.
 * ========================================================================== */

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type FilterOption = { value: string; label: string; group?: string; swatch?: string | null }
export type FilterMenu = { param: string; label: string; options: FilterOption[] }

type Props = {
  searchPlaceholder: string
  menus: FilterMenu[]
  /** Show the € from / to fields (params `min` and `max`). */
  price?: boolean
  sorts: { value: string; label: string }[]
  /** Parameters that "Clear all filters" leaves alone (e.g. the stock view). */
  keep?: string[]
}

export function FilterBar({ searchPlaceholder, menus, price, sorts, keep = [] }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [q, setQ] = useState(params.get('q') ?? '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const listOf = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean)

  function go(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    next.delete('page')
    const qs = next.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  function onSearch(value: string) {
    setQ(value)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => go({ q: value.trim() || null }), 300)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function toggle(param: string, value: string) {
    const current = listOf(param)
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    go({ [param]: next.join(',') || null })
  }

  /* Every active choice as a removable chip, in menu order. */
  const chips: { key: string; label: string; remove: () => void }[] = []
  const activeQ = params.get('q')
  if (activeQ)
    chips.push({
      key: 'q',
      label: `“${activeQ}”`,
      remove: () => {
        setQ('')
        go({ q: null })
      },
    })
  for (const menu of menus) {
    for (const value of listOf(menu.param)) {
      const option = menu.options.find((o) => o.value === value)
      if (!option) continue
      chips.push({
        key: `${menu.param}:${value}`,
        label: `${menu.label}: ${option.label}`,
        remove: () => toggle(menu.param, value),
      })
    }
  }
  if (price && params.get('min'))
    chips.push({ key: 'min', label: `From €${params.get('min')}`, remove: () => go({ min: null }) })
  if (price && params.get('max'))
    chips.push({ key: 'max', label: `Up to €${params.get('max')}`, remove: () => go({ max: null }) })

  function clearAll() {
    setQ('')
    const next = new URLSearchParams()
    for (const k of keep) {
      const v = params.get(k)
      if (v) next.set(k, v)
    }
    const sort = params.get('sort')
    if (sort) next.set('sort', sort)
    const qs = next.toString()
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
  }

  return (
    <div className="mb-6 space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[16rem] flex-1 basis-72">
          <span className="sr-only">Search</span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (timer.current) clearTimeout(timer.current)
                go({ q: q.trim() || null })
              }
            }}
            placeholder={searchPlaceholder}
            className="w-full border border-line bg-paper py-3 pl-10 pr-3.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        {menus.map((menu) => (
          <Menu
            key={menu.param}
            menu={menu}
            selected={listOf(menu.param)}
            onToggle={(v) => toggle(menu.param, v)}
            onClear={() => go({ [menu.param]: null })}
          />
        ))}

        {price && <PriceMenu min={params.get('min') ?? ''} max={params.get('max') ?? ''} onApply={go} />}

        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="label text-muted">Sort</span>
          <select
            value={params.get('sort') ?? sorts[0]?.value}
            onChange={(e) => go({ sort: e.target.value === sorts[0]?.value ? null : e.target.value })}
            className="border border-line bg-paper px-3 py-2.5 text-sm outline-none focus:border-accent"
          >
            {sorts.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {(chips.length > 0 || pending) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.remove}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-paper py-1 pl-3 pr-2 text-xs transition-colors hover:border-ink"
              aria-label={`Remove filter ${chip.label}`}
            >
              {chip.label}
              <span aria-hidden className="text-muted">
                ✕
              </span>
            </button>
          ))}
          {chips.length > 0 && (
            <button type="button" onClick={clearAll} className="ml-1 text-xs text-muted underline hover:text-ink">
              Clear all filters
            </button>
          )}
          {pending && <span className="text-xs text-muted">Updating…</span>}
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- menus -- */

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, ref }
}

function Trigger({ label, count, open, onClick }: { label: string; count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition-colors ${
        count ? 'border-ink bg-paper' : 'border-line bg-paper hover:border-ink'
      }`}
    >
      {label}
      {count > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] text-paper">
          {count}
        </span>
      )}
      <span aria-hidden className={`text-[10px] text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
        ▼
      </span>
    </button>
  )
}

function Menu({
  menu,
  selected,
  onToggle,
  onClear,
}: {
  menu: FilterMenu
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
}) {
  const { open, setOpen, ref } = usePopover()

  return (
    <div ref={ref} className="relative">
      <Trigger label={menu.label} count={selected.length} open={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div
          role="group"
          aria-label={menu.label}
          className="absolute left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-2xl border border-line bg-paper py-2 shadow-lg"
        >
          {menu.options.length === 0 && <p className="px-4 py-2 text-sm text-muted">Nothing to choose yet.</p>}
          {menu.options.map((o, i) => {
            const header = o.group && o.group !== menu.options[i - 1]?.group ? o.group : null
            return (
              <div key={o.value}>
                {header && <p className="label px-4 pb-1 pt-3 text-muted">{header}</p>}
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-paper-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => onToggle(o.value)}
                    className="h-4 w-4 accent-[var(--color-accent)]"
                  />
                  {o.swatch !== undefined && (
                    <span
                      aria-hidden
                      className="h-3.5 w-3.5 rounded-full border border-line-strong"
                      style={{ background: o.swatch ?? '#ddd' }}
                    />
                  )}
                  {o.label}
                </label>
              </div>
            )
          })}
          {selected.length > 0 && (
            <button type="button" onClick={onClear} className="mt-1 w-full px-4 py-2 text-left text-xs text-muted underline hover:text-ink">
              Clear {menu.label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function PriceMenu({
  min,
  max,
  onApply,
}: {
  min: string
  max: string
  onApply: (changes: Record<string, string | null>) => void
}) {
  const { open, setOpen, ref } = usePopover()
  const [from, setFrom] = useState(min)
  const [to, setTo] = useState(max)
  const [error, setError] = useState<string | null>(null)

  function apply(e: React.FormEvent) {
    e.preventDefault()
    const a = from.trim().replace(',', '.')
    const b = to.trim().replace(',', '.')
    const ok = (v: string) => v === '' || /^\d+(\.\d{1,2})?$/.test(v)
    if (!ok(a) || !ok(b)) return setError('Amounts like 40 or 59.90.')
    if (a && b && Number(a) > Number(b)) return setError('“From” is higher than “to”.')
    setError(null)
    onApply({ min: a || null, max: b || null })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <Trigger
        label="Price"
        count={(min ? 1 : 0) + (max ? 1 : 0)}
        open={open}
        onClick={() => {
          setFrom(min)
          setTo(max)
          setOpen((o) => !o)
        }}
      />
      {open && (
        <form onSubmit={apply} className="absolute left-0 z-30 mt-1 w-64 space-y-3 rounded-2xl border border-line bg-paper p-4 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">
              From €
              <input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="decimal" className="mt-1 w-full border border-line px-2.5 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
            <label className="text-xs text-muted">
              To €
              <input value={to} onChange={(e) => setTo(e.target.value)} inputMode="decimal" className="mt-1 w-full border border-line px-2.5 py-2 text-sm text-ink outline-none focus:border-accent" />
            </label>
          </div>
          <p className="text-xs text-muted">The price a customer pays today, the sale price when there is one.</p>
          {error && <p role="alert" className="text-xs text-sale">{error}</p>}
          <button type="submit" className="btn btn-primary btn-sm w-full">
            Apply
          </button>
        </form>
      )}
    </div>
  )
}
