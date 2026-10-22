'use client'

/* ============================================================================
 * Choose a BOX NOW locker on BOX NOW's own map.
 *
 * The map is BOX NOW's widget, opened in a frame inside our own dialog (the
 * same page their official shop plugin opens). When the customer picks a
 * locker the widget posts it back to this page; only messages from a
 * boxnow.* address are believed, and the server checks the locker again with
 * BOX NOW before the order is placed.
 * ========================================================================== */

import { useEffect, useRef, useState } from 'react'

export type Locker = { id: string; name: string; address: string; postalCode: string }

const ORIGIN = /^https:\/\/([a-z0-9-]+\.)*boxnow\.(cy|gr|bg|hr)$/

/** The widget has used a few spellings over its versions; accept them all. */
function readLocker(raw: unknown): Locker | 'close' | null {
  let d: unknown = raw
  if (typeof d === 'string') {
    if (d === 'closeIframe') return 'close'
    try {
      d = JSON.parse(d)
    } catch {
      return null
    }
  }
  if (!d || typeof d !== 'object') return null
  const o = d as Record<string, unknown>
  if (o.boxnowClose) return 'close'
  const id = o.boxnowLockerId ?? o.lockerId ?? o.locker_id
  if (id == null || id === '') return null
  const s = (v: unknown) => (v == null ? '' : String(v)).trim()
  return {
    id: s(id),
    name: s(o.boxnowLockerName ?? o.lockerName ?? o.name),
    address: [s(o.boxnowLockerAddressLine1 ?? o.lockerAddress), s(o.boxnowLockerAddressLine2)].filter(Boolean).join(', '),
    postalCode: s(o.boxnowLockerPostalCode ?? o.lockerPostalCode ?? o.postalCode),
  }
}

export function BoxNowPicker({
  widgetUrl,
  partnerId,
  value,
  onChange,
  labels,
  error,
}: {
  widgetUrl: string
  partnerId: string
  value: Locker | null
  onChange: (l: Locker) => void
  labels: { choose: string; change: string; chosen: string; close: string; mapTitle: string }
  error?: string
}) {
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!open) return
    dialog.current?.showModal()
    const onMessage = (e: MessageEvent) => {
      if (!ORIGIN.test(e.origin)) return
      const r = readLocker(e.data)
      if (r === 'close') setOpen(false)
      else if (r) {
        onChange(r)
        setOpen(false)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [open, onChange])

  useEffect(() => {
    if (!open) dialog.current?.close()
  }, [open])

  const src = `${widgetUrl}/?partnerId=${encodeURIComponent(partnerId)}&gps=yes&autoclose=yes&autoselect=no`

  return (
    <div className="mt-6">
      {value ? (
        <div className={`flex items-start justify-between gap-4 border p-4 ${error ? 'border-sale' : 'border-accent bg-paper'}`}>
          <div className="text-sm">
            <p className="label text-muted">{labels.chosen}</p>
            <p className="mt-1 font-medium text-heading">{value.name || `BOX NOW ${value.id}`}</p>
            <p className="text-muted">{[value.address, value.postalCode].filter(Boolean).join(', ')}</p>
          </div>
          <button type="button" className="btn btn-ghost shrink-0" onClick={() => setOpen(true)}>
            {labels.change}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-secondary w-full" onClick={() => setOpen(true)}>
          {labels.choose}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-sale">{error}</p>}

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-label={labels.mapTitle}
        className="m-auto h-[85dvh] w-[min(64rem,94vw)] max-w-none overflow-hidden rounded-2xl border border-line bg-paper p-0 text-ink backdrop:bg-black/70"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-medium text-heading">{labels.mapTitle}</p>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              {labels.close}
            </button>
          </div>
          {open && (
            <iframe
              title={labels.mapTitle}
              src={src}
              className="w-full flex-1 bg-white"
              allow="geolocation"
            />
          )}
        </div>
      </dialog>
    </div>
  )
}
