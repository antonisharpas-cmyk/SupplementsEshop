/* Small shared pieces for the admin screens. Server-safe: no hooks. */

import Link from 'next/link'
import { PagedTable } from './Paged'
import type { ReactNode } from 'react'

export function PageHead({
  title,
  sub,
  action,
}: {
  title: string
  sub?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  )
}

export function Stat({
  label,
  value,
  tone = 'plain',
  href,
}: {
  label: string
  value: ReactNode
  tone?: 'plain' | 'warn' | 'bad'
  href?: string
}) {
  const body = (
    <div
      className={`rounded-2xl border bg-paper-2/60 p-5 transition-colors ${
        tone === 'bad'
          ? 'border-sale/50'
          : tone === 'warn'
            ? 'border-amber-500/50'
            : 'border-line'
      } ${href ? 'hover:border-ink' : ''}`}
    >
      <p className="label text-muted">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold tabular-nums ${
          tone === 'bad' ? 'text-sale' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

/** The admin table. Long tables show 15 rows at a time with page buttons
 *  (see Paged.tsx); `size` changes that. */
export function Table({ head, children, rightFrom, size }: { head: string[]; children: ReactNode; rightFrom?: number; size?: number }) {
  return (
    <PagedTable head={head} rightFrom={rightFrom} size={size}>
      {children}
    </PagedTable>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'off'; children: ReactNode }) {
  const tones = {
    ok: 'bg-ok/10 text-ok',
    warn: 'bg-amber-500/15 text-amber-700',
    bad: 'bg-sale/10 text-sale',
    off: 'bg-paper-2 text-muted',
  }
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 label ${tones[tone]}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paper px-6 py-16 text-center text-sm text-muted">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------ buttons -- */

/** Class strings rather than components, so a <Link>, a <button> and a
 *  <form> submit all look the same without three wrappers. */
export const btn = {
  primary: 'btn btn-primary btn-sm',
  secondary: 'btn btn-secondary btn-sm',
  quiet:
    'inline-flex items-center gap-1.5 text-sm font-medium text-muted underline-offset-4 transition-colors hover:text-accent hover:underline',
  danger: 'btn btn-danger btn-sm',
}

export const input =
  'w-full rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent'

/* ------------------------------------------------------------- status -- */

export type ProductStatusValue = 'available' | 'sold_out' | 'hidden'

/** The owner's decision about a product, in words and shape — never colour
 *  alone, so it reads the same to someone who cannot tell red from green. */
export function StatusBadge({ status }: { status: ProductStatusValue }) {
  if (status === 'hidden')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-paper-2 px-2 py-1 label text-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-muted" />
        Hidden
      </span>
    )
  if (status === 'sold_out')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2 py-1 label text-paper">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-paper" />
        Sold out
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-ok/10 px-2 py-1 label text-ok">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
      Available
    </span>
  )
}

/** What the shelf says, for one number of units. */
export function StockCount({ available, low }: { available: number; low: number }) {
  if (available <= 0) return <Pill tone="bad">None left</Pill>
  if (available <= low)
    return (
      <span className="inline-flex items-center gap-1.5 tabular-nums text-amber-700">
        <span aria-hidden>▲</span>
        {available} <span className="sr-only">— running low</span>
      </span>
    )
  return <span className="tabular-nums">{available}</span>
}

/* ------------------------------------------------------------- pieces -- */

/** A product photo at list size. Fixed box, so rows never jump as images
 *  load; a quiet placeholder when there is no photo yet. */
export function Thumb({ src, alt, size = 'md' }: { src: string | null; alt: string; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-12 w-9' : 'h-16 w-12'
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size list thumbnails; next/image adds nothing here
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${box} shrink-0 bg-paper-2 object-cover`}
    />
  ) : (
    <span
      aria-label="No photo yet"
      className={`${box} flex shrink-0 items-center justify-center bg-paper-2 text-[10px] text-muted`}
    >
      —
    </span>
  )
}

/* The swatch colour for a colour name, when a variant has no hex stored. */
const NAMED: Record<string, string> = {
  black: '#111111', white: '#ffffff', ivory: '#f4efe4', cream: '#f1ead8', ecru: '#e9e1cf',
  grey: '#9a9a9a', gray: '#9a9a9a', charcoal: '#3b3b3b', navy: '#1f2a44', blue: '#3a5a8c',
  sand: '#d8c7a6', stone: '#c9c1b1', taupe: '#8b7d6b', brown: '#6b4a32', olive: '#6b6b3a',
  green: '#3e6b48', sage: '#a3b09a', red: '#a3262a', burgundy: '#6a1f2b', pink: '#e7b8c0',
  beige: '#dccbb0', camel: '#b98a55', khaki: '#a89a6e',
}

export function Swatch({ name, hex }: { name: string | null; hex: string | null }) {
  const colour = hex ?? (name ? NAMED[name.trim().toLowerCase().split(/\s+/).pop() ?? ''] : undefined)
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-full border border-line-strong"
        style={{ background: colour ?? 'repeating-linear-gradient(45deg,#ddd 0 2px,#fff 2px 4px)' }}
      />
      <span>{name ?? 'One flavour'}</span>
    </span>
  )
}

/** Previous / next with the page number, keeping every other filter. */
export function Pagination({
  page,
  pages,
  total,
  noun,
  href,
}: {
  page: number
  pages: number
  total: number
  noun: [string, string]
  href: (page: number) => string
}) {
  if (pages <= 1) return null
  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4 text-sm">
      <span className="text-muted">
        Page {page} of {pages} · {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={btn.secondary} rel="prev">
            ← Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={btn.secondary} rel="next">
            Next →
          </Link>
        ) : null}
      </span>
    </nav>
  )
}

/** Keep every current query parameter, change some, drop empties. */
export function withParams(
  path: string,
  current: Record<string, string | string[] | undefined>,
  changes: Record<string, string | number | null | undefined>,
) {
  const next = new URLSearchParams()
  for (const [k, v] of Object.entries(current)) {
    const value = Array.isArray(v) ? v.join(',') : v
    if (value) next.set(k, value)
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined || v === '') next.delete(k)
    else next.set(k, String(v))
  }
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
