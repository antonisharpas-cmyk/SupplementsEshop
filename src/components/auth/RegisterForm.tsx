'use client'

/* Registration: details, then the emailed code.
 *
 * Two steps in one component because they are one task to the person doing
 * them — and because the second step needs the email from the first. Nothing
 * is created until the code checks out, so abandoning at step two leaves no
 * account behind.
 *
 * Field errors come back from the server's own validation rather than being
 * re-implemented here: one definition of "valid phone number", not two. */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { AuthCard, Field, FormError } from './Field'
import { OtpInput } from './OtpInput'
import { PasswordField } from './PasswordField'
import { button } from '@/components/ui'

type FieldErrors = Record<string, string | undefined>

/* Read in event handlers only (the lint rule cannot tell them from render). */
const clockNow = () => Date.now()

/* Zod's treeified errors nest by field; pull out the first message for each. */
function flattenFieldErrors(tree: unknown): FieldErrors {
  const out: FieldErrors = {}
  const properties = (tree as { properties?: Record<string, { errors?: string[] }> })?.properties
  if (!properties) return out
  for (const [name, node] of Object.entries(properties)) {
    if (node?.errors?.length) out[name] = node.errors[0]
  }
  return out
}

export function RegisterForm({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const base = `/${locale}`

  const [step, setStep] = useState<'details' | 'code'>('details')
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    marketingConsent: false,
  })
  const [code, setCode] = useState('')
  const [fields, setFields] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  /* When the current code stops working, by this browser's clock. */
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (step !== 'code') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])

  /* Countdown for the resend link, so the button is not offered while the
     server would refuse it anyway. */
  useEffect(() => {
    if (resendIn <= 0) return
    const id = setTimeout(() => setResendIn((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFields({})
    /* Checked here for a quick answer, and again by the server. */
    if (form.confirmPassword !== form.password) {
      setFields({ confirmPassword: t('auth.passwordMismatch') })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, locale }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
        fields?: unknown
        retryAfter?: number
        ttlSeconds?: number
      }

      if (!res.ok || !data.ok) {
        if (data.fields) setFields(flattenFieldErrors(data.fields))
        else setError(data.message ?? t('err.generic'))
        setBusy(false)
        return
      }

      setStep('code')
      setCode('')
      setNotice(null)
      setResendIn(60)
      setExpiresAt(clockNow() + (data.ttlSeconds ?? 600) * 1000)
      setNow(clockNow())
    } catch {
      setError(t('err.network'))
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e?: React.FormEvent, value = code) {
    e?.preventDefault()
    if (busy) return
    if (value.length !== 6) {
      setError(t('auth.enterCode'))
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, code: value }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }

      if (!res.ok || !data.ok) {
        setError(data.message ?? t('err.generic'))
        /* Start again from the first box rather than editing a wrong code. */
        setCode('')
        setBusy(false)
        return
      }

      router.push(`${base}/account`)
      router.refresh()
    } catch {
      setError(t('err.network'))
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, locale }),
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; retryAfter?: number; ttlSeconds?: number }
      if (!res.ok || !data.ok) setError(data.message ?? t('err.generic'))
      else {
        setCode('')
        setNotice(t('auth.codeSent'))
        setExpiresAt(clockNow() + (data.ttlSeconds ?? 600) * 1000)
        setNow(clockNow())
      }
      setResendIn(data.retryAfter ?? 60)
    } catch {
      setError(t('err.network'))
    } finally {
      setBusy(false)
    }
  }

  /* ------------------------------------------------------------- step two -- */
  if (step === 'code') {
    const left = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null
    const expired = left === 0
    const mmss = left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    return (
      <AuthCard title={t('auth.verifyTitle')} sub={t('auth.verifyBody', { email: form.email })}>
        <form onSubmit={submitCode} className="space-y-5" noValidate>
          <FormError>{expired ? null : error}</FormError>

          <OtpInput
            value={code}
            onChange={(v) => {
              setCode(v)
              if (error) setError(null)
            }}
            onComplete={(v) => {
              if (!expired) void submitCode(undefined, v)
            }}
            label={t('auth.code')}
            digitLabel={(n) => t('auth.codeDigit', { n })}
            disabled={busy || expired}
            autoFocus
          />

          <p aria-live="polite" className={`text-sm ${expired ? 'text-sale' : 'text-muted'}`}>
            {expired ? t('auth.codeExpired') : left !== null ? t('auth.codeExpiresIn', { time: mmss }) : null}
            {notice && !expired && <span className="block text-ink">{notice}</span>}
          </p>

          <button type="submit" disabled={busy || code.length !== 6 || expired} className={`${button.primary} w-full`}>
            {busy ? '…' : t('auth.verify')}
          </button>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <button
            type="button"
            onClick={resend}
            disabled={busy || resendIn > 0}
            className="text-muted underline hover:text-ink disabled:no-underline disabled:opacity-50"
          >
            {resendIn > 0 ? t('auth.resendIn', { seconds: resendIn }) : t('auth.resend')}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep('details')
              setError(null)
              setNotice(null)
              setCode('')
            }}
            className="text-muted underline hover:text-ink"
          >
            {t('auth.changeEmail')}
          </button>
        </div>
      </AuthCard>
    )
  }

  /* ------------------------------------------------------------- step one -- */
  return (
    <AuthCard title={t('auth.createAccount')}>
      <form onSubmit={submitDetails} className="space-y-5" noValidate>
        <FormError>{error}</FormError>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label={t('auth.firstName')}
            name="firstName"
            autoComplete="given-name"
            required
            value={form.firstName}
            onChange={set('firstName')}
            error={fields.firstName}
          />
          <Field
            label={t('auth.lastName')}
            name="lastName"
            autoComplete="family-name"
            required
            value={form.lastName}
            onChange={set('lastName')}
            error={fields.lastName}
          />
        </div>

        <Field
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={set('email')}
          error={fields.email}
        />

        <Field
          label={t('auth.phone')}
          name="phone"
          type="tel"
          autoComplete="tel"
          required
          value={form.phone}
          onChange={set('phone')}
          error={fields.phone}
          hint="+357 99 123456"
        />

        <PasswordField
          label={t('auth.password')}
          name="password"
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
          autoComplete="new-password"
          required
          value={form.password}
          onChange={set('password')}
          error={fields.password}
          hint={t('auth.passwordHint')}
        />

        <PasswordField
          label={t('auth.confirmPassword')}
          name="confirmPassword"
          showLabel={t('auth.showPassword')}
          hideLabel={t('auth.hidePassword')}
          autoComplete="new-password"
          required
          value={form.confirmPassword}
          onChange={(e) => {
            const value = e.target.value
            setForm((f) => ({ ...f, confirmPassword: value }))
            if (fields.confirmPassword) setFields((x) => ({ ...x, confirmPassword: undefined }))
          }}
          onBlur={() => {
            if (form.confirmPassword && form.confirmPassword !== form.password) {
              setFields((x) => ({ ...x, confirmPassword: t('auth.passwordMismatch') }))
            }
          }}
          error={fields.confirmPassword}
        />

        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={form.marketingConsent}
            onChange={(e) => setForm((f) => ({ ...f, marketingConsent: e.target.checked }))}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
          />
          <span>
            {t('auth.marketingOptIn')}
            <span className="mt-0.5 block text-xs text-muted">{t('auth.marketingNote')}</span>
          </span>
        </label>

        <button type="submit" disabled={busy} className={`${button.primary} w-full`}>
          {busy ? '…' : t('auth.createAccount')}
        </button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {t('auth.haveAccount')}{' '}
        <Link href={`${base}/sign-in`} className="text-ink underline hover:no-underline">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthCard>
  )
}
