'use client'

/* ============================================================================
 * Editing one automated email.
 *
 *   On/off        optional emails only; required ones say why they stay on
 *   Timing        for delayed emails (abandoned bag, review request …)
 *   Words         subject, body and button, per language. Plain text with
 *                 {{variables}} — no HTML, no code; the server escapes every
 *                 value and refuses variables the email does not offer.
 *   Preview       rendered by the server with sample values, shown in a
 *                 sandboxed frame (no scripts), updating as you type
 *   Send test     to the test address in Settings — nowhere else
 *
 * Only words that differ from the built-in ones are saved, so an untouched
 * language keeps getting improvements to the defaults.
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { btn, input, Pill } from './ui'
import { ConfirmDialog } from './ConfirmDialog'

type Locale = 'en' | 'el' | 'ru'
type Words = { subject: string; body: string; cta?: string }
type Override = { subject?: string; body?: string; cta?: string }
type Field = 'subject' | 'body' | 'cta'

type Def = {
  key: string
  name: string
  category: 'essential' | 'lifecycle' | 'marketing'
  required: boolean
  internal: boolean
  trigger: string
  note: string | null
  timing: { minutes: number; min: number; max: number; label: string } | null
  hasCta: boolean
  words: Record<Locale, Words>
}

const LANGS: [Locale, string][] = [
  ['en', 'English'],
  ['el', 'Greek'],
  ['ru', 'Russian'],
]
const TYPE = { essential: 'Essential', lifecycle: 'Lifecycle', marketing: 'Marketing' } as const
const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g

/** The words shown in the fields: the owner's where set, else the built-in
 *  ones (English stands in for an empty language, as it does when sending). */
function effective(def: Def, content: Record<string, Override>, loc: Locale): Words {
  const base = def.words[loc].subject ? def.words[loc] : def.words.en
  const own = content[loc] ?? {}
  return {
    subject: own.subject ?? base.subject,
    body: own.body ?? base.body,
    cta: own.cta ?? base.cta ?? '',
  }
}

/** Only what differs from the built-in words, so defaults keep flowing. */
function diff(def: Def, words: Record<Locale, Words>): Record<string, Override> {
  const out: Record<string, Override> = {}
  for (const [loc] of LANGS) {
    const base = def.words[loc].subject ? def.words[loc] : def.words.en
    const w = words[loc]
    const o: Override = {}
    if (w.subject.trim() !== base.subject) o.subject = w.subject.trim()
    if (w.body.trim() !== base.body) o.body = w.body.trim()
    if (def.hasCta && (w.cta ?? '').trim() !== (base.cta ?? '')) o.cta = (w.cta ?? '').trim()
    if (Object.keys(o).length) out[loc] = o
  }
  return out
}

export function TemplateEditor({
  def,
  variables,
  initial,
  testAddress,
}: {
  def: Def
  variables: { name: string; label: string; block: boolean }[]
  initial: { enabled: boolean; delayMinutes: number | null; content: Record<string, Override>; updatedAt: string | null }
  testAddress: string
}) {
  const router = useRouter()
  const langs = def.internal ? LANGS.slice(0, 1) : LANGS
  const [lang, setLang] = useState<Locale>('en')
  const [enabled, setEnabled] = useState(initial.enabled)
  const [hours, setHours] = useState(initial.delayMinutes !== null ? String(initial.delayMinutes / 60) : '')
  const [words, setWords] = useState<Record<Locale, Words>>(() => ({
    en: effective(def, initial.content, 'en'),
    el: effective(def, initial.content, 'el'),
    ru: effective(def, initial.content, 'ru'),
  }))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | 'reset' | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string; link?: boolean } | null>(null)
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  const fields = useRef<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>({ subject: null, body: null, cta: null })
  const lastField = useRef<Field>('body')

  const current = words[lang]
  const allowed = new Set(variables.map((v) => v.name))
  const unknown = [
    ...new Set(
      [current.subject, current.body, current.cta ?? ''].flatMap((t) =>
        [...t.matchAll(TOKEN)].map((m) => m[1]).filter((n) => !allowed.has(n)),
      ),
    ),
  ]
  const content = diff(def, words)

  /* The preview follows the words, a moment after typing stops. */
  const payload = JSON.stringify({ locale: lang, content })
  useEffect(() => {
    const ctrl = new AbortController()
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/emails/templates/${def.key}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: ctrl.signal,
        })
        const data = (await res.json()) as { ok?: boolean; subject?: string; html?: string }
        if (data.ok && data.html) setPreview({ subject: data.subject ?? '', html: data.html })
      } catch {
        /* aborted or offline — the next change tries again */
      }
    }, 450)
    return () => {
      clearTimeout(id)
      ctrl.abort()
    }
  }, [payload, def.key])

  function edit(field: Field, value: string) {
    setWords((w) => ({ ...w, [lang]: { ...w[lang], [field]: value } }))
    setDirty(true)
    setNote(null)
  }

  function insert(name: string) {
    const field = lastField.current
    const el = fields.current[field]
    const token = `{{${name}}}`
    const text = (current[field] ?? '') as string
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    edit(field, text.slice(0, start) + token + text.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  async function save() {
    if (unknown.length) return setNote({ ok: false, text: `Remove {{${unknown[0]}}}, this email does not have it.` })
    const body: Record<string, unknown> = { content }
    if (!def.required) body.enabled = enabled
    if (def.timing) {
      const h = Number(hours)
      if (!Number.isFinite(h)) return setNote({ ok: false, text: 'Enter the timing in hours.' })
      body.delayMinutes = Math.round(h * 60)
    }
    setBusy('save')
    setNote(null)
    try {
      const res = await fetch(`/api/admin/emails/templates/${def.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) return setNote({ ok: false, text: data.message ?? 'Could not save.' })
      setDirty(false)
      setNote({ ok: true, text: 'Saved.' })
      router.refresh()
    } catch {
      setNote({ ok: false, text: 'Could not save, check your connection.' })
    } finally {
      setBusy(null)
    }
  }

  async function sendTest() {
    setBusy('test')
    setNote(null)
    try {
      const res = await fetch(`/api/admin/emails/templates/${def.key}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; to?: string; status?: string; error?: string }
      if (!res.ok || !data.ok) {
        return setNote({ ok: false, text: data.message ?? 'Could not send the test.', link: data.error === 'NO_TEST_ADDRESS' })
      }
      setNote({
        ok: true,
        text:
          data.status === 'sent'
            ? `Test sent to ${data.to}.`
            : data.status === 'logged'
              ? `No email service is configured, the test to ${data.to} was written to Email activity instead.`
              : `The test to ${data.to} failed. See Email activity.`,
      })
    } catch {
      setNote({ ok: false, text: 'Could not send, check your connection.' })
    } finally {
      setBusy(null)
    }
  }

  async function reset() {
    setBusy('reset')
    try {
      await fetch(`/api/admin/emails/templates/${def.key}`, { method: 'DELETE' })
      setWords({ en: effective(def, {}, 'en'), el: effective(def, {}, 'el'), ru: effective(def, {}, 'ru') })
      setDirty(false)
      setNote({ ok: true, text: 'Back to the built-in words.' })
      router.refresh()
    } finally {
      setBusy(null)
      setConfirmReset(false)
    }
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ form */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{def.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{TYPE[def.category]}</span>
            {def.required && <Pill tone="off">Required</Pill>}
            {def.internal && <span>· to your team, in English</span>}
            <span>· sent on: {def.trigger}</span>
          </p>
          {def.note && <p className="mt-2 text-sm text-muted">{def.note}</p>}
        </div>

        <section className="border border-line bg-paper p-5">
          {def.required ? (
            <p className="text-sm">
              <strong className="font-medium">Always on.</strong>{' '}
              <span className="text-muted">
                Customers need this email for the shop to work, so it cannot be switched off. You can change its words.
              </span>
            </p>
          ) : (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  setDirty(true)
                }}
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              />
              <span>
                <span className="font-medium">Send this email</span>
                <span className="block text-muted">
                  {def.category === 'marketing'
                    ? 'Only to people who agreed to marketing emails, never more often than the limit in Settings.'
                    : 'Switch off to stop it; nothing already sent is affected.'}
                </span>
              </span>
            </label>
          )}

          {def.timing && (
            <label className="mt-5 block text-sm">
              <span className="label mb-2 block text-muted">{def.timing.label}</span>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min={def.timing.min / 60}
                  max={def.timing.max / 60}
                  step={0.5}
                  value={hours}
                  onChange={(e) => {
                    setHours(e.target.value)
                    setDirty(true)
                  }}
                  className={`${input.replace("w-full ", "")} w-28`}
                />
                <span className="text-muted">
                  hours (between {def.timing.min / 60} and {def.timing.max / 60})
                </span>
              </span>
            </label>
          )}
        </section>

        <section className="border border-line bg-paper p-5">
          {langs.length > 1 && (
            <div role="tablist" aria-label="Language" className="mb-4 flex gap-1">
              {langs.map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={lang === code}
                  onClick={() => setLang(code)}
                  className={`px-3 py-1.5 text-xs ${lang === code ? 'bg-accent text-paper' : 'border border-line text-muted hover:text-ink'}`}
                >
                  {label}
                  {content[code] && ' •'}
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <span className="label mb-2 block text-muted">Subject</span>
            <input
              ref={(el) => {
                fields.current.subject = el
              }}
              value={current.subject}
              onFocus={() => (lastField.current = 'subject')}
              onChange={(e) => edit('subject', e.target.value)}
              maxLength={200}
              className={input}
            />
          </label>

          <label className="mt-4 block">
            <span className="label mb-2 block text-muted">Email text</span>
            <textarea
              ref={(el) => {
                fields.current.body = el
              }}
              value={current.body}
              onFocus={() => (lastField.current = 'body')}
              onChange={(e) => edit('body', e.target.value)}
              rows={12}
              maxLength={6000}
              className={`${input} font-mono text-[13px] leading-relaxed`}
            />
            <span className="mt-1 block text-xs text-muted">
              Plain text. A blank line starts a new paragraph. A paragraph whose variables are empty (say, no tracking number
              yet) is left out by itself.
            </span>
          </label>

          {def.hasCta && (
            <label className="mt-4 block">
              <span className="label mb-2 block text-muted">Button</span>
              <input
                ref={(el) => {
                  fields.current.cta = el
                }}
                value={current.cta ?? ''}
                onFocus={() => (lastField.current = 'cta')}
                onChange={(e) => edit('cta', e.target.value)}
                maxLength={60}
                className={input}
              />
            </label>
          )}

          {unknown.length > 0 && (
            <p role="alert" className="mt-3 text-sm text-sale">
              {unknown.map((u) => `{{${u}}}`).join(', ')} {unknown.length === 1 ? 'is' : 'are'} not available in this email.
            </p>
          )}

          <div className="mt-5">
            <p className="label mb-2 text-muted">Variables, click to insert</p>
            <ul className="flex flex-wrap gap-2">
              {variables.map((v) => (
                <li key={v.name}>
                  <button
                    type="button"
                    onClick={() => insert(v.name)}
                    title={v.label}
                    className="border border-line px-2 py-1 font-mono text-[12px] hover:border-ink"
                  >
                    {`{{${v.name}}}`}
                  </button>
                </li>
              ))}
            </ul>
            <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted sm:grid-cols-[auto_1fr]">
              {variables.map((v) => (
                <div key={v.name} className="contents">
                  <dt className="font-mono">{`{{${v.name}}}`}</dt>
                  <dd>
                    {v.label}
                    {v.block && ', on a paragraph of its own'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={busy !== null || !dirty} className={btn.primary}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => void sendTest()} disabled={busy !== null} className={btn.secondary}>
            {busy === 'test' ? 'Sending…' : 'Send test email'}
          </button>
          <button type="button" onClick={() => setConfirmReset(true)} disabled={busy !== null} className={btn.quiet}>
            Reset words
          </button>
        </div>
        <p className="text-xs text-muted">
          Tests go only to {testAddress ? <strong className="font-medium text-ink">{testAddress}</strong> : 'the test address'}{' '}
          (<Link href="/admin/emails/settings" className="underline">change</Link>), with sample values, and use the words on
          screen, saved or not.
        </p>
        {note && (
          <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-ok' : 'text-sale'}`}>
            {note.text}{' '}
            {note.link && (
              <Link href="/admin/emails/settings" className="underline">
                Open Settings
              </Link>
            )}
          </p>
        )}
      </div>

      {/* --------------------------------------------------------- preview */}
      <div className="xl:sticky xl:top-6 xl:self-start">
        <p className="label mb-2 text-muted">Preview · sample values</p>
        <div className="border border-line bg-paper">
          <p className="border-b border-line px-4 py-3 text-sm">
            <span className="text-muted">Subject: </span>
            <span className="font-medium">{preview?.subject ?? '…'}</span>
          </p>
          {preview ? (
            <iframe
              title={`Preview of ${def.name}`}
              srcDoc={preview.html}
              /* No scripts, no forms, no navigation of this page. */
              sandbox=""
              className="block h-[40rem] w-full bg-paper-2"
            />
          ) : (
            <div className="grid h-[40rem] place-items-center text-sm text-muted">Loading preview…</div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Go back to the built-in words?"
        body="Your changes to the subject, text and button in every language are removed. The on/off switch and timing stay as they are."
        confirmLabel="Reset words"
        busy={busy === 'reset'}
        onConfirm={() => void reset()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}
