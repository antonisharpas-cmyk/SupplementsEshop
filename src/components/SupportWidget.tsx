'use client'

/* ============================================================================
 * Customer Service chat — the storefront side.
 *
 * A button in the corner opens a panel (a full-height sheet on a phone).
 * Opening it creates nothing: a conversation starts only when the customer
 * sends a first message. When the AI assistant is on it answers first,
 * always labelled as AI, with product cards and one-tap replies; "Talk to a
 * person" hands the chat to the team at any time.
 *
 * Updates arrive by light polling — every 4 seconds while the panel is open
 * and the tab visible, every 30 seconds while it is closed (for the "new
 * reply" dot), and not at all for a visitor who has never written.
 *
 * Anything on the site can open it: window.dispatchEvent(new
 * CustomEvent('support:open')) — the sold-out panel on a product page does.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

type Card = { slug: string; name: string; price: string; image: string | null; inStock: boolean }
type Message = {
  id: string
  sender: 'CUSTOMER' | 'STAFF'
  body: string
  createdAt: string
  automated?: boolean
  ai?: boolean
  meta?: { products?: Card[]; suggestions?: string[] } | null
}
type Conversation = {
  id: string
  status: 'OPEN' | 'CLOSED'
  closedReason: 'STAFF' | 'INACTIVITY' | null
  closedAt: string | null
  email: string | null
  staffLastReadAt: string | null
  assistant?: { active: boolean; typing: boolean; handedOff: boolean }
}
type View = {
  conversation: Conversation | null
  messages: Message[]
  idleMinutes: number
  me: { name: string; email: string } | null
  ai?: boolean
}

const ACTIVE_FLAG = 'sf_support_active'
const MAX = 2000

const readFlag = () => {
  try {
    return localStorage.getItem(ACTIVE_FLAG) === '1'
  } catch {
    return false
  }
}
const writeFlag = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ACTIVE_FLAG, '1')
    else localStorage.removeItem(ACTIVE_FLAG)
  } catch {
    /* private mode: polling simply starts when the panel opens */
  }
}

export function SupportWidget({ locale, brand }: { locale: Locale; brand: string }) {
  const t = getTranslator(locale)
  const title = t('support.title', { brand })

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [unread, setUnread] = useState(false)
  /* The customer pressed "start a new conversation": show the empty form
     even though the last (closed) one is still returned by the server. */
  const [fresh, setFresh] = useState(false)

  /* A visitor first picks: sign in, or carry on as a guest. */
  const [guest, setGuest] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [text, setText] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ name?: string; email?: string }>({})
  /* Sent a message the assistant will answer: show it typing until it does. */
  const [awaitingAi, setAwaitingAi] = useState<string | null>(null)

  /* The assistant is writing: the server says so, or we just sent it a
     message and its answer has not arrived yet (for up to a minute). */
  const lastFromShop = view?.messages.filter((m) => m.sender === 'STAFF').at(-1)?.createdAt
  const thinking = Boolean(
    view?.conversation?.status === 'OPEN' &&
      (view.conversation.assistant?.typing ||
        (awaitingAi &&
          view.conversation.assistant?.active !== false &&
          (!lastFromShop || lastFromShop < awaitingAi) &&
          Date.now() - Date.parse(awaitingAi) < 60_000)),
  )

  const lastSeen = useRef<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const viewRef = useRef<View | null>(null)
  useEffect(() => {
    viewRef.current = view
  }, [view])

  /* ---------------------------------------------------------- fetching -- */

  const refresh = useCallback(
    async (opts: { full?: boolean; markRead?: boolean } = {}) => {
      const current = viewRef.current
      const after = !opts.full && current?.messages.length ? current.messages[current.messages.length - 1].createdAt : null
      const params = new URLSearchParams()
      if (after) params.set('after', after)
      if (opts.markRead) params.set('open', '1')
      try {
        const res = await fetch(`/api/support?${params}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as View & { ok: boolean }
        setView((prev) => {
          const sameConversation = prev?.conversation?.id && prev.conversation.id === data.conversation?.id
          const messages = sameConversation && after ? mergeMessages(prev.messages, data.messages) : data.messages
          return { conversation: data.conversation, messages, idleMinutes: data.idleMinutes, me: data.me, ai: data.ai }
        })
        writeFlag(Boolean(data.conversation && data.conversation.status === 'OPEN'))
        /* The automatic first reply is not "a new reply" worth a dot. */
        const newest = data.messages.filter((m) => m.sender === 'STAFF' && !m.automated).at(-1)
        if (newest && !opts.markRead && (!lastSeen.current || newest.createdAt > lastSeen.current)) setUnread(true)
      } catch {
        /* offline for a moment — the next tick tries again */
      }
    },
    [],
  )

  /* A returning visitor with a live conversation: find it once on load. */
  useEffect(() => {
    if (readFlag()) void refresh({ full: true })
  }, [refresh])

  /* Poll: fast while open, slow while closed (only once there is something). */
  useEffect(() => {
    const active = open || view?.conversation?.status === 'OPEN'
    if (!active) return
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh({ markRead: open })
    }
    /* Faster while the assistant is writing, so its answer shows promptly. */
    const timer = setInterval(tick, open ? (thinking ? 1500 : 4000) : 30000)
    return () => clearInterval(timer)
  }, [open, view?.conversation?.status, refresh, thinking])

  /* Opening marks everything read and reloads the whole thread. */
  const show = useCallback(
    (prefill?: string) => {
      setOpen(true)
      setUnread(false)
      if (prefill) setText((v) => v || prefill)
      void refresh({ full: true, markRead: true })
    },
    [refresh],
  )

  useEffect(() => {
    const onOpen = (e: Event) => show((e as CustomEvent<{ message?: string }>).detail?.message)
    window.addEventListener('support:open', onOpen)
    return () => window.removeEventListener('support:open', onOpen)
  }, [show])

  /* Keep the newest message in view, and remember what has been seen. */
  useEffect(() => {
    if (!open) return
    const last = view?.messages.at(-1)
    if (last) lastSeen.current = last.createdAt
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [open, view?.messages])

  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => firstField.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('keydown', onKey)
    }
     
  }, [open])

  function close() {
    setOpen(false)
    launcherRef.current?.focus()
  }

  /* ----------------------------------------------------------- sending -- */

  const conversation = fresh ? null : (view?.conversation ?? null)
  const closed = conversation?.status === 'CLOSED'

  async function submit(e?: React.FormEvent, quick?: string) {
    e?.preventDefault()
    const body = (quick ?? text).trim()
    if (!body) return setError(t('support.messageRequired'))
    if (body.length > MAX) return setError(`${body.length}/${MAX}`)
    const starting = !conversation || closed
    /* A guest gives a name and an email; a signed-in customer never does. */
    if (starting && !view?.me) {
      const errs: { name?: string; email?: string } = {}
      if (!name.trim()) errs.name = t('support.nameRequired')
      if (!email.trim()) errs.email = t('support.emailRequired')
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = t('news.invalidEmail')
      setFieldError(errs)
      if (errs.name || errs.email) return
    }

    setSending(true)
    setError(null)
    try {
      const res = await fetch(starting ? '/api/support' : '/api/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          starting
            ? { name: name.trim() || null, email: email.trim() || null, message: body, locale, pageUrl: location.pathname + location.search, website }
            : { conversationId: conversation.id, message: body },
        ),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        if (data.error === 'CLOSED') {
          await refresh({ full: true, markRead: true })
          return
        }
        if (data.error === 'NAME_REQUIRED') return setFieldError({ name: t('support.nameRequired') })
        if (data.error === 'EMAIL_REQUIRED') return setFieldError({ email: t('support.emailRequired') })
        if (data.error === 'INVALID_EMAIL') return setFieldError({ email: t('news.invalidEmail') })
        setError(data.error === 'RATE_LIMITED' ? t('support.tooFast') : t('support.sendFailed'))
        return
      }
      if (!quick) setText('')
      setFresh(false)
      writeFlag(true)
      if (starting ? view?.ai : conversation?.assistant?.active) setAwaitingAi(new Date().toISOString())
      await refresh({ full: starting, markRead: true })
    } catch {
      setError(t('support.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  /* ------------------------------------------------------------ render -- */

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
  const messages = conversation ? (view?.messages ?? []) : []
  const lastCustomer = messages.filter((m) => m.sender === 'CUSTOMER').at(-1)
  const seen = Boolean(lastCustomer && conversation?.staffLastReadAt && conversation.staffLastReadAt >= lastCustomer.createdAt)
  const aiOn = Boolean(conversation?.assistant?.active)
  /* Still waiting for a person: nothing from the team yet but the automatic reply. */
  const waiting = Boolean(
    conversation && !closed && !aiOn && messages.length > 0 && messages.every((m) => m.sender === 'CUSTOMER' || m.automated || m.ai),
  )
  const lastMessage = messages.at(-1)
  const lastAiId = lastMessage?.ai ? lastMessage.id : null
  const signInHref = `/${locale}/sign-in`

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => show()}
          aria-label={unread ? `${t('support.open')}, ${t('support.newReply')}` : t('support.open')}
          className="fixed bottom-4 right-4 z-40 flex h-12 items-center gap-2.5 rounded-full bg-gold pl-3.5 pr-3.5 text-paper shadow-lg transition-transform hover:-translate-y-0.5 sm:bottom-6 sm:right-6 sm:pr-5"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ChatIcon />
          <span className="label hidden sm:inline">{t('support.open')}</span>
          {unread && <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-sale" />}
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label={title}
          className="fixed inset-0 z-50 flex flex-col bg-paper sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(36rem,calc(100vh-3rem))] sm:w-[23.5rem] sm:border sm:border-line sm:shadow-2xl"
        >
          <header className="flex items-center justify-between gap-3 border-b border-line bg-gold px-5 py-4 text-paper">
            <h2 className="text-sm font-semibold tracking-wide">{title}</h2>
            <button type="button" onClick={close} aria-label={t('support.close')} className="-mr-1 p-2 text-paper/80 hover:text-paper">
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-5" aria-live="polite">
            {!conversation ? (
              <div>
                <p className="text-lg font-semibold tracking-tight">{t('support.intro')}</p>
                <p className="mt-1.5 text-sm text-ink-soft">{view?.ai ? t('support.aiIntroBody') : t('support.introBody')}</p>
              </div>
            ) : (
              <ol className="space-y-4">
                {messages.map((m) => (
                  <li key={m.id} className={`flex flex-col ${m.sender === 'CUSTOMER' ? 'items-end' : 'items-start'}`}>
                    <span className="mb-1 flex items-center gap-1.5 text-[11px] text-muted">
                      {m.ai && <AiBadge label={t('support.aiBadge')} />}
                      {m.sender === 'CUSTOMER' ? t('support.you') : m.ai ? t('support.assistant') : title} · {time(m.createdAt)}
                    </span>
                    <p
                      className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.sender === 'CUSTOMER'
                          ? 'rounded-br-md bg-accent text-paper'
                          : m.ai
                            ? 'rounded-bl-md border border-accent/30 bg-paper-2 text-ink'
                            : 'rounded-bl-md bg-paper-2 text-ink'
                      }`}
                    >
                      {m.body}
                    </p>
                    {m.meta?.products && m.meta.products.length > 0 && (
                      <ul className="mt-2 grid w-full max-w-[92%] gap-2">
                        {m.meta.products.map((p) => (
                          <li key={p.slug}>
                            <Link
                              href={`/${locale}/products/${p.slug}`}
                              className="flex items-center gap-3 rounded-xl border border-line bg-paper p-2 pr-3 transition-colors hover:border-accent"
                            >
                              <span className="h-14 w-12 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                                {p.image && (
                                  /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={p.image} alt="" className="h-full w-full object-cover" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium text-heading">{p.name}</span>
                                <span className="block text-xs text-muted">
                                  {p.price}
                                  {!p.inStock && <span className="ml-2 text-sale">{t('card.soldOut')}</span>}
                                </span>
                              </span>
                              <span className="text-xs font-semibold text-accent">{t('support.view')}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.id === lastAiId && aiOn && m.meta?.suggestions && m.meta.suggestions.length > 0 && (
                      <div className="mt-2 flex max-w-[92%] flex-wrap gap-1.5">
                        {m.meta.suggestions.map((sug) => (
                          <button
                            key={sug}
                            type="button"
                            disabled={sending}
                            onClick={() => void submit(undefined, sug)}
                            className="rounded-full border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-heading transition-colors hover:border-accent hover:bg-accent/20"
                          >
                            {sug}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.id === lastCustomer?.id && seen && <span className="mt-1 text-[11px] text-muted">{t('support.seen')}</span>}
                  </li>
                ))}
              </ol>
            )}
            {thinking && !closed && (
              <div className="mt-4 flex items-center gap-2 text-[11px] text-muted" role="status">
                <AiBadge label={t('support.aiBadge')} />
                <span>
                  {t('support.assistant')} {t('support.typing')}
                </span>
                <span className="flex gap-1" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </span>
              </div>
            )}
            {waiting && <p className="mt-4 text-xs text-muted">{conversation?.assistant?.handedOff ? t('support.handedOff') : t('support.waiting')}</p>}
            {closed && (
              <div role="status" className="mt-6 border border-line bg-paper-2 px-4 py-4 text-sm">
                <p className="font-medium">{t('support.closedTitle')}</p>
                {conversation?.closedReason === 'INACTIVITY' && (
                  <p className="mt-1 text-ink-soft">{t('support.closedInactivity', { minutes: view?.idleMinutes ?? 10 })}</p>
                )}
                {conversation?.email && <p className="mt-1 text-ink-soft">{t('support.closedEmailed', { email: conversation.email })}</p>}
                <button
                  type="button"
                  onClick={() => {
                    setFresh(true)
                    setError(null)
                    setFieldError({})
                    setTimeout(() => firstField.current?.focus(), 30)
                  }}
                  className="btn btn-primary btn-sm mt-3"
                >
                  {t('support.new')}
                </button>
              </div>
            )}
          </div>

          {!closed && !conversation && view && !view.me && !guest && (
            <div className="border-t border-line px-4 py-5">
              <p className="text-sm text-ink-soft">{t('support.choose')}</p>
              <div className="mt-4 grid gap-2">
                <Link href={signInHref} onClick={close} className="btn btn-primary w-full">
                  {t('support.signIn')}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setGuest(true)
                    setTimeout(() => firstField.current?.focus(), 30)
                  }}
                  className="btn btn-secondary w-full"
                >
                  {t('support.continueGuest')}
                </button>
              </div>
              <p className="mt-3 text-[11px] text-muted">{t('support.idleNote', { minutes: view.idleMinutes })}</p>
            </div>
          )}

          {!closed && (conversation || (view && (view.me || guest))) && (
            <form onSubmit={submit} className="border-t border-line px-4 py-4" noValidate>
              {aiOn && (
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] leading-snug text-muted">{t('support.humanNote')}</p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!conversation) return
                      await fetch('/api/support/human', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ conversationId: conversation.id }),
                      }).catch(() => null)
                      setAwaitingAi(null)
                      await refresh({ full: true, markRead: true })
                    }}
                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    {t('support.human')}
                  </button>
                </div>
              )}
              {!conversation && view && !view.me && (
                <div className="mb-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      <span className="sr-only">{t('support.name')}</span>
                      <input
                        ref={(el) => {
                          firstField.current = el
                        }}
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          if (fieldError.name) setFieldError((f) => ({ ...f, name: undefined }))
                        }}
                        maxLength={120}
                        autoComplete="name"
                        required
                        aria-invalid={fieldError.name ? true : undefined}
                        aria-describedby={fieldError.name ? 'support-name-error' : undefined}
                        placeholder={t('support.name')}
                        className={`w-full border px-3 py-2.5 text-sm outline-none focus:border-accent ${fieldError.name ? 'border-sale' : 'border-line'}`}
                      />
                    </label>
                    <label>
                      <span className="sr-only">{t('support.email')}</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (fieldError.email) setFieldError((f) => ({ ...f, email: undefined }))
                        }}
                        maxLength={255}
                        autoComplete="email"
                        required
                        aria-invalid={fieldError.email ? true : undefined}
                        aria-describedby={fieldError.email ? 'support-email-error' : 'support-email-hint'}
                        placeholder={t('support.email')}
                        className={`w-full border px-3 py-2.5 text-sm outline-none focus:border-accent ${fieldError.email ? 'border-sale' : 'border-line'}`}
                      />
                    </label>
                  </div>
                  {fieldError.name && (
                    <p id="support-name-error" role="alert" className="mt-1.5 text-xs text-sale">
                      {fieldError.name}
                    </p>
                  )}
                  {fieldError.email && (
                    <p id="support-email-error" role="alert" className="mt-1.5 text-xs text-sale">
                      {fieldError.email}
                    </p>
                  )}
                  <p id="support-email-hint" className="mt-1.5 text-[11px] text-muted">
                    {t('support.emailHint')}
                  </p>
                </div>
              )}
              {!conversation && view?.me && <p className="mb-2 text-[11px] text-muted">{view.me.email}</p>}

              <input
                type="text"
                tabIndex={-1}
                aria-hidden
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="absolute -left-[9999px] h-px w-px opacity-0"
              />

              <div className={conversation ? 'flex items-end gap-2' : 'flex flex-col gap-2'}>
                <label className="w-full flex-1">
                  <span className="sr-only">{t('support.message')}</span>
                  <textarea
                    ref={(el) => {
                      if (conversation || view?.me) firstField.current = el
                    }}
                    value={text}
                    onChange={(e) => {
                      setText(e.target.value)
                      if (error) setError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        void submit()
                      }
                    }}
                    rows={conversation ? 1 : 3}
                    maxLength={MAX}
                    placeholder={conversation ? t('support.placeholder') : t('support.message')}
                    className="max-h-40 min-h-11 w-full resize-none border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
                  />
                </label>
                <button
                  type="submit"
                  disabled={sending}
                  className="btn btn-primary btn-sm h-11 shrink-0"
                >
                  {conversation ? t('support.send') : t('support.start')}
                </button>
              </div>
              {error && (
                <p role="alert" className="mt-2 text-xs text-sale">
                  {error}
                </p>
              )}
              {!conversation && view && (
                <p className="mt-2 text-[11px] text-muted">{t('support.idleNote', { minutes: view.idleMinutes })}</p>
              )}
            </form>
          )}
        </section>
      )}
    </>
  )
}

function AiBadge({ label }: { label: string }) {
  return <span className="bg-gold rounded px-1 py-px text-[9px] font-bold tracking-wider text-paper">{label}</span>
}

function mergeMessages(a: Message[], b: Message[]): Message[] {
  const seen = new Set(a.map((m) => m.id))
  return [...a, ...b.filter((m) => !seen.has(m.id))]
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 5.5h16v10H9l-5 4v-14z" strokeLinejoin="round" />
    </svg>
  )
}
