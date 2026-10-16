'use client'

/* A dropdown with a search box at the top: type a few letters, the list
   narrows, arrow keys and Enter pick. Drops in for a <select>; with `name`,
   a hidden input carries the value for plain HTML forms. */

import { useEffect, useId, useMemo, useRef, useState } from 'react'

export type SearchOption = { value: string; label: string; hint?: string; disabled?: boolean; header?: boolean }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function SearchSelect({
  options,
  value,
  onChange,
  name,
  placeholder = 'Choose',
  searchPlaceholder = 'Search',
  ariaLabel,
  required,
  className = '',
}: {
  options: SearchOption[]
  value: string
  onChange?: (v: string) => void
  name?: string
  placeholder?: string
  searchPlaceholder?: string
  ariaLabel?: string
  required?: boolean
  className?: string
}) {
  const [own, setOwn] = useState(value)
  const v = onChange ? value : own
  const set = (next: string) => (onChange ? onChange(next) : setOwn(next))

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const current = options.find((o) => o.value === v && !o.header)
  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    if (!words.length) return options
    const hit = options.filter((o) => !o.header && words.every((w) => fold(`${o.label} ${o.hint ?? ''}`).includes(w)))
    return hit
  }, [options, q])
  const pickable = shown.filter((o) => !o.header && !o.disabled)

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', out)
    return () => document.removeEventListener('mousedown', out)
  }, [open])

  useEffect(() => {
    list.current?.querySelector('[data-hi="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [hi, open])

  const choose = (o: SearchOption) => {
    set(o.value)
    setOpen(false)
    setQ('')
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={v} required={required} />}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((o) => !o)
          setHi(Math.max(0, pickable.findIndex((o) => o.value === v)))
        }}
        className={`flex w-full items-center gap-2 rounded-xl border bg-paper px-3.5 py-2.5 text-left text-sm transition-colors ${open ? 'border-accent' : 'border-line hover:border-line-strong'}`}
      >
        <span className={`flex-1 truncate ${current ? 'text-ink' : 'text-muted'}`}>{current?.label ?? placeholder}</span>
        <svg aria-hidden viewBox="0 0 20 20" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} fill="currentColor">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 min-w-64 overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]">
          <div className="border-b border-line p-2">
            <label className="flex items-center gap-2 rounded-xl border border-transparent bg-paper-2 px-3 focus-within:border-accent/60">
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={search}
                value={q}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={id}
                onChange={(e) => {
                  setQ(e.target.value)
                  setHi(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setHi((h) => Math.min(pickable.length - 1, h + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setHi((h) => Math.max(0, h - 1))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (pickable[hi]) choose(pickable[hi])
                  } else if (e.key === 'Escape') {
                    setOpen(false)
                  }
                }}
                className="h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted focus-visible:outline-none"
              />
            </label>
          </div>
          <ul ref={list} id={id} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</li>}
            {shown.map((o, i) =>
              o.header ? (
                <li key={`h${i}`} className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted first:pt-1">
                  {o.label}
                </li>
              ) : (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === v}
                  aria-disabled={o.disabled}
                  data-hi={pickable[hi]?.value === o.value}
                  onMouseEnter={() => !o.disabled && setHi(pickable.indexOf(o))}
                  onClick={() => !o.disabled && choose(o)}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm ${
                    o.disabled ? 'cursor-default text-line-strong' : pickable[hi]?.value === o.value ? 'bg-paper-2 text-heading' : 'text-ink'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
                  {o.value === v && (
                    <svg aria-hidden viewBox="0 0 12 12" className="h-3.5 w-3.5 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m2.5 6.2 2.3 2.3 4.7-5" />
                    </svg>
                  )}
                </li>
              ),
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
