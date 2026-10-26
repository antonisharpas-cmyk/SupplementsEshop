'use client'

/* The category tree, editable in place: add a range, a group inside it, or a
   section inside a group; rename in three languages; move up or down; show
   or hide; delete when empty. */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminCategory } from '@/lib/admin-categories'
import { btn, input } from '@/components/admin/ui'

type Names = { en: string; el: string; ru: string }
const blank: Names = { en: '', el: '', ru: '' }

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null)
  const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
  return res?.ok && data?.ok ? null : (data?.message ?? 'Something went wrong. Try again.')
}

/** Large pictures are made smaller in the browser first (longest side
 *  1600 px, WebP keeps a transparent background). */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.86))
    return blob && blob.type === 'image/webp' ? new File([blob], file.name.replace(/\.[a-z0-9]+$/i, '.webp'), { type: 'image/webp' }) : file
  } catch {
    return file
  }
}

const LEVEL = ['Range', 'Group', 'Section']
const CHILD = ['group', 'section']

function NameFields({ value, onChange, autoFocus }: { value: Names; onChange: (n: Names) => void; autoFocus?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <input className={input} placeholder="Name in English" value={value.en} onChange={(e) => onChange({ ...value, en: e.target.value })} autoFocus={autoFocus} required />
      <input className={input} placeholder="Greek (optional)" value={value.el} onChange={(e) => onChange({ ...value, el: e.target.value })} />
      <input className={input} placeholder="Russian (optional)" value={value.ru} onChange={(e) => onChange({ ...value, ru: e.target.value })} />
    </div>
  )
}

function AddForm({ parentId, label, onDone }: { parentId: string | null; label: string; onDone: () => void }) {
  const router = useRouter()
  const [names, setNames] = useState<Names>(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="space-y-3 rounded-2xl border border-accent/40 bg-accent/5 p-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const err = await call('/api/admin/categories', 'POST', { parentId, name: names })
        setBusy(false)
        if (err) return setError(err)
        setNames(blank)
        onDone()
        router.refresh()
      }}
    >
      <p className="text-sm font-medium text-heading">{label}</p>
      <NameFields value={names} onChange={setNames} autoFocus />
      {error && <p className="text-sm text-sale">{error}</p>}
      <div className="flex gap-2">
        <button className={btn.primary} disabled={busy || !names.en.trim()}>
          {busy ? 'Adding' : 'Add'}
        </button>
        <button type="button" className={btn.quiet} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Row({ node, first, last }: { node: AdminCategory; first: boolean; last: boolean }) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view')
  const [names, setNames] = useState<Names>({ en: node.name.en ?? '', el: node.name.el ?? '', ru: node.name.ru ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = (file: File) =>
    act(async () => {
      const form = new FormData()
      form.append('file', await shrink(file))
      const res = await fetch(`/api/admin/categories/${node.id}/photo`, { method: 'POST', body: form }).catch(() => null)
      const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      return res?.ok && data?.ok ? null : (data?.message ?? 'That picture could not be saved.')
    })

  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    setError(null)
    const err = await fn()
    setBusy(false)
    if (err) setError(err)
    else router.refresh()
    return err
  }
  const total = (n: AdminCategory): number => n.products + n.children.reduce((k, c) => k + total(c), 0)

  return (
    <li>
      <div
        className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
          node.depth === 1 ? 'border-line bg-paper-2' : 'border-line/70 bg-paper'
        } ${node.isActive ? '' : 'opacity-60'}`}
      >
        {node.depth > 1 && (
          <button
            type="button"
            title={node.imageUrl ? 'Change the picture' : 'Add a picture'}
            onClick={() => fileRef.current?.click()}
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-paper-2 text-[10px] text-muted hover:border-accent"
          >
            {node.imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={node.imageUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              'Picture'
            )}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void upload(f)
          }}
        />
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">
          {LEVEL[node.depth - 1]}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${node.depth === 1 ? 'font-display text-base font-semibold text-heading' : 'text-ink'}`}>
            {node.name.en}
          </span>
          <span className="block truncate text-xs text-muted">
            {[node.name.el, node.name.ru].filter(Boolean).join(' · ') || 'No Greek or Russian name yet'} · {total(node)} product
            {total(node) === 1 ? '' : 's'}
            {node.isActive ? '' : ' · hidden'}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" title="Move up" aria-label="Move up" disabled={busy || first} onClick={() => act(() => call(`/api/admin/categories/${node.id}`, 'PATCH', { move: 'up' }))} className="btn btn-ghost btn-sm px-2.5">
            ↑
          </button>
          <button type="button" title="Move down" aria-label="Move down" disabled={busy || last} onClick={() => act(() => call(`/api/admin/categories/${node.id}`, 'PATCH', { move: 'down' }))} className="btn btn-ghost btn-sm px-2.5">
            ↓
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>
            Rename
          </button>
          {node.depth > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {node.imageUrl ? 'Change picture' : 'Add picture'}
            </button>
          )}
          {node.depth > 1 && node.imageUrl && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => window.confirm(`Remove the picture of ${node.name.en}? Its homepage tile will show just the name.`) && act(() => call(`/api/admin/categories/${node.id}/photo`, 'DELETE'))}
            >
              Remove picture
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => act(() => call(`/api/admin/categories/${node.id}`, 'PATCH', { isActive: !node.isActive }))}
          >
            {node.isActive ? 'Hide' : 'Show'}
          </button>
          {node.depth < 3 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMode(mode === 'add' ? 'view' : 'add')}>
              + Add {CHILD[node.depth - 1]}
            </button>
          )}
          {!confirmDelete ? (
            <button type="button" className="btn btn-ghost btn-sm text-sale" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          ) : (
            <>
              <button
                type="button"
                className={btn.danger}
                disabled={busy}
                onClick={async () => {
                  await act(() => call(`/api/admin/categories/${node.id}`, 'DELETE'))
                  setConfirmDelete(false)
                }}
              >
                Yes, delete
              </button>
              <button type="button" className={btn.quiet} onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          )}
        </span>
      </div>
      {error && <p className="mt-1.5 px-2 text-sm text-sale">{error}</p>}

      {mode === 'edit' && (
        <form
          className="mt-2 space-y-3 rounded-2xl border border-line bg-paper p-4"
          onSubmit={async (e) => {
            e.preventDefault()
            const err = await act(() => call(`/api/admin/categories/${node.id}`, 'PATCH', { name: names }))
            if (!err) setMode('view')
          }}
        >
          <NameFields value={names} onChange={setNames} autoFocus />
          <p className="text-xs text-muted">The web address stays the same, so links and bookmarks keep working.</p>
          <div className="flex gap-2">
            <button className={btn.primary} disabled={busy || !names.en.trim()}>
              Save
            </button>
            <button type="button" className={btn.quiet} onClick={() => setMode('view')}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {(node.children.length > 0 || mode === 'add') && (
        <ul className="mt-2 ml-4 space-y-2 border-l border-line pl-4 sm:ml-6 sm:pl-5">
          {node.children.map((c, i) => (
            <Row key={c.id} node={c} first={i === 0} last={i === node.children.length - 1} />
          ))}
          {mode === 'add' && (
            <li>
              <AddForm parentId={node.id} label={`New ${CHILD[node.depth - 1]} inside ${node.name.en}`} onDone={() => setMode('view')} />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

export function CategoryManager({ tree }: { tree: AdminCategory[] }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="space-y-4">
      <ul className="space-y-4">
        {tree.map((n, i) => (
          <Row key={n.id} node={n} first={i === 0} last={i === tree.length - 1} />
        ))}
      </ul>
      {adding ? (
        <AddForm parentId={null} label="New range (shows in the main menu)" onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
          + Add range
        </button>
      )}
    </div>
  )
}
