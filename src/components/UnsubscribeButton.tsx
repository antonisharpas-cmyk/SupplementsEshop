'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

export function UnsubscribeButton({ locale, token }: { locale: Locale; token: string }) {
  const t = getTranslator(locale)
  const [state, setState] = useState<'ask' | 'sending' | 'done' | 'invalid'>(token ? 'ask' : 'invalid')

  async function go() {
    setState('sending')
    try {
      const res = await fetch('/api/newsletter/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setState(res.ok ? 'done' : 'invalid')
    } catch {
      setState('ask')
    }
  }

  const title =
    state === 'done' ? t('news.unsubscribedTitle') : state === 'invalid' ? t('news.linkInvalidTitle') : t('news.unsubscribeTitle')
  const body =
    state === 'done' ? t('news.unsubscribedBody') : state === 'invalid' ? t('help.a5') : t('news.unsubscribeBody')

  return (
    <div role={state === 'done' ? 'status' : undefined}>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="mt-3 text-ink-soft">{body}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {(state === 'ask' || state === 'sending') && (
          <button
            type="button"
            onClick={() => void go()}
            disabled={state === 'sending'}
            className="btn btn-primary"
          >
            {state === 'sending' ? t('news.unsubscribing') : t('news.unsubscribeButton')}
          </button>
        )}
        <Link href={`/${locale}`} className="btn btn-ghost">
          {state === 'ask' ? t('news.keep') : t('news.backToShop')}
        </Link>
      </div>
    </div>
  )
}
