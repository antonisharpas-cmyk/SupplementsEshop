'use client'

import { useState } from 'react'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { button } from '@/components/ui'

export function SmsStopForm({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const [phone, setPhone] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setState('sending')
    const res = await fetch('/api/sms/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).catch(() => null)
    if (res?.ok) {
      setState('done')
    } else {
      const data = (await res?.json().catch(() => null)) as { message?: string } | null
      setError(res?.status === 429 ? (data?.message ?? t('sms.invalid')) : t('sms.invalid'))
      setState('idle')
    }
  }

  if (state === 'done') {
    return <p className="mt-8 rounded-2xl border border-ok/40 bg-ok/10 px-5 py-4 text-sm text-ink">{t('sms.stopped')}</p>
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <label className="block text-sm">
        <span className="label">{t('sms.phone')}</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+357 99 123456"
          className={`mt-1.5 w-full border bg-paper px-3.5 py-3 text-[15px] outline-none ${error ? 'border-sale' : 'border-line'}`}
          required
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-sale">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === 'sending' || phone.trim().length < 6} className={`${button.primary} w-full`}>
        {state === 'sending' ? '…' : t('sms.stopButton')}
      </button>
    </form>
  )
}
