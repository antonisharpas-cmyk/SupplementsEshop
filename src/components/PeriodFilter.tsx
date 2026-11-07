/* The period buttons and a from/to date picker. Works without JavaScript:
   the buttons are links, the dates a plain GET form. Server component. */

import Link from 'next/link'
import { PERIODS, type PeriodKey } from '@/lib/period'

const WORDS = {
  en: { from: 'From', to: 'To', show: 'Show' },
  el: { from: 'Από', to: 'Έως', show: 'Εμφάνιση' },
  ru: { from: 'С', to: 'По', show: 'Показать' },
}

export function PeriodFilter({
  path,
  period,
  locale = 'en',
}: {
  path: string
  period: { key: PeriodKey; from: string | null; to: string | null }
  locale?: 'en' | 'el' | 'ru'
}) {
  const w = WORDS[locale]
  return (
    <div className="mb-6 flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={p.key === 'this_month' ? path : `${path}?period=${p.key}`}
            className={`rounded-full border px-4 py-2 text-sm transition-colors ${
              period.key === p.key ? 'border-transparent bg-accent font-medium text-black' : 'border-line hover:border-ink'
            }`}
          >
            {p.label[locale]}
          </Link>
        ))}
      </div>
      <form action={path} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{w.from}</span>
          <input type="date" name="from" defaultValue={period.from ?? ''} className="rounded-xl border border-line bg-paper px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{w.to}</span>
          <input type="date" name="to" defaultValue={period.to ?? ''} className="rounded-xl border border-line bg-paper px-3 py-2" />
        </label>
        <button type="submit" className={`btn btn-sm ${period.key === 'custom' ? 'btn-primary' : 'btn-secondary'}`}>
          {w.show}
        </button>
      </form>
    </div>
  )
}
