'use client'

/* ============================================================================
 * A product's photos: upload, remove, and drag to change which one leads.
 *
 * The first photo is the one on every product card and at the top of the
 * product page. The second is the one a card fades to when the pointer is
 * over it. The order is saved the moment you let go; a failed save puts it
 * back. Uploads accept several files at once, by button or by dropping them
 * on the box.
 * ========================================================================== */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DragHandle, Sortable } from './Sortable'
import { btn } from './ui'
import { shrinkPhoto } from '@/lib/shrink-photo'

type Photo = { id: string; url: string; variantId?: string | null }
type Option = { id: string; label: string }

const ROLE = ['Main photo', 'On hover']

export function PhotoOrder({ productId, photos, variants = [] }: { productId: string; photos: Photo[]; variants?: Option[] }) {
  const router = useRouter()
  const [order, setOrder] = useState(photos)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  /* The server's list wins whenever the page refreshes. */
  const [seen, setSeen] = useState(photos)
  if (seen !== photos) {
    setSeen(photos)
    setOrder(photos)
  }

  async function save(next: Photo[]) {
    const previous = order
    setOrder(next)
    setStatus('saving')
    try {
      const res = await fetch(`/api/admin/products/${productId}/images`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: next.map((p) => p.id) }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) throw new Error(data.message ?? 'Could not save that order.')
      setStatus('saved')
      setMessage('Saved. The shop shows this order now.')
      router.refresh()
    } catch (err) {
      setOrder(previous)
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Could not save that order.')
    }
  }

  async function upload(files: FileList | File[] | null) {
    const list = Array.from(files ?? [])
    if (!list.length) return
    setStatus('saving')
    /* One photo per request. Several large photos in one request went over
       the server's 10 MB request limit and the upload failed; one at a time,
       each made smaller first, always fits, and one bad file does not stop
       the others. */
    let added = 0
    const failed: string[] = []
    for (const [i, original] of list.entries()) {
      setMessage(`Uploading photo ${i + 1} of ${list.length}…`)
      try {
        const form = new FormData()
        form.append('file', await shrinkPhoto(original))
        const res = await fetch(`/api/admin/products/${productId}/images`, { method: 'POST', body: form })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; added?: Photo[] }
        if (data.added?.length) setOrder((o) => [...o, ...data.added!])
        if (!res.ok || !data.ok) throw new Error(data.message ?? 'Not saved')
        added++
      } catch (err) {
        failed.push(`${original.name}: ${err instanceof Error && err.message !== 'Failed to fetch' ? err.message : 'could not reach the server'}`)
      }
    }
    if (input.current) input.current.value = ''
    setStatus(failed.length ? 'error' : 'saved')
    setMessage(
      `Added ${added} photo${added === 1 ? '' : 's'}.` + (failed.length ? ` Not saved, try these again: ${failed.join('; ')}` : ''),
    )
    if (added) router.refresh()
  }

  /* Which flavour a photo shows: the shop then shows it when that flavour
     is chosen. "Every flavour" keeps it for the whole product. */
  async function assign(photo: Photo, variantId: string | null) {
    const previous = order
    setOrder(order.map((p) => (p.id === photo.id ? { ...p, variantId } : p)))
    setStatus('saving')
    setMessage('Saving…')
    try {
      const res = await fetch(`/api/admin/products/${productId}/images/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) throw new Error(data.message ?? 'Could not save that.')
      setStatus('saved')
      setMessage('Saved.')
      router.refresh()
    } catch (err) {
      setOrder(previous)
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  async function remove(photo: Photo) {
    if (!window.confirm('Remove this photo from the product?')) return
    const previous = order
    setOrder(order.filter((p) => p.id !== photo.id))
    setStatus('saving')
    setMessage('Removing…')
    try {
      const res = await fetch(`/api/admin/products/${productId}/images/${photo.id}`, { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) throw new Error(data.message ?? 'Could not remove it.')
      setStatus('saved')
      setMessage('Photo removed.')
      router.refresh()
    } catch (err) {
      setOrder(previous)
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Could not remove it.')
    }
  }

  return (
    <div>
      {order.length > 0 && (
        <Sortable
          items={order}
          getId={(p) => p.id}
          describe={(p) => `Photo ${order.indexOf(p) + 1}`}
          onChange={save}
          className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4"
          renderItem={(photo, { index, dragging, handle }) => (
            <figure className={`h-full border bg-paper p-2 ${dragging ? 'border-accent' : 'border-line'}`}>
              <div className="relative aspect-3/4 overflow-hidden bg-paper-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="" draggable={false} className="h-full w-full select-none object-cover" />
                <div className="absolute top-1.5 left-1.5">
                  <DragHandle handle={handle} className="bg-paper/90 backdrop-blur-sm" />
                </div>
                <button
                  type="button"
                  onClick={() => void remove(photo)}
                  aria-label={`Remove photo ${index + 1}`}
                  title="Remove photo"
                  className="absolute top-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-sm bg-paper/90 text-muted backdrop-blur-sm transition hover:text-sale"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                    <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" />
                  </svg>
                </button>
              </div>
              <figcaption className={`mt-2 text-xs ${index < 2 ? 'font-medium' : 'text-muted'}`}>
                {ROLE[index] ?? `Photo ${index + 1}`}
              </figcaption>
              {variants.length > 1 && (
                <select
                  aria-label={`Photo ${index + 1} shows`}
                  value={photo.variantId ?? ''}
                  onChange={(e) => void assign(photo, e.target.value || null)}
                  className="mt-1.5 w-full rounded-md border border-line bg-paper-2 px-1.5 py-1 text-[11px] text-ink"
                >
                  <option value="">Every flavour</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </figure>
          )}
        />
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void upload(e.dataTransfer.files)
        }}
        className={`mt-4 flex max-w-3xl flex-wrap items-center gap-4 border border-dashed px-5 py-6 transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-line-strong'
        }`}
      >
        <button type="button" className={btn.primary} onClick={() => input.current?.click()} disabled={status === 'saving'}>
          Upload photos
        </button>
        <p className="text-sm text-muted">
          Or drop them here. JPG, PNG or WebP. Large photos are made smaller for you. Portrait 3:4 looks best (e.g. 1200 × 1600).
        </p>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
          multiple
          className="sr-only"
          onChange={(e) => void upload(e.target.files)}
        />
      </div>

      <p aria-live="polite" className={`mt-3 min-h-5 text-sm ${status === 'error' ? 'text-sale' : 'text-muted'}`}>
        {status !== 'idle' && message}
      </p>
    </div>
  )
}
