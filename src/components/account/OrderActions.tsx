'use client'

/* The buttons on an order: pay now (an unpaid card order), cancel (before the
   shop has started on it), and buy again. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { button } from '@/components/ui'
import { announceBagCount } from '@/lib/bag-events'

export function OrderActions({
  locale,
  orderNumber,
  token,
  canPay,
  canCancel,
  canReorder,
}: {
  locale: Locale
  orderNumber: string
  token?: string
  canPay: boolean
  canCancel: boolean
  canReorder: boolean
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  async function post(path: string, body: unknown) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; url?: string; added?: number; missed?: string[]; cartCount?: number }
  }

  async function pay() {
    setBusy('pay')
    const data = await post(`/api/orders/${orderNumber}/pay`, { token })
    if (data.ok && data.url) return window.location.assign(data.url)
    setBusy(null)
    setNote({ tone: 'bad', text: data.message ?? t('ord.paymentFailed') })
  }

  async function cancel() {
    if (!window.confirm(t('ord.cancelConfirm'))) return
    setBusy('cancel')
    const data = await post(`/api/orders/${orderNumber}/cancel`, { token })
    setBusy(null)
    if (!data.ok) return setNote({ tone: 'bad', text: data.message ?? t('err.generic') })
    setNote({ tone: 'ok', text: t('ord.cancelled') })
    router.refresh()
  }

  async function reorder() {
    setBusy('reorder')
    const data = await post('/api/account/reorder', { orderNumber })
    setBusy(null)
    if (!data.ok) return setNote({ tone: 'bad', text: data.message ?? t('err.generic') })
    announceBagCount(data.cartCount)
    const missed = data.missed?.length ? ` ${t('ord.reorderMissed', { items: data.missed.join(', ') })}` : ''
    setNote({ tone: 'ok', text: `${t('ord.reordered')}${missed}` })
    if ((data.added ?? 0) > 0) router.push(`/${locale}/cart`)
  }

  if (!canPay && !canCancel && !canReorder) return null
  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-3">
        {canPay && (
          <button type="button" className={`${button.primary}`} onClick={() => void pay()} disabled={busy !== null}>
            {busy === 'pay' ? '…' : t('co.payNow')}
          </button>
        )}
        {canReorder && (
          <button type="button" className={button.secondary} onClick={() => void reorder()} disabled={busy !== null}>
            {busy === 'reorder' ? '…' : t('ord.reorder')}
          </button>
        )}
        {canCancel && (
          <button type="button" className={button.quiet} onClick={() => void cancel()} disabled={busy !== null}>
            {busy === 'cancel' ? '…' : t('ord.cancel')}
          </button>
        )}
      </div>
      {note && (
        <p role="status" className={`mt-3 text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>
          {note.text}
        </p>
      )}
    </div>
  )
}
