'use client'

/* Photos for many products at once: each file named by the flavour's
   barcode (5901330098765.jpg, 5901330098765_2.jpg for a second one) or its
   SKU. Choose them all, see where each goes, upload. */

import { useRef, useState } from 'react'
import { btn } from '@/components/admin/ui'

type Match = { filename: string; code: string; productId: string | null; variantId: string | null; label: string | null; photos: number }
type Item = Match & { file: File; state: 'ready' | 'skip' | 'sending' | 'done' | 'failed'; error?: string }

/** Large photos are made smaller in the browser (longest side 2000 px) so
 *  they stay under the 6 MB limit and the shop loads fast. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88))
    return blob ? new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '.jpg'), { type: 'image/jpeg' }) : file
  } catch {
    return file
  }
}

export function PhotoImport() {
  const ref = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [skipHave, setSkipHave] = useState(true)
  const [drag, setDrag] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function choose(list: FileList | File[]) {
    const files = [...list].filter((f) => f.type.startsWith('image/')).slice(0, 500)
    if (files.length === 0) return
    setMsg(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/products/photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: files.map((f) => f.name) }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; matches?: Match[] }
      if (!res.ok || !data.matches) return setMsg({ ok: false, text: data.message ?? 'That did not work.' })
      setItems(data.matches.map((m, i) => ({ ...m, file: files[i], state: m.variantId ? 'ready' : 'skip' })))
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  const goes = (it: Item) => it.variantId && it.state !== 'done' && !(skipHave && it.photos > 0)
  const toSend = items.filter(goes)

  async function upload() {
    setBusy(true)
    setMsg(null)
    let done = 0
    let failed = 0
    for (const it of toSend) {
      setItems((all) => all.map((x) => (x === it ? { ...x, state: 'sending' } : x)))
      let state: Item['state'] = 'done'
      let error: string | undefined
      try {
        const form = new FormData()
        form.append('file', await shrink(it.file))
        form.append('name', it.filename)
        const res = await fetch('/api/admin/products/photos', { method: 'PUT', body: form })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
        if (!res.ok || !data.ok) {
          state = 'failed'
          error = data.message ?? 'Not saved'
        }
      } catch {
        state = 'failed'
        error = 'Could not reach the server'
      }
      if (state === 'done') done++
      else failed++
      setItems((all) => all.map((x) => (x.filename === it.filename && x.file === it.file ? { ...x, state, error } : x)))
    }
    setBusy(false)
    setMsg({ ok: failed === 0, text: `${done} photo${done === 1 ? '' : 's'} added${failed ? `, ${failed} not saved (see the list)` : ''}. The first photo of a product is the one on its card; change the order on the product's page.` })
  }

  const unmatched = items.filter((i) => !i.variantId).length

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void choose(e.dataTransfer.files)
        }}
        className={`rounded-2xl border-2 border-dashed p-6 text-sm ${drag ? 'border-accent bg-accent/5' : 'border-line bg-paper'}`}
      >
        <p>
          Name each photo with the barcode (EAN) of its flavour, for example <span className="font-mono">5901330098765.jpg</span>. A second photo of the same flavour:{' '}
          <span className="font-mono">5901330098765_2.jpg</span>. The product&apos;s SKU works too.
        </p>
        <p className="mt-1 text-muted">Do this after step 1, so the products exist. Drop all the photos here, or choose them.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={btn.secondary} disabled={busy} onClick={() => ref.current?.click()}>
            Choose photos
          </button>
          <input
            ref={ref}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void choose(e.target.files)
              e.target.value = ''
            }}
          />
          {items.length > 0 && (
            <>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={skipHave} onChange={(e) => setSkipHave(e.target.checked)} />
                Skip flavours that already have a photo
              </label>
              <button type="button" className={btn.primary} disabled={busy || toSend.length === 0} onClick={() => void upload()}>
                {busy ? 'Uploading…' : `Upload ${toSend.length} photo${toSend.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}

      {items.length > 0 && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <p className="text-sm">
            {items.length - unmatched} of {items.length} photos found their product.
            {unmatched > 0 && <span className="text-sale"> {unmatched === 1 ? '1 has' : `${unmatched} have`} a name no product has; check the barcode in the name, or that the product was imported.</span>}
          </p>
          <div className="mt-4 max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-2">File</th>
                  <th>Goes to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={`${it.filename}-${i}`} className="border-t border-line">
                    <td className="py-2 font-mono text-xs">{it.filename}</td>
                    <td>{it.label ?? <span className="text-sale">No product with {it.code}</span>}</td>
                    <td className="pl-3 text-xs">
                      {it.state === 'done' ? (
                        <span className="text-ok">Added</span>
                      ) : it.state === 'sending' ? (
                        <span className="text-muted">Uploading…</span>
                      ) : it.state === 'failed' ? (
                        <span className="text-sale">{it.error}</span>
                      ) : it.variantId && skipHave && it.photos > 0 ? (
                        <span className="text-muted">Has a photo already, skipped</span>
                      ) : it.variantId ? (
                        <span>Ready</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
