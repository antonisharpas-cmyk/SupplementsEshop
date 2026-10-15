'use client'

/* My details (name, phone, email language) and Change password. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOCALE_LABELS, LOCALES, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { button } from '@/components/ui'
import { PasswordField } from '@/components/auth/PasswordField'

const inputClass = (bad?: string) =>
  `mt-1.5 w-full border bg-paper px-3.5 py-3 text-[15px] outline-none focus:border-accent ${bad ? 'border-sale' : 'border-line'}`

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; fields?: Record<string, string> }
  return { ok: res.ok && Boolean(data.ok), message: data.message, fields: data.fields ?? {} }
}

export function ProfileForm({
  locale,
  initial,
}: {
  locale: Locale
  initial: { firstName: string; lastName: string; phone: string; email: string; locale: string }
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [f, setF] = useState(initial)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    const r = await send('/api/account/profile', 'PATCH', {
      firstName: f.firstName,
      lastName: f.lastName,
      phone: f.phone,
      locale: f.locale,
    })
    setBusy(false)
    setFields(r.fields)
    if (!r.ok) return setNote({ tone: 'bad', text: r.message ?? t('err.generic') })
    setNote({ tone: 'ok', text: t('acc.saved') })
    router.refresh()
  }

  return (
    <form onSubmit={save} className="grid max-w-xl gap-4 sm:grid-cols-2">
      <label className="block label text-muted">
        {t('auth.firstName')}
        <input className={inputClass(fields.firstName)} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} autoComplete="given-name" />
      </label>
      <label className="block label text-muted">
        {t('auth.lastName')}
        <input className={inputClass(fields.lastName)} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} autoComplete="family-name" />
      </label>
      <label className="block label text-muted sm:col-span-2">
        {t('auth.email')}
        <input className={`${inputClass()} opacity-60`} value={f.email} disabled />
        <span className="mt-1 block normal-case tracking-normal text-xs text-muted">{t('acc.emailLocked')}</span>
      </label>
      <label className="block label text-muted">
        {t('auth.phone')}
        <input className={inputClass(fields.phone)} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} type="tel" autoComplete="tel" />
        {fields.phone && <span className="mt-1 block normal-case tracking-normal text-xs text-sale">{fields.phone}</span>}
      </label>
      <label className="block label text-muted">
        {t('acc.language')}
        <select className={inputClass()} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-4 sm:col-span-2">
        <button className={`${button.primary}`} disabled={busy}>
          {busy ? '…' : t('acc.save')}
        </button>
        {note && <p className={`text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>{note.text}</p>}
      </div>
    </form>
  )
}

export function PasswordForm({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNote(null)
    const r = await send('/api/account/password', 'POST', { currentPassword: current, newPassword: next })
    setBusy(false)
    setFields(r.fields)
    if (!r.ok) return setNote({ tone: 'bad', text: r.message ?? t('err.generic') })
    setCurrent('')
    setNext('')
    setNote({ tone: 'ok', text: t('acc.passwordChanged') })
  }

  return (
    <form onSubmit={save} className="max-w-md space-y-4">
      <PasswordField
        label={t('acc.currentPassword')}
        name="currentPassword"
        showLabel={t('auth.showPassword')}
        hideLabel={t('auth.hidePassword')}
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={fields.currentPassword}
      />
      <PasswordField
        label={t('acc.newPassword')}
        name="newPassword"
        showLabel={t('auth.showPassword')}
        hideLabel={t('auth.hidePassword')}
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={fields.newPassword}
        hint={t('auth.passwordHint')}
      />
      <div className="flex items-center gap-4">
        <button className={button.secondary} disabled={busy || !current || !next}>
          {busy ? '…' : t('acc.changePassword')}
        </button>
        {note && <p className={`text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>{note.text}</p>}
      </div>
    </form>
  )
}
