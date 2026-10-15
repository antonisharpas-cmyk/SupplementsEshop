'use client'

/* Forgot password, in two steps on one screen: the email, then the code from
   the email with a new password. */

import { useState } from 'react'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { AuthCard, Field, FormError } from './Field'
import { PasswordField } from './PasswordField'
import { button } from '@/components/ui'

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const base = `/${locale}`
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function post(url: string, body: unknown) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { res, data: (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; fields?: Record<string, string> } }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { res, data } = await post('/api/auth/password-reset', { email })
      if (!res.ok || !data.ok) setError(data.message ?? t('err.generic'))
      else setStep('code')
    } catch {
      setError(t('err.network'))
    }
    setBusy(false)
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    try {
      const { res, data } = await post('/api/auth/password-reset/confirm', { email, code, password })
      if (!res.ok || !data.ok) {
        setFields(data.fields ?? {})
        setError(data.message ?? t('err.generic'))
      } else setStep('done')
    } catch {
      setError(t('err.network'))
    }
    setBusy(false)
  }

  return (
    <AuthCard title={t('fp.title')} sub={step === 'email' ? t('fp.body') : step === 'code' ? t('fp.sent', { email }) : undefined}>
      {step === 'email' && (
        <form onSubmit={sendCode} className="space-y-5" noValidate>
          <FormError>{error}</FormError>
          <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" disabled={busy} className={`${button.primary} w-full`}>
            {busy ? '…' : t('fp.send')}
          </button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={reset} className="space-y-5" noValidate>
          <FormError>{error}</FormError>
          <Field label={t('fp.code')} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fields.code} />
          <PasswordField
            label={t('acc.newPassword')}
            name="password"
            showLabel={t('auth.showPassword')}
            hideLabel={t('auth.hidePassword')}
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="-mt-3 text-xs text-muted">{t('auth.passwordHint')}</p>
          <button type="submit" disabled={busy} className={`${button.primary} w-full`}>
            {busy ? '…' : t('fp.reset')}
          </button>
        </form>
      )}
      {step === 'done' && (
        <p role="status" className="border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">
          {t('fp.done')}
        </p>
      )}
      <p className="mt-6 text-sm">
        <Link href={`${base}/sign-in`} className="text-muted underline hover:text-ink">
          {t('fp.backToSignIn')}
        </Link>
      </p>
    </AuthCard>
  )
}
