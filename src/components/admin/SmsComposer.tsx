'use client'

/* Write an SMS campaign: live length and SMS count, preview with the opt out
   line, price check, a test to your own phone, then send with a confirm step. */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { smsLength } from '@/lib/sms-length'
import { btn, input } from '@/components/admin/ui'

type Audience = 'all' | 'en' | 'el' | 'ru'
const MAX_SEGMENTS = 4

const AUDIENCES: { value: Audience; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'en', label: 'English speakers' },
  { value: 'el', label: 'Greek speakers' },
  { value: 'ru', label: 'Russian speakers' },
]

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  const data = (await res?.json().catch(() => null)) as Record<string, unknown> | null
  return { ok: Boolean(res?.ok && data?.ok), data: data ?? {}, message: (data?.message as string | undefined) ?? 'Something went wrong. Try again.' }
}

export function SmsComposer({ counts, optOut, enabled, senderId }: { counts: Record<Audience, number>; optOut: string; enabled: boolean; senderId: string }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [testPhone, setTestPhone] = useState('')
  const [busy, setBusy] = useState<null | 'estimate' | 'test' | 'send'>(null)
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null)

  const full = `${text.trim()}\n${optOut}`
  const len = useMemo(() => smsLength(full), [full])
  const recipients = counts[audience]
  const tooLong = len.segments > MAX_SEGMENTS
  const empty = text.trim().length < 5

  async function estimate() {
    setBusy('estimate')
    setNote(null)
    const r = await post('/api/admin/sms/estimate', { text, audience })
    setBusy(null)
    if (!r.ok) return setNote({ tone: 'bad', text: r.message })
    const cost = r.data.cost as number | null
    setNote({
      tone: 'info',
      text:
        cost === null
          ? `${r.data.recipients} recipients × ${r.data.segments} SMS. ${String(r.data.detail ?? '')}`
          : `About €${cost.toFixed(2)} for ${r.data.recipients} recipients × ${r.data.segments} SMS each.`,
    })
  }

  async function test() {
    setBusy('test')
    setNote(null)
    const r = await post('/api/admin/sms/test', { text, phone: testPhone })
    setBusy(null)
    if (!r.ok) return setNote({ tone: 'bad', text: r.message })
    setNote({ tone: 'ok', text: r.data.logged ? `Test written to the server log (sms.to is not connected).` : `Test sent to ${r.data.to}.` })
  }

  async function send() {
    setBusy('send')
    setNote(null)
    const r = await post('/api/admin/sms/send', { text, audience })
    setBusy(null)
    setConfirming(false)
    if (!r.ok) return setNote({ tone: 'bad', text: r.message })
    const c = r.data.campaign as { status: string; sent: number; failed: number; recipients: number }
    setNote({
      tone: c.failed ? 'bad' : 'ok',
      text:
        c.status === 'LOGGED'
          ? `Logged for ${c.recipients} recipients. Nothing was sent because sms.to is not connected.`
          : c.failed
            ? `Sent to ${c.sent} of ${c.recipients}. ${c.failed} could not be sent, see the list below.`
            : `Sent to ${c.sent} recipients.`,
    })
    setText('')
    router.refresh()
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-6">
      <h2 className="text-lg font-semibold text-heading">New SMS campaign</h2>
      <p className="mt-1 text-sm text-muted">
        Goes only to customers who said yes to offers by SMS. Keep it short: one offer, one link.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <label className="block text-sm">
            <span className="label mb-1.5 block text-muted">Message</span>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setConfirming(false)
              }}
              rows={5}
              maxLength={1000}
              placeholder="Weekend offer: 15% off all protein with code PROTEIN15."
              className={input}
            />
          </label>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            <span>
              <strong className={`tabular-nums ${tooLong ? 'text-sale' : 'text-ink'}`}>{len.characters}</strong> characters with the
              opt out line
            </span>
            <span>
              <strong className={`tabular-nums ${tooLong ? 'text-sale' : 'text-ink'}`}>{len.segments}</strong> SMS per person
              {tooLong ? ` (at most ${MAX_SEGMENTS})` : ''}
            </span>
            <span>{len.encoding === 'GSM' ? 'Standard characters, 160 per SMS' : 'Greek, Cyrillic or emoji, 70 per SMS'}</span>
          </div>

          <fieldset>
            <legend className="label mb-2 text-muted">Send to</legend>
            <div className="flex flex-wrap gap-2">
              {AUDIENCES.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => {
                    setAudience(a.value)
                    setConfirming(false)
                  }}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
                    audience === a.value ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'
                  }`}
                >
                  {a.label}
                  <span className={`rounded-full px-1.5 text-xs ${audience === a.value ? 'bg-black/15' : 'bg-paper-2 text-muted'}`}>{counts[a.value]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-52 flex-1 text-sm">
              <span className="label mb-1.5 block text-muted">Test on a phone first</span>
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+357 99 123456" className={input} inputMode="tel" />
            </label>
            <button type="button" onClick={test} disabled={busy !== null || empty || tooLong || testPhone.trim().length < 6} className={btn.secondary}>
              {busy === 'test' ? 'Sending' : 'Send test'}
            </button>
            <button type="button" onClick={estimate} disabled={busy !== null || empty || tooLong || !enabled} className={btn.secondary} title={enabled ? '' : 'Connect sms.to to see prices'}>
              {busy === 'estimate' ? 'Checking' : 'Check price'}
            </button>
          </div>

          {note && (
            <p
              role="status"
              className={`rounded-xl border px-4 py-3 text-sm ${
                note.tone === 'ok' ? 'border-ok/40 bg-ok/10 text-ink' : note.tone === 'bad' ? 'border-sale/40 bg-sale/10 text-ink' : 'border-line bg-paper-2 text-ink'
              }`}
            >
              {note.text}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy !== null || empty || tooLong || recipients === 0} className={btn.primary}>
                Send to {recipients} {recipients === 1 ? 'person' : 'people'}
              </button>
            ) : (
              <>
                <span className="text-sm text-ink">
                  Send this to {recipients} {recipients === 1 ? 'person' : 'people'} now? It cannot be called back.
                </span>
                <button type="button" onClick={send} disabled={busy !== null} className={btn.primary}>
                  {busy === 'send' ? 'Sending' : 'Yes, send now'}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className={btn.quiet}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="label mb-2 text-muted">Preview</p>
          <div className="mx-auto max-w-xs rounded-[2rem] border border-line bg-paper-2 p-4">
            <p className="text-center text-xs text-muted">{senderId}</p>
            <div className="mt-3 rounded-2xl rounded-bl-md bg-[#2a2a2a] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-ink">
              {text.trim() || <span className="text-muted">Your message</span>}
              {'\n'}
              <span className="text-muted">{optOut}</span>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-muted">The opt out line is added to every message, as the law requires.</p>
        </div>
      </div>
    </section>
  )
}
