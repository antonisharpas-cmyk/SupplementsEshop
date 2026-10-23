'use client'

/* On a purchase: receive the goods, undo that, mark paid, delete a draft. */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useState } from 'react'
import Link from 'next/link'
import { btn, input } from '@/components/admin/ui'
import { PAY_METHODS, todayIso, useApi } from './shared'

export function PurchaseActions({ id, status, paid, finance }: { id: string; status: string; paid: boolean; finance: boolean }) {
  const { busy, msg, call, router } = useApi()
  const [on, setOn] = useState(todayIso())
  const [method, setMethod] = useState('bank')
  const act = (a: string, body?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    void call(`/api/admin/finance/purchases/${id}/${a}`, 'POST', body ?? {})
  }
  return (
    <div className="flex flex-wrap items-end gap-3">
      {status === 'DRAFT' && (
        <>
          <button type="button" className={btn.primary} disabled={busy} onClick={() => act('receive', undefined, 'The goods arrived? This adds them to stock.')}>
            Receive the goods
          </button>
          {finance && (
            <>
              <Link href={`/admin/purchases/${id}?edit=1`} className={btn.secondary}>
                Edit
              </Link>
              <button
                type="button"
                className={btn.quiet}
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm('Delete this draft?')) return
                  const ok = await call(`/api/admin/finance/purchases/${id}`, 'DELETE', undefined, { refresh: false })
                  if (ok) router.push('/admin/purchases')
                }}
              >
                Delete draft
              </button>
            </>
          )}
        </>
      )}
      {status === 'RECEIVED' && finance && (
        <button type="button" className={btn.secondary} disabled={busy} onClick={() => act('undo', undefined, 'Take this purchase back to draft? Its stock comes back out, so you can fix it and receive it again.')}>
          Undo receive (to fix a mistake)
        </button>
      )}
      {finance &&
        (paid ? (
          <button type="button" className={btn.quiet} disabled={busy} onClick={() => act('unpaid')}>
            Mark as not paid
          </button>
        ) : (
          <span className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-muted">
              Paid on
              <DateTimeField mode="date" clearable={false} value={on} onChange={(v) => setOn(v)} className="mt-1" />
            </label>
            <label className="block text-xs text-muted">
              By
              <select className={`${input} mt-1 !py-2`} value={method} onChange={(e) => setMethod(e.target.value)}>
                {PAY_METHODS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => act('paid', { on, method })}>
              Mark as paid
            </button>
          </span>
        ))}
      {msg && <span className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
    </div>
  )
}
