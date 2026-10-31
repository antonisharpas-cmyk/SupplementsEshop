/* Shared primitives. Server-safe — no hooks, no client directive. */

import Link from 'next/link'
import type { ReactNode } from 'react'

export const button = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  quiet: 'btn btn-ghost btn-sm',
}

export function Price({
  listCents,
  finalCents,
  locale = 'en',
  currency = 'EUR',
  size = 'base',
}: {
  listCents: number
  finalCents: number
  locale?: string
  currency?: string
  size?: 'sm' | 'base' | 'lg'
}) {
  const fmt = (c: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(c / 100)

  const discounted = finalCents < listCents
  const scale =
    size === 'lg' ? 'text-xl' : size === 'sm' ? 'text-[13px]' : 'text-[15px]'

  return (
    <span className={`flex items-baseline gap-2 ${scale}`}>
      <span className={discounted ? 'font-semibold text-sale' : 'font-medium'}>
        {fmt(finalCents)}
      </span>
      {discounted && (
        <span className="text-[0.85em] text-muted line-through">{fmt(listCents)}</span>
      )}
    </span>
  )
}

export function Badge({
  children,
  tone = 'ink',
}: {
  children: ReactNode
  tone?: 'ink' | 'sale' | 'muted'
}) {
  const tones = {
    ink: 'bg-accent text-paper',
    sale: 'bg-sale text-white',
    muted: 'bg-paper-2 text-ink-soft border border-line',
  }
  return <span className={`label px-2 py-1 ${tones[tone]}`}>{children}</span>
}

export function SectionHead({
  title,
  sub,
  href,
  hrefLabel,
}: {
  title: string
  sub?: string
  href?: string
  hrefLabel?: string
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-[clamp(1.4rem,3vw,2rem)] font-semibold tracking-tight">{title}</h2>
        {sub && <p className="mt-1.5 text-sm text-muted">{sub}</p>}
      </div>
      {href && hrefLabel && (
        <Link href={href} className="label border-b border-ink pb-0.5 hover:text-ink-soft">
          {hrefLabel}
        </Link>
      )}
    </div>
  )
}

/** Fixed-ratio image frame. Fashion product shots are portrait 3:4, and a
 *  consistent frame stops the grid jumping as images load. */
export function ProductImage({
  src,
  alt,
  priority = false,
  className = '',
}: {
  src: string | null
  alt: string
  priority?: boolean
  className?: string
}) {
  return (
    <div className={`relative aspect-3/4 overflow-hidden bg-paper-2 ${className}`}>
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element -- the seed uses
           inline SVG data URIs, which next/image cannot optimise. Swap to
           next/image once real photography is uploaded to a CDN. */
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          /* contain, not cover: a pack photo is shown whole, never cut at
             the sides, whatever its shape. */
          className="h-full w-full object-contain p-3 transition-transform duration-500 hover:scale-[1.03]"
        />
      ) : (
        <div className="grid h-full place-items-center text-muted label">No image</div>
      )}
    </div>
  )
}
