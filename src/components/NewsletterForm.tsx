'use client'

/* ============================================================================
 * "Get first access to new drops" — the sign-up form.
 *
 * An invitation, never a gate: nothing pops up, nothing blocks the page. The
 * consent box starts unticked and the button refuses without it — and so does
 * the server, which is the check that counts.
 *
 * After sending, the form says "check your inbox" for every valid address,
 * including ones already on the list: saying "you're already subscribed"
 * would tell anyone typing an address whether that person shops here.
 * ========================================================================== */

import Link from 'next/link'
import { useId, useState } from 'react'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

type State = 'idle' | 'sending' | 'done'

export function NewsletterForm({
  locale,
  source,
  tone = 'light',
}: {
  locale: Locale
  source: 'homepage' | 'footer' | 'newsletter_page' | 'help'
  /** `dark` for use on an ink background. */
  tone?: 'light' | 'dark'
}) {
  const t = getTranslator(locale)
  const id = useId()
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)

  const dark = tone === 'dark'
  const field = `w-full border px-4 py-3.5 text-sm outline-none transition-colors ${
    dark
      ? 'border-paper/20 bg-white/60 text-paper placeholder:text-paper/45 shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur-sm focus:border-paper focus:bg-white/80'
      : 'border-line bg-paper text-ink placeholder:text-muted focus:border-accent'
  }`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('news.invalidEmail'))
    if (!consent) return setError(t('news.consentRequired'))

    setState('sending')
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), firstName: firstName.trim() || null, consent, locale, source, website }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (res.ok && data.ok) {
        setState('done')
        return
      }
      setState('idle')
      setError(
        data.error === 'RATE_LIMITED'
          ? t('news.tooMany')
          : data.error === 'CONSENT_REQUIRED'
            ? t('news.consentRequired')
            : data.error === 'INVALID_EMAIL'
              ? t('news.invalidEmail')
              : t('support.sendFailed'),
      )
    } catch {
      setState('idle')
      setError(t('support.sendFailed'))
    }
  }

  if (state === 'done') {
    return (
      <p role="status" className={`border px-5 py-4 text-sm leading-relaxed ${dark ? 'border-paper/30' : 'border-line bg-paper'}`}>
        <span aria-hidden className="mr-2">✓</span>
        {t('news.checkInbox', { email: email.trim() })}
      </p>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
        <label className="block">
          <span className="sr-only">{t('news.email')}</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('news.email')}
            aria-invalid={error === t('news.invalidEmail')}
            aria-describedby={error ? `${id}-error` : undefined}
            className={field}
          />
        </label>
        <label className="block">
          <span className="sr-only">{t('news.firstName')}</span>
          <input
            type="text"
            autoComplete="given-name"
            maxLength={80}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder={t('news.firstName')}
            className={field}
          />
        </label>
      </div>

      {/* Honeypot: hidden from people and from screen readers; bots fill it. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] h-px w-px opacity-0"
      />

      <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className={`mt-1 h-4 w-4 shrink-0 ${dark ? 'accent-[var(--color-paper)]' : 'accent-[var(--color-accent)]'}`}
        />
        <span className={dark ? 'text-paper/80' : 'text-ink-soft'}>
          {t('news.consent')}{' '}
          <Link href={`/${locale}/privacy`} className="underline underline-offset-2">
            {t('news.privacy')}
          </Link>
        </span>
      </label>

      {error && (
        <p id={`${id}-error`} role="alert" className={`text-sm ${dark ? 'text-paper' : 'text-sale'}`}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === 'sending'}
        className={`btn w-full sm:w-auto ${dark ? 'btn-dark' : 'btn-primary'}`}
      >
        {state === 'sending' ? t('news.sending') : t('news.submit')}
      </button>
    </form>
  )
}
