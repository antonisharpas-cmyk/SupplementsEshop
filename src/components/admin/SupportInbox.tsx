'use client'

/* ============================================================================
 * The Customer Service inbox.
 *
 * Left: conversations, latest activity first, unread in bold with a count.
 * Right: the selected thread, a reply box (Enter sends, Shift+Enter is a new
 * line) and Close. On a phone the two panes take turns.
 *
 * Polls the list every 10 s and the open thread every 4 s while the tab is
 * visible. Opening a thread marks it read. Replies go out as "Customer
 * Service" — the customer never sees which of you wrote them.
 * ========================================================================== */

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { InboxRow } from '@/lib/support'
import { ConfirmDialog } from './ConfirmDialog'
import { btn } from './ui'

type Thread = {
  conversation: {
    id: string
    name: string | null
    email: string | null
    status: 'OPEN' | 'CLOSED'
    signedIn: boolean
    locale: string
    pageUrl: string | null
    openedAt: string
    lastActivityAt: string
    closedAt: string | null
    closedReason: 'STAFF' | 'INACTIVITY' | null
    customerLastReadAt: string | null
    transcriptSentAt: string | null
  }
  messages: { id: string; sender: 'CUSTOMER' | 'STAFF'; body: string; createdAt: string; automated?: boolean }[]
  idleMinutes: number
}

type Tab = 'OPEN' | 'CLOSED' | 'ALL'
const TAB_LABEL: Record<Tab, string> = { OPEN: 'Open', CLOSED: 'Closed', ALL: 'All' }

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function SupportInbox({
  initialStatus,
  initialRows,
  initialCounts,
  initialThread,
  serviceName,
}: {
  initialStatus: Tab
  initialRows: InboxRow[]
  initialCounts: { open: number; unread: number }
  initialThread: Thread | null
  serviceName: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState(initialStatus)
  const [rows, setRows] = useState(initialRows)
  const [counts, setCounts] = useState(initialCounts)
  const [thread, setThread] = useState<Thread | null>(initialThread)
  const [selected, setSelected] = useState<string | null>(initialThread?.conversation.id ?? null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const listEnd = useRef<HTMLDivElement>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)

  const loadList = useCallback(async (which: Tab) => {
    try {
      const res = await fetch(`/api/admin/support?status=${which}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { rows: InboxRow[]; counts: { open: number; unread: number } }
      setRows(data.rows)
      setCounts(data.counts)
    } catch {
      /* next tick */
    }
  }, [])

  const loadThread = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/support/${id}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as Thread
      setThread(data)
    } catch {
      /* next tick */
    }
  }, [])

  /* Polling, paused while the tab is hidden. */
  useEffect(() => {
    const listTimer = setInterval(() => {
      if (document.visibilityState === 'visible') void loadList(status)
    }, 10_000)
    const threadTimer = setInterval(() => {
      if (selected && document.visibilityState === 'visible') void loadThread(selected)
      setNow(Date.now())
    }, 4_000)
    return () => {
      clearInterval(listTimer)
      clearInterval(threadTimer)
    }
  }, [status, selected, loadList, loadThread])

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end' })
  }, [thread?.messages.length, selected])

  function select(id: string | null) {
    setSelected(id)
    setError(null)
    setReply('')
    if (id) {
      setThread((t) => (t?.conversation.id === id ? t : null))
      void loadThread(id).then(() => loadList(status))
    }
    router.replace(id ? `${pathname}?c=${id}${status !== 'OPEN' ? `&status=${status}` : ''}` : pathname, { scroll: false })
  }

  function switchTab(next: Tab) {
    setStatus(next)
    void loadList(next)
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    if (!selected || !reply.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/support/${selected}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) {
        setError(data.message ?? 'Could not send.')
        await loadThread(selected)
        return
      }
      setReply('')
      await Promise.all([loadThread(selected), loadList(status)])
      replyRef.current?.focus()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSending(false)
    }
  }

  async function close() {
    if (!selected) return
    setClosing(true)
    try {
      await fetch(`/api/admin/support/${selected}/close`, { method: 'POST' })
      await Promise.all([loadThread(selected), loadList(status)])
    } finally {
      setClosing(false)
      setConfirmClose(false)
    }
  }

  const c = thread?.conversation
  const idleLeft = c && c.status === 'OPEN' ? Math.max(0, thread!.idleMinutes * 60_000 - (now - Date.parse(c.lastActivityAt))) : 0

  return (
    <div className="grid h-[calc(100vh-13rem)] min-h-[32rem] border border-line bg-paper md:grid-cols-[20rem_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ list */}
      <aside className={`flex min-h-0 flex-col border-line md:border-r ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div role="tablist" className="flex border-b border-line">
          {(['OPEN', 'CLOSED', 'ALL'] as const).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              onClick={() => switchTab(s)}
              className={`flex-1 px-4 py-3 text-sm ${status === s ? 'border-b-2 border-ink font-medium' : 'text-muted hover:text-ink'}`}
            >
              {s === 'OPEN' ? `Open (${counts.open})` : TAB_LABEL[s]}
            </button>
          ))}
        </div>
        <ul className="min-h-0 flex-1 divide-y divide-[var(--color-line)] overflow-y-auto">
          {rows.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-muted">
              {status === 'OPEN'
                ? 'No open conversations. New ones appear here by themselves.'
                : status === 'CLOSED'
                  ? 'No closed conversations yet.'
                  : 'No conversations yet.'}
            </li>
          )}
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => select(r.id)}
                aria-current={selected === r.id}
                className={`block w-full px-4 py-3 text-left transition-colors hover:bg-paper-2 ${selected === r.id ? 'bg-paper-2' : ''}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${r.unread ? 'font-semibold' : ''}`}>{r.name || r.email || 'Guest'}</span>
                  <span className="shrink-0 text-[11px] text-muted">{ago(r.lastActivityAt, now)}</span>
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  {r.email && r.name && <span className="truncate">{r.email}</span>}
                  <span className="shrink-0 border border-line px-1 text-[10px] uppercase tracking-wide">
                    {r.signedIn ? 'Signed in' : 'Guest'}
                  </span>
                  {status === 'ALL' && (
                    <span className={`shrink-0 text-[10px] uppercase tracking-wide ${r.status === 'OPEN' ? 'text-ink' : ''}`}>
                      {r.status === 'OPEN' ? 'Open' : 'Closed'}
                    </span>
                  )}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className={`truncate text-xs ${r.unread ? 'text-ink' : 'text-muted'}`}>
                    {r.lastSender === 'STAFF' && (r.lastAutomated ? 'Automatic reply: ' : 'You: ')}
                    {r.lastMessage}
                  </span>
                  {r.unread > 0 && (
                    <span className="ml-auto shrink-0 rounded-full bg-sale px-1.5 text-[11px] font-medium text-white" aria-label={`${r.unread} unread`}>
                      {r.unread}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ---------------------------------------------------------- thread */}
      <section className={`min-h-0 flex-col ${selected ? 'flex' : 'hidden md:flex'}`}>
        {!selected ? (
          <div className="m-auto max-w-xs px-6 text-center text-sm text-muted">Choose a conversation on the left to read and reply.</div>
        ) : !c ? (
          <div className="m-auto text-sm text-muted">Loading…</div>
        ) : (
          <>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <button type="button" onClick={() => select(null)} className="mb-1 text-xs text-muted underline md:hidden">
                  ← All conversations
                </button>
                <h2 className="truncate font-semibold">{c.name || 'Guest'}</h2>
                <p className="text-xs text-muted">
                  {c.email ? (
                    <a href={`mailto:${c.email}`} className="underline">
                      {c.email}
                    </a>
                  ) : (
                    'No email given'
                  )}
                  {c.signedIn ? ' · signed-in customer' : ' · guest'} · {c.locale.toUpperCase()} · opened {ago(c.openedAt, now)}
                </p>
                {c.pageUrl && <p className="truncate text-xs text-muted">Was on {c.pageUrl}</p>}
              </div>
              {c.status === 'OPEN' ? (
                <div className="text-right">
                  <button type="button" onClick={() => setConfirmClose(true)} className={btn.secondary}>
                    Close conversation
                  </button>
                  <p className="mt-1 text-[11px] text-muted">Closes by itself in {Math.ceil(idleLeft / 60_000)} min if quiet</p>
                </div>
              ) : (
                <span className="text-xs text-muted">
                  Closed {c.closedAt && ago(c.closedAt, now)} · {c.closedReason === 'INACTIVITY' ? 'no messages for a while' : 'by staff'}
                  {c.transcriptSentAt && ' · copy emailed'}
                </span>
              )}
            </header>

            <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5" aria-live="polite">
              {thread.messages.map((m) => (
                <li key={m.id} className={`flex flex-col ${m.sender === 'STAFF' ? 'items-end' : 'items-start'}`}>
                  <span className="mb-1 text-[11px] text-muted">
                    {m.sender === 'STAFF' ? serviceName : c.name || 'Customer'} · {clock(m.createdAt)}
                    {m.automated && ' · automatic reply'}
                  </span>
                  <p
                    className={`max-w-[80%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-sm ${
                      m.automated ? 'border border-dashed border-line bg-paper text-ink-soft' : m.sender === 'STAFF' ? 'bg-accent text-paper' : 'bg-paper-2'
                    }`}
                  >
                    {m.body}
                  </p>
                </li>
              ))}
              <div ref={listEnd} />
            </ol>

            {c.status === 'OPEN' ? (
              <form onSubmit={send} className="border-t border-line p-4">
                <div className="flex items-end gap-2">
                  <label className="flex-1">
                    <span className="sr-only">Reply</span>
                    <textarea
                      ref={replyRef}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          void send()
                        }
                      }}
                      rows={2}
                      maxLength={2000}
                      placeholder={`Reply as ${serviceName}…`}
                      className="w-full resize-none border border-line px-3 py-2.5 text-sm outline-none focus:border-accent"
                    />
                  </label>
                  <button type="submit" disabled={sending || !reply.trim()} className={btn.primary}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-muted">Enter sends · Shift+Enter for a new line</p>
                {error && (
                  <p role="alert" className="mt-1 text-xs text-sale">
                    {error}
                  </p>
                )}
              </form>
            ) : (
              <p className="border-t border-line px-5 py-4 text-sm text-muted">
                This conversation is closed and kept for reference. The customer can start a new one from the shop.
              </p>
            )}
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirmClose}
        title="Close this conversation?"
        body={
          c?.email
            ? `The customer sees that it has ended and gets a copy by email at ${c.email}. Nothing is deleted.`
            : 'The customer sees that it has ended. They gave no email, so no copy is sent. Nothing is deleted.'
        }
        confirmLabel="Close conversation"
        busy={closing}
        onConfirm={() => void close()}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  )
}
