'use client'

/* "Notify me when it's back", under the sizes on the product page. Shown when
   the chosen flavour has sizes that are sold out; the customer picks the size
   (when there is more than one) and leaves their email. Signed in, the email
   is already filled with the account's, and can still be changed. */

import { useState } from 'react'
import { getTranslator } from '@/i18n/messages'
import type { Locale } from '@/config/brand'

type Option = { id: string; size: string }

export function NotifyMe({ locale, options, signedInEmail }: { locale: Locale; options: Option[]; signedInEmail?: string | null }) {
  const t = getTranslator(locale)
  const [chosen, setChosen] = useState<string>('')
  const [email, setEmail] = useState(signedInEmail ?? '')
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  if (options.length === 0) return null
  const variantId = options.some((o) => o.id === chosen) ? chosen : options[0].id
  const size = options.find((o) => o.id === variantId)?.size ?? ''

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stock-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, locale, email, website }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && data.ok) setDone((d) => ({ ...d, [variantId]: true }))
      else setError(data.error === 'IN_STOCK' ? t('pdp.notifyInStock') : data.error === 'RATE_LIMITED' ? t('pdp.notifyLater') : t('pdp.notifyError'))
    } catch {
      setError(t('err.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={send} className="mt-5 rounded-2xl border border-line bg-paper-2 p-4">
      <p className="text-sm font-semibold text-heading">{t('pdp.notifyTitle')}</p>
      <p className="mt-1 text-xs text-muted">{t('pdp.notifyText', { size })}</p>

      {done[variantId] ? (
        <p className="mt-3 text-sm text-ok" role="status">
          {t('pdp.notifyDone')}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {options.length > 1 && (
            <select
              aria-label={t('pdp.selectSize')}
              value={variantId}
              onChange={(e) => setChosen(e.target.value)}
              className="h-11 rounded-full border border-line bg-paper px-4 text-sm"
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.size}
                </option>
              ))}
            </select>
          )}
          <input
            type="email"
            required
            autoComplete="email"
            placeholder={t('pdp.notifyEmail')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 min-w-0 flex-1 rounded-full border border-line bg-paper px-4 text-sm"
          />
          {/* Real people never see this field; bots fill it. */}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <button type="submit" disabled={busy} className="btn btn-secondary h-11">
            {t('pdp.notifyButton')}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-sale">{error}</p>}
    </form>
  )
}
