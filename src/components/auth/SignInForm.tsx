'use client'

/* Sign-in form.
 *
 * The server decides everything; this only collects two fields and shows what
 * came back. Note there is no "we don't know that email" message — the server
 * deliberately gives one answer for a wrong address and a wrong password, and
 * the UI must not undo that by being more helpful. */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { AuthCard, Field, FormError } from './Field'
import { PasswordField } from './PasswordField'
import { button } from '@/components/ui'

export function SignInForm({ locale, next }: { locale: Locale; next?: string }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const base = `/${locale}`

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }

      if (!res.ok || !data.ok) {
        setError(data.message ?? t('err.generic'))
        setBusy(false)
        return
      }

      /* refresh() so the header picks up the session on the next render. */
      router.push(safeNext(next) ?? `${base}/account`)
      router.refresh()
    } catch {
      setError(t('err.network'))
      setBusy(false)
    }
  }

  return (
    <AuthCard title={t('auth.signIn')}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FormError>{error}</FormError>

        <Field
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <PasswordField
          label={t('auth.password')}
          name="password"
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <p className="-mt-2 text-right text-sm">
          <Link href={`${base}/forgot-password`} className="text-muted underline hover:text-ink">
            {t('auth.forgotPassword')}
          </Link>
        </p>

        <button type="submit" disabled={busy} className={`${button.primary} w-full`}>
          {busy ? '…' : t('auth.signIn')}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {t('auth.noAccount')}{' '}
        <Link href={`${base}/register`} className="text-ink underline hover:no-underline">
          {t('auth.createAccount')}
        </Link>
      </p>
    </AuthCard>
  )
}

/** Only a path on this site: "/en/cart" yes; "//evil.com", "/\\evil.com" or
 *  "https://…" no, so a link cannot send someone elsewhere after signing in. */
function safeNext(next: string | null | undefined): string | null {
  if (!next || !/^\/(?![/\\])/.test(next)) return null
  try {
    const u = new URL(next, window.location.origin)
    return u.origin === window.location.origin ? `${u.pathname}${u.search}${u.hash}` : null
  } catch {
    return null
  }
}
