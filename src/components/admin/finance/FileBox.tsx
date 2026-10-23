'use client'

/* The files kept with a record: supplier invoice, receipt, photos. Drop or
   choose files; photos are shrunk first. */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { uploadFiles } from './shared'

export type KeptFile = { id: string; filename: string; contentType: string; size: number }

export function FileBox({ type, id, files, label = 'Files', canDelete = true }: { type: string; id: string; files: KeptFile[]; label?: string; canDelete?: boolean }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  async function add(list: FileList | File[]) {
    if (!list.length) return
    setBusy(true)
    setErr(null)
    const e = await uploadFiles(type, id, list)
    setBusy(false)
    if (e) setErr(e)
    else router.refresh()
  }
  async function remove(fileId: string) {
    if (!window.confirm('Remove this file?')) return
    await fetch(`/api/admin/finance/files/${fileId}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <h2 className="label text-muted">{label}</h2>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 py-2">
              <a href={`/api/admin/finance/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate underline-offset-4 hover:text-accent hover:underline">
                <span className="mr-2 rounded bg-paper-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{f.contentType === 'application/pdf' ? 'PDF' : 'PHOTO'}</span>{f.filename}
              </a>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                {Math.max(1, Math.round(f.size / 1024))} KB
                {canDelete && (
                  <button type="button" className="hover:text-sale" onClick={() => void remove(f.id)}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          void add(e.dataTransfer.files)
        }}
        className={`mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted ${over ? 'border-accent bg-accent/5' : 'border-line'}`}
      >
        <p>Drop a photo or PDF here, or</p>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Uploading…' : 'Choose files'}
        </button>
        <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files && void add(e.target.files)} />
        <p>Photos are made smaller automatically. Up to 8 MB each.</p>
      </div>
      {err && <p className="mt-2 text-xs text-sale">{err}</p>}
    </section>
  )
}
