'use client'

/* ============================================================================
 * "Are you sure?" for the few admin actions that cannot be taken back —
 * sending a mailing, closing a conversation.
 *
 * Built on <dialog>, so focus is trapped, Escape cancels and the page behind
 * is inert, all by the browser. The confirming button says exactly what will
 * happen ("Send to 214 people"), never just "OK".
 * ========================================================================== */

import { useEffect, useRef } from 'react'
import { btn } from './ui'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] border border-line bg-paper p-0 text-ink shadow-xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-paper-2 px-6 py-4">
        <button type="button" className={btn.secondary} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          className={tone === 'danger' ? btn.danger : btn.primary}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
