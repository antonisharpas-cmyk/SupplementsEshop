'use client'

/* Admin → Customer Service → "Automatic first reply": the message the
   customer sees straight after their first one. On/off and the words in
   English, Greek and Russian; English stands in for an empty language. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

type Values = { enabled: boolean; en: string; el: string; ru: string }
const LANGS = [
  ['en', 'English'],
  ['el', 'Greek'],
  ['ru', 'Russian'],
] as const

export function SupportAutoReply({ initial }: { initial: Values }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [v, setV] = useState(initial)
  const [lang, setLang] = useState<'en' | 'el' | 'ru'>('en')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/support/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          support_auto_reply_enabled: v.enabled,
          support_auto_reply_en: v.en,
          support_auto_reply_el: v.el,
          support_auto_reply_ru: v.ru,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) setMsg({ ok: false, text: data.message ?? 'Could not save.' })
      else {
        setMsg({ ok: true, text: 'Saved. New conversations use it straight away.' })
        router.refresh()
      }
    } catch {
      setMsg({ ok: false, text: 'Could not save, check your connection.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-4 border border-line bg-paper">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left"
      >
        <span>
          <span className="block text-sm font-medium">Automatic first reply</span>
          <span className="block text-xs text-muted">
            {initial.enabled ? `On, “${initial.en.slice(0, 80)}${initial.en.length > 80 ? '…' : ''}”` : 'Off, customers see no automatic reply'}
          </span>
        </span>
        <span aria-hidden className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-5 py-4">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={v.enabled}
              onChange={(e) => setV({ ...v, enabled: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            Send an automatic reply right after a customer’s first message
          </label>
          <div role="tablist" aria-label="Language" className="mt-4 flex gap-1">
            {LANGS.map(([code, label]) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={lang === code}
                onClick={() => setLang(code)}
                className={`px-3 py-1.5 text-xs ${lang === code ? 'bg-accent text-paper' : 'border border-line text-muted hover:text-ink'}`}
              >
                {label}
                {code !== 'en' && !v[code].trim() && ' (uses English)'}
              </button>
            ))}
          </div>
          <label className="mt-2 block">
            <span className="sr-only">Reply in {LANGS.find(([c]) => c === lang)?.[1]}</span>
            <textarea
              value={v[lang]}
              onChange={(e) => setV({ ...v, [lang]: e.target.value })}
              rows={3}
              maxLength={2000}
              disabled={!v.enabled}
              className={`${input} resize-y disabled:opacity-50`}
            />
          </label>
          <p className="mt-1 text-[11px] text-muted">
            Plain text. It appears as a message from Customer Service and is marked “automatic reply” here, so your team can
            tell it from a person’s answer.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy} className={btn.primary}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {msg && (
              <p role={msg.ok ? 'status' : 'alert'} className={`text-xs ${msg.ok ? 'text-muted' : 'text-sale'}`}>
                {msg.text}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
