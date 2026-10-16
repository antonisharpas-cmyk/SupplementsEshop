'use client'

/* ============================================================================
 * Writing a mailing to subscribers (new arrivals or a promotion).
 *
 *   What          new arrivals or a promotion
 *   Products      automatic (the newest in stock / newest reduced, taken
 *                 from the live shop when it sends), one category, or up to
 *                 six picked by hand — sold-out ones are dropped at send time
 *   Words         subject, message, the button and where it goes
 *   Promotion     an optional code and "valid until"
 *   Who           everyone confirmed (each in their language) or one language
 *   When          now, or a date and time
 *
 *   Send test     → the test address in Settings only, in a chosen language
 *   Send/Schedule → asks first, naming the number of people
 *
 * Only confirmed, consented subscribers are ever mailed; anyone who received
 * another marketing email within the frequency limit is skipped for this one.
 * ========================================================================== */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ConfirmDialog } from './ConfirmDialog'
import { btn, input } from './ui'

type Kind = 'new_arrivals' | 'promotion'
type Audience = 'all' | 'en' | 'el' | 'ru'
type Source = 'auto' | 'category' | 'pick'
type CtaTarget = 'new' | 'sale' | 'category' | 'shop'

export type PickerProduct = { id: string; name: string; image: string | null; soldOut: boolean }
export type PickerCategory = { id: string; label: string }

const PRESETS: Record<Kind, { subject: string; message: string; cta: string; target: CtaTarget }> = {
  new_arrivals: {
    subject: 'Just dropped: new pieces are in',
    message: 'New products have just landed. Here is a first look before everyone else.',
    cta: 'Shop new arrivals',
    target: 'new',
  },
  promotion: {
    subject: 'Selected pieces, reduced',
    message: 'A few favourites are reduced for a short time. Here is what is included.',
    cta: 'Shop the offer',
    target: 'sale',
  },
}

/** A Date as the value of <input type=datetime-local>, in local time. */
function localInput(d: Date) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

const AUDIENCE_LABEL: Record<Audience, string> = {
  all: 'Everyone (each in their language)',
  en: 'English speakers',
  el: 'Greek speakers',
  ru: 'Russian speakers',
}

export function CampaignComposer({
  audience: sizes,
  sending,
  products,
  categories,
  testAddress,
}: {
  audience: Record<Audience, number>
  sending: boolean
  products: PickerProduct[]
  categories: PickerCategory[]
  testAddress: string
}) {
  const router = useRouter()
  const [kind, setKind] = useState<Kind>('new_arrivals')
  const [subject, setSubject] = useState(PRESETS.new_arrivals.subject)
  const [message, setMessage] = useState(PRESETS.new_arrivals.message)
  const [ctaLabel, setCtaLabel] = useState(PRESETS.new_arrivals.cta)
  const [ctaTarget, setCtaTarget] = useState<CtaTarget>('new')
  const [source, setSource] = useState<Source>('auto')
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [picked, setPicked] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [promoExpires, setPromoExpires] = useState('')
  const [audience, setAudience] = useState<Audience>('all')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [at, setAt] = useState('')
  const [previewLocale, setPreviewLocale] = useState<'en' | 'el' | 'ru'>('en')
  const [busy, setBusy] = useState<'test' | 'send' | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string; settings?: boolean } | null>(null)

  const count = sizes[audience]
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products).slice(0, 60)
  }, [filter, products])

  function pickKind(next: Kind) {
    /* Swap the suggested words only where they have not been edited. */
    if (subject === PRESETS[kind].subject) setSubject(PRESETS[next].subject)
    if (message === PRESETS[kind].message) setMessage(PRESETS[next].message)
    if (ctaLabel === PRESETS[kind].cta) setCtaLabel(PRESETS[next].cta)
    if (ctaTarget === PRESETS[kind].target) setCtaTarget(PRESETS[next].target)
    setKind(next)
  }

  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 6 ? p : [...p, id]))
  }

  function draft() {
    return {
      kind,
      subject,
      message,
      audience,
      ctaLabel: ctaLabel.trim() || undefined,
      ctaTarget,
      productIds: source === 'pick' ? picked : undefined,
      categoryId: source === 'category' || ctaTarget === 'category' ? categoryId || null : null,
      promoCode: promoCode.trim() || undefined,
      promoExpires: promoExpires.trim() || undefined,
    }
  }

  function check(): string | null {
    if (subject.trim().length < 3) return 'Give it a subject line.'
    if (message.trim().length < 10) return 'Write a sentence or two for the top of the email.'
    if (source === 'pick' && picked.length === 0) return 'Pick at least one product, or choose “Automatic”.'
    if ((source === 'category' || ctaTarget === 'category') && !categoryId) return 'Choose a category.'
    if (promoCode && !/^[A-Za-z0-9_-]+$/.test(promoCode.trim())) return 'A code is letters, digits, - and _.'
    if (when === 'later') {
      const t = Date.parse(at)
      if (!at || Number.isNaN(t)) return 'Choose when to send it.'
      if (t < Date.now()) return 'That time has already passed.'
    }
    return null
  }

  async function post(path: string, body: Record<string, unknown>) {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok && data.ok === true, data }
  }

  async function sendTest() {
    const problem = check()
    if (problem && !problem.startsWith('That time') && !problem.startsWith('Choose when')) return setNote({ tone: 'bad', text: problem })
    setBusy('test')
    setNote(null)
    const { ok, data } = await post('/api/admin/newsletter/test', { ...draft(), previewLocale })
    setBusy(null)
    setNote(
      ok
        ? { tone: 'ok', text: `Test sent to ${String(data.to)}.${data.note ? ` ${String(data.note)}` : ''}` }
        : { tone: 'bad', text: String(data.message ?? 'Could not send the test.'), settings: data.error === 'NO_TEST_ADDRESS' },
    )
  }

  async function sendAll() {
    setBusy('send')
    const { ok, data } = await post('/api/admin/newsletter/campaigns', {
      ...draft(),
      confirmCount: count,
      scheduledAt: when === 'later' ? new Date(at).toISOString() : null,
    })
    setBusy(null)
    setAsking(false)
    if (!ok) return setNote({ tone: 'bad', text: String(data.message ?? 'Could not start the mailing.') })
    setNote({
      tone: 'ok',
      text: when === 'later' ? 'Scheduled. It shows under “Mailings” and can be cancelled until it starts.' : 'Sending now. Progress shows under “Mailings”.',
    })
    router.refresh()
  }

  /* Earliest pickable time, fixed when the form opens. */
  const [minLocal] = useState(() => localInput(new Date(Date.now() + 5 * 60_000)))

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="label mb-2 text-muted">What is it about?</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['new_arrivals', 'New arrivals', 'Show what just landed'],
              ['promotion', 'Promotion', 'Reduced pieces, a code, an offer'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-2.5 border px-4 py-3 text-sm ${kind === value ? 'border-ink' : 'border-line hover:border-ink-soft'}`}
            >
              <input type="radio" name="kind" checked={kind === value} onChange={() => pickKind(value)} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                {label}
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="label mb-2 block text-muted">Subject line</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} className={input} />
      </label>

      <label className="block">
        <span className="label mb-2 block text-muted">Message at the top</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={3000} className={input} />
        <span className="mt-1 block text-xs text-muted">
          Plain text, written once, it goes to everyone as typed. The greeting with each person’s first name and the
          unsubscribe link are added automatically, in their language.
        </span>
      </label>

      <fieldset>
        <legend className="label mb-2 text-muted">Products in the email</legend>
        <div className="flex flex-wrap gap-2 text-sm">
          {(
            [
              ['auto', kind === 'promotion' ? 'Automatic, newest reduced' : 'Automatic, newest in stock'],
              ['category', 'From one category'],
              ['pick', 'Pick up to six'],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className={`flex cursor-pointer items-center gap-2 border px-3 py-2 ${source === value ? 'border-ink' : 'border-line'}`}>
              <input type="radio" name="source" checked={source === value} onChange={() => setSource(value)} className="accent-[var(--color-accent)]" />
              {label}
            </label>
          ))}
        </div>
        {(source === 'category' || ctaTarget === 'category') && (
          <label className="mt-3 block">
            <span className="sr-only">Category</span>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {source === 'pick' && (
          <div className="mt-3 border border-line">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter products"
              aria-label="Filter products"
              className="w-full border-b border-line px-3 py-2 text-sm outline-none"
            />
            <p className="px-3 py-2 text-xs text-muted">{picked.length}/6 chosen · sold-out pieces are left out when it sends</p>
            <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto">
              {shown.map((p) => {
                const on = picked.includes(p.id)
                return (
                  <li key={p.id}>
                    <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${on ? 'bg-paper-2' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!on && picked.length >= 6}
                        onChange={() => togglePick(p.id)}
                        className="accent-[var(--color-accent)]"
                      />
                      {p.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.image} alt="" className="h-10 w-8 object-cover" />
                      ) : (
                        <span className="h-10 w-8 bg-paper-2" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.soldOut && <span className="text-xs text-muted">sold out</span>}
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-2 block text-muted">Button text</span>
          <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} maxLength={40} className={input} />
        </label>
        <label className="block">
          <span className="label mb-2 block text-muted">Button goes to</span>
          <select value={ctaTarget} onChange={(e) => setCtaTarget(e.target.value as CtaTarget)} className={input}>
            <option value="new">New arrivals</option>
            <option value="sale">Sale</option>
            <option value="category">A category</option>
            <option value="shop">The shop’s front page</option>
          </select>
        </label>
      </div>

      {kind === 'promotion' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="label mb-2 block text-muted">Promotion code (optional)</span>
            <input value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} maxLength={40} className={`${input} font-mono`} />
          </label>
          <label className="block">
            <span className="label mb-2 block text-muted">Valid until (optional)</span>
            <input value={promoExpires} onChange={(e) => setPromoExpires(e.target.value)} maxLength={60} placeholder="e.g. Sunday 12 October" className={input} />
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            The code is shown as typed, create it first in the shop’s promotions so it works at checkout.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label mb-2 block text-muted">Send to</span>
          <select value={audience} onChange={(e) => setAudience(e.target.value as Audience)} className={input}>
            {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABEL[a]}, {sizes[a]}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="label mb-2 text-muted">When</legend>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="when" checked={when === 'now'} onChange={() => setWhen('now')} className="accent-[var(--color-accent)]" />
              Now
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="when" checked={when === 'later'} onChange={() => setWhen('later')} className="accent-[var(--color-accent)]" />
              Later
            </label>
            {when === 'later' && (
              <input type="datetime-local" value={at} min={minLocal} onChange={(e) => setAt(e.target.value)} aria-label="Send at" className={`${input.replace("w-full ", "")} w-auto`} />
            )}
          </div>
        </fieldset>
      </div>

      {note && (
        <p role={note.tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>
          {note.text}{' '}
          {note.settings && (
            <Link href="/admin/emails/settings" className="underline">
              Open Settings
            </Link>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2">
          <button type="button" className={btn.secondary} onClick={() => void sendTest()} disabled={busy !== null}>
            {busy === 'test' ? 'Sending test…' : 'Send test email'}
          </button>
          <select
            value={previewLocale}
            onChange={(e) => setPreviewLocale(e.target.value as 'en' | 'el' | 'ru')}
            aria-label="Test in language"
            className="border border-line bg-paper px-2 py-2.5 text-sm"
          >
            <option value="en">EN</option>
            <option value="el">EL</option>
            <option value="ru">RU</option>
          </select>
        </span>
        <button
          type="button"
          className={btn.primary}
          disabled={busy !== null || count === 0 || (sending && when === 'now')}
          onClick={() => {
            const problem = check()
            if (problem) return setNote({ tone: 'bad', text: problem })
            setAsking(true)
          }}
        >
          {when === 'later' ? 'Schedule for' : 'Send to'} {count} {count === 1 ? 'person' : 'people'}
        </button>
      </div>
      <p className="text-xs text-muted">
        Tests go only to {testAddress ? <strong className="font-medium text-ink">{testAddress}</strong> : 'the test address set in Settings'}.
      </p>
      {sending && <p className="text-xs text-muted">A mailing is being sent right now; you can send another when it finishes.</p>}
      {count === 0 && <p className="text-xs text-muted">Nobody in this audience has confirmed a subscription yet.</p>}

      <ConfirmDialog
        open={asking}
        title={`${when === 'later' ? 'Schedule' : 'Send'} to ${count} ${count === 1 ? 'person' : 'people'}?`}
        body={
          <>
            “{subject.trim()}” goes to {AUDIENCE_LABEL[audience].toLowerCase()} who confirmed their subscription
            {when === 'later' && at ? `, on ${new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. Anyone who
            had another marketing email very recently is skipped. {when === 'now' ? 'This cannot be undone, send a test first if you have not.' : 'You can cancel it until it starts.'}
          </>
        }
        confirmLabel={when === 'later' ? 'Schedule' : `Send to ${count}`}
        busy={busy === 'send'}
        onConfirm={() => void sendAll()}
        onCancel={() => setAsking(false)}
      />
    </div>
  )
}
