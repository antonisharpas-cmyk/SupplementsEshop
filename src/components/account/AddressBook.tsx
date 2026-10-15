'use client'

/* The customer's saved addresses: add, edit, make default, delete. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { button } from '@/components/ui'

export type Address = {
  id: string
  label: string | null
  recipientName: string
  phone: string
  line1: string
  line2: string | null
  city: string
  postalCode: string
  country: string
  isDefault: boolean
}

type Draft = Omit<Address, 'id' | 'isDefault' | 'label' | 'line2'> & { label: string; line2: string }

const blank = (name: string, phone: string): Draft => ({
  label: '',
  recipientName: name,
  phone,
  line1: '',
  line2: '',
  city: '',
  postalCode: '',
  country: 'CY',
})

const inputClass = (bad?: string) =>
  `mt-1.5 w-full border bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent ${bad ? 'border-sale' : 'border-line'}`

function AddressForm({
  locale,
  initial,
  onDone,
  id,
}: {
  locale: Locale
  initial: Draft
  onDone: () => void
  id?: string
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [d, setD] = useState(initial)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setFields({})
    const res = await fetch(id ? `/api/account/addresses/${id}` : '/api/account/addresses', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; fields?: Record<string, string> }
    setBusy(false)
    if (!res.ok || !data.ok) {
      setFields(data.fields ?? {})
      return setError(data.message ?? t('err.generic'))
    }
    onDone()
    router.refresh()
  }

  const f = (key: keyof Draft, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-xs text-muted">
      {label}
      <input className={inputClass(fields[key])} value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} {...extra} />
      {fields[key] && <span className="mt-1 block text-sale">{fields[key]}</span>}
    </label>
  )

  return (
    <form onSubmit={save} className="grid gap-4 border border-line bg-paper-2 p-5 sm:grid-cols-2">
      {f('label', t('acc.label'))}
      {f('recipientName', t('co.recipient'), { autoComplete: 'name' })}
      {f('phone', t('auth.phone'), { type: 'tel', autoComplete: 'tel' })}
      {f('line1', t('co.line1'), { autoComplete: 'address-line1' })}
      {f('line2', t('co.line2'), { autoComplete: 'address-line2' })}
      {f('city', t('co.city'), { autoComplete: 'address-level2' })}
      {f('postalCode', t('co.postalCode'), { autoComplete: 'postal-code', inputMode: 'numeric' })}
      {error && <p className="text-sm text-sale sm:col-span-2">{error}</p>}
      <div className="flex gap-3 sm:col-span-2">
        <button className={`${button.primary}`} disabled={busy}>
          {busy ? '…' : t('acc.save')}
        </button>
        <button type="button" className={button.quiet} onClick={onDone}>
          {t('acc.cancel')}
        </button>
      </div>
    </form>
  )
}

export function AddressBook({ locale, items, name, phone }: { locale: Locale; items: Address[]; name: string; phone: string }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  async function act(id: string, method: 'PATCH' | 'DELETE') {
    if (method === 'DELETE' && !window.confirm(t('acc.deleteConfirm'))) return
    await fetch(`/api/account/addresses/${id}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'PATCH' ? JSON.stringify({ isDefault: true }) : undefined,
    })
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {items.length === 0 && editing !== 'new' && <p className="text-sm text-muted">{t('acc.noAddresses')}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((a) =>
          editing === a.id ? (
            <li key={a.id} className="sm:col-span-2">
              <AddressForm
                locale={locale}
                id={a.id}
                initial={{ ...a, label: a.label ?? '', line2: a.line2 ?? '' }}
                onDone={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={a.id} className={`border p-5 ${a.isDefault ? 'border-accent' : 'border-line'} bg-paper-2`}>
              <p className="flex items-center gap-2 text-sm font-medium text-heading">
                {a.label || a.recipientName}
                {a.isDefault && <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-black">{t('acc.default')}</span>}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {[a.recipientName, a.line1, a.line2, `${a.postalCode} ${a.city}`, a.phone].filter(Boolean).map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-xs">
                <button type="button" className="label text-muted hover:text-ink" onClick={() => setEditing(a.id)}>
                  {t('acc.edit')}
                </button>
                {!a.isDefault && (
                  <button type="button" className="label text-muted hover:text-ink" onClick={() => void act(a.id, 'PATCH')}>
                    {t('acc.makeDefault')}
                  </button>
                )}
                <button type="button" className="label text-sale hover:underline" onClick={() => void act(a.id, 'DELETE')}>
                  {t('acc.delete')}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <AddressForm locale={locale} initial={blank(name, phone)} onDone={() => setEditing(null)} />
      ) : (
        items.length < 10 && (
          <button type="button" className={button.secondary} onClick={() => setEditing('new')}>
            + {t('acc.addAddress')}
          </button>
        )
      )}
    </div>
  )
}
