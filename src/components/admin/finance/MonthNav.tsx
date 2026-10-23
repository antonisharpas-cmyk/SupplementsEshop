/* Previous month, this month, next month, all: links that keep the other filters. */

import Link from 'next/link'
import { withParams } from '@/components/admin/ui'

const name = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`))
const shift = (m: string, n: number) => {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 1 + n, 15))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** This month in Cyprus, worked out outside render. */
export function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' }).format(new Date()).slice(0, 7)
}

export function MonthNav({ base, params, month, allowAll = true }: { base: string; params: Record<string, string | undefined>; month: string | null; allowAll?: boolean }) {
  const now = thisMonth()
  const current = month ?? now
  const pill = (on: boolean) =>
    `inline-flex items-center rounded-full border px-4 py-2 text-sm transition-colors ${on ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'}`
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Link href={withParams(base, params, { month: shift(current, -1), all: null })} className={pill(false)} aria-label="Previous month">
        ←
      </Link>
      <span className={pill(Boolean(month))}>{month ? name(month) : 'All months'}</span>
      <Link href={withParams(base, params, { month: shift(current, 1), all: null })} className={pill(false)} aria-label="Next month">
        →
      </Link>
      {month !== now && (
        <Link href={withParams(base, params, { month: now, all: null })} className={pill(false)}>
          This month
        </Link>
      )}
      {allowAll && month && (
        <Link href={withParams(base, params, { month: null, all: '1' })} className={pill(false)}>
          All months
        </Link>
      )}
    </div>
  )
}
