'use client'

/* Promo code entry on the cart page.
 *
 * The field sends the code and nothing else. The discount shown next to it is
 * whatever the server recomputed after the refresh — this component never does
 * arithmetic on a price, so what the customer reads is what checkout will
 * charge. A refusal shows the server's own reason ("expired", "minimum order
 * €30"), because "invalid code" makes people retype a code that was never
 * going to work. */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

export function PromoCode({
  locale,
  appliedCode,
  error,
}: {
  locale: Locale
  appliedCode: string | null
  /** A code stored on the cart that has since stopped applying. */
  error: string | null
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [code, setCode] = useState('')
  const [message, setMessage] = useState<string | null>(error)
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()

  async function send(method: 'POST' | 'DELETE', body?: unknown) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/cart/promo', {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) {
        setMessage(data.message ?? t('err.generic'))
      } else {
        setCode('')
      }
      startTransition(() => router.refresh())
    } catch {
      setMessage(t('err.network'))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || pending

  if (appliedCode) {
    return (
      <div className="mt-5 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          {/* The summary line above already says "Promo code · −€5.52", so this
              row is only the code and the way to get rid of it. */}
          <p className="text-sm font-medium tracking-wide">{appliedCode}</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => send('DELETE')}
            className="text-xs text-muted underline hover:text-ink disabled:opacity-40"
          >
            {t('cart.removePromo')}
          </button>
        </div>
        {message && (
          <p role="alert" className="mt-2 text-xs text-sale">
            {message}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="mt-5 border-t border-line pt-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim()) void send('POST', { code: code.trim() })
      }}
    >
      <label htmlFor="promo" className="label text-muted">
        {t('cart.promoPlaceholder')}
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="promo"
          name="promo"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          placeholder={t('cart.promoPlaceholder')}
          className="min-w-0 flex-1 border border-line px-3 py-2.5 text-sm uppercase tracking-wide outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={disabled || code.trim().length < 2}
          className="btn btn-primary btn-sm"
        >
          {t('cart.applyPromo')}
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-2 text-xs text-sale">
          {message}
        </p>
      )}
    </form>
  )
}
