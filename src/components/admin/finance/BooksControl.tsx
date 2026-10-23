'use client'

/* The accountant's month: download the pack, close the month so nothing in
   it changes after it was sent, or reopen it. */

import { MonthField } from '@/components/admin/DateTimeField'
import { useState } from 'react'
import { btn } from '@/components/admin/ui'
import { useApi } from './shared'

const name = (m: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-15T12:00:00Z`))

export function BooksControl({ closedThrough, lastMonth }: { closedThrough: string; lastMonth: string }) {
  const { busy, msg, call } = useApi()
  const [month, setMonth] = useState(lastMonth)
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block text-xs text-muted">
        Month
        <MonthField value={month} onChange={(v) => setMonth(v)} className="mt-1" />
      </label>
      <a href={`/api/admin/finance/pack?month=${month}`} className={btn.primary}>
        Download the accountant pack
      </a>
      {closedThrough && month <= closedThrough ? (
        <button
          type="button"
          className={btn.secondary}
          disabled={busy}
          onClick={() => {
            const [y, m] = month.split('-').map(Number)
            const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
            if (window.confirm(`Reopen ${name(month)}${month < closedThrough ? ' and every month after it' : ''}? Records in it can then be changed again.`)) {
              void call('/api/admin/finance/books', 'PUT', { closedThrough: prev < '2000-01' ? '' : prev })
            }
          }}
        >
          Reopen
        </button>
      ) : (
        <button
          type="button"
          className={btn.secondary}
          disabled={busy}
          onClick={() => window.confirm(`Close ${name(month)} and every month before it? Purchases, expenses and wholesale sales in them can no longer be added or changed.`) && void call('/api/admin/finance/books', 'PUT', { closedThrough: month })}
        >
          Close the month
        </button>
      )}
      <span className="pb-2 text-xs text-muted">{closedThrough ? `Closed up to and including ${name(closedThrough)}.` : 'No month is closed yet.'}</span>
      {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
    </div>
  )
}
