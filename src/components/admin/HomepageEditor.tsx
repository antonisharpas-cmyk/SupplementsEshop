'use client'

/* ============================================================================
 * The homepage editor.
 *
 * Top: the order of the sections — drag a row, flip its switch to hide it.
 * Below: one panel per section, in that same order, each either
 *   AUTOMATIC  — a read-only preview of what the shop is choosing right now
 *   HAND-PICKED — cards to drag into order, remove, or add to.
 *
 * Every change saves on its own, the moment you let go. If a save fails the
 * screen goes back to what is actually stored and says why; it never shows an
 * order the homepage is not using.
 *
 * Switching a section to hand-picked starts from what it is showing now, so
 * the first thing the owner sees is today's homepage, ready to rearrange —
 * not an empty box.
 * ========================================================================== */

import { useEffect, useMemo, useState } from 'react'
import type { PickerProduct } from '@/lib/admin'
import type { LayoutKey, SectionConfig, SectionKey, SectionMode } from '@/lib/homepage'
import { DragHandle, Sortable } from './Sortable'

export type PickerCategory = { id: string; name: string; department: string; image: string | null }

type Props = {
  initialLayout: SectionConfig[]
  initialItems: Record<SectionKey, string[]>
  products: PickerProduct[]
  categories: PickerCategory[]
  autoIds: Record<SectionKey, string[]>
  limits: Record<SectionKey, number>
  autoCounts: Record<SectionKey, number>
}

const TITLES: Record<LayoutKey, string> = {
  categories: 'Shop by category',
  trending: 'Moving fast',
  new_in: 'Just dropped (new in)',
  newsletter: 'Be first to know, newsletter sign-up',
  on_sale: 'On sale',
}

type Status = { state: 'idle' | 'saving' | 'saved' | 'error'; message?: string }

async function put(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? null : (data.message ?? 'Could not save that.')
  } catch {
    return 'Could not reach the server.'
  }
}

export function HomepageEditor({
  initialLayout,
  initialItems,
  products,
  categories,
  autoIds,
  limits,
  autoCounts,
}: Props) {
  const [layout, setLayout] = useState(initialLayout)
  const [items, setItems] = useState(initialItems)
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [picker, setPicker] = useState<SectionKey | null>(null)

  /* "Saved" says its piece and leaves; errors stay until the next action. */
  useEffect(() => {
    if (status.state !== 'saved') return
    const t = setTimeout(() => setStatus({ state: 'idle' }), 2600)
    return () => clearTimeout(t)
  }, [status])

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const autoText: Record<SectionKey, string> = {
    categories: 'The first four sections of each department, in menu order.',
    trending: `The ${autoCounts.trending} most-viewed products, as a moving strip.`,
    new_in: `The ${autoCounts.new_in} most recently added products.`,
    on_sale: `Up to ${autoCounts.on_sale} products that are reduced right now, newest first.`,
  }

  /* ------------------------------------------------------------- saving -- */

  async function saveLayout(next: SectionConfig[], previous: SectionConfig[]) {
    setLayout(next)
    setStatus({ state: 'saving' })
    const error = await put('/api/admin/homepage', {
      sections: next.map(({ key, isVisible, mode }) => ({ key, isVisible, mode })),
    })
    if (error) {
      setLayout(previous)
      setStatus({ state: 'error', message: error })
    } else {
      setStatus({ state: 'saved' })
    }
  }

  async function saveItems(key: SectionKey, ids: string[]) {
    const previous = items[key]
    setItems((all) => ({ ...all, [key]: ids }))
    setStatus({ state: 'saving' })
    const error = await put(`/api/admin/homepage/${key}`, { ids })
    if (error) {
      setItems((all) => ({ ...all, [key]: previous }))
      setStatus({ state: 'error', message: error })
      return false
    }
    setStatus({ state: 'saved' })
    return true
  }

  async function setMode(key: SectionKey, mode: SectionMode) {
    const section = layout.find((s) => s.key === key)!
    if (section.mode === mode) return
    /* First time hand-picking: begin from what customers see today. */
    if (mode === 'manual' && items[key].length === 0 && autoIds[key].length > 0) {
      const ok = await saveItems(key, autoIds[key].slice(0, limits[key]))
      if (!ok) return
    }
    await saveLayout(
      layout.map((s) => (s.key === key ? { ...s, mode } : s)),
      layout,
    )
  }

  /* ------------------------------------------------------------- render -- */

  return (
    <div className="space-y-10">
      <SaveBar status={status} />

      {/* ------------------------------------------------ section order --- */}
      <section className="border border-line bg-paper">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">Order of the page</h2>
          <p className="mt-0.5 text-sm text-muted">
            Drag a row to move it. The switch hides a section without losing what you picked for it.
          </p>
        </div>

        <ul className="divide-y divide-[var(--color-line)] bg-paper-2/60 text-sm text-muted">
          {['Hero video', 'Promotion strip, when a promotion is running'].map((label) => (
            <li key={label} className="flex items-center gap-3 px-5 py-3">
              <span className="grid h-8 w-8 place-items-center text-xs" aria-hidden="true">
                ⎯
              </span>
              <span className="flex-1">{label}</span>
              <span className="label">Always at the top</span>
            </li>
          ))}
        </ul>

        <Sortable
          items={layout}
          getId={(s) => s.key}
          describe={(s) => TITLES[s.key]}
          onChange={(next) => saveLayout(next, layout)}
          className="divide-y divide-[var(--color-line)] border-t border-line"
          renderItem={(section, { index, dragging, handle }) => (
            <div
              className={`flex items-center gap-3 bg-paper px-5 py-3.5 ${dragging ? 'ring-1 ring-accent' : ''}`}
            >
              <DragHandle handle={handle} />
              <span className="w-5 text-sm tabular-nums text-muted">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={`font-medium ${section.isVisible ? '' : 'text-muted line-through'}`}>
                  {TITLES[section.key]}
                </p>
                <p className="truncate text-xs text-muted">
                  {section.key === 'newsletter'
                    ? 'Email sign-up for new arrivals, nothing to pick'
                    : section.mode === 'auto'
                    ? 'Automatic'
                    : `Hand-picked · ${items[section.key as SectionKey].length} ${
                        section.key === 'categories' ? 'categories' : 'products'
                      }`}
                </p>
              </div>
              <Switch
                on={section.isVisible}
                label={section.isVisible ? 'Showing' : 'Hidden'}
                onToggle={() =>
                  saveLayout(
                    layout.map((s) => (s.key === section.key ? { ...s, isVisible: !s.isVisible } : s)),
                    layout,
                  )
                }
              />
            </div>
          )}
        />
      </section>

      {/* ------------------------------------------------ section panels --- */}
      {layout.map((section) => {
        /* The sign-up has no items, so no panel. */
        if (section.key === 'newsletter') return null
        const key = section.key
        const isCategories = key === 'categories'
        const ids = section.mode === 'manual' ? items[key] : autoIds[key]
        const warnings: string[] = []
        if (!section.isVisible) warnings.push('Hidden, customers do not see this section.')
        if (section.mode === 'manual' && items[key].length === 0)
          warnings.push('Nothing picked yet, so this section is not shown.')
        if (key === 'trending' && section.mode === 'manual' && items[key].length > 0 && items[key].length < 3)
          warnings.push('Moving fast needs at least 3 products before it appears.')

        return (
          <section key={key} className="border border-line bg-paper">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-semibold">{TITLES[key]}</h2>
                <p className="mt-0.5 text-sm text-muted">
                  {section.mode === 'auto'
                    ? autoText[key]
                    : `Exactly these, in this order, drag to rearrange. Up to ${limits[key]}.`}
                </p>
              </div>
              <Segmented
                value={section.mode}
                onChange={(mode) => setMode(key, mode)}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  { value: 'manual', label: 'Hand-picked' },
                ]}
              />
            </div>

            {warnings.length > 0 && (
              <div className="border-b border-amber-500/30 bg-amber-50 px-5 py-2.5 text-sm text-amber-900">
                {warnings.join(' ')}
              </div>
            )}

            <div className="p-5">
              {section.mode === 'auto' ? (
                /* A preview, not an editor: this list changes on its own. */
                <div className="grid grid-cols-3 gap-3 opacity-90 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                  {ids.map((id) => (
                    <Thumb
                      key={id}
                      {...(isCategories ? categoryThumb(categoryById.get(id)) : productThumb(productById.get(id)))}
                    />
                  ))}
                  {ids.length === 0 && (
                    <p className="col-span-full text-sm text-muted">Nothing qualifies right now.</p>
                  )}
                </div>
              ) : (
                <>
                  <Sortable
                    items={items[key]}
                    getId={(id) => id}
                    describe={(id) =>
                      isCategories
                        ? (categoryById.get(id)?.name ?? 'Category')
                        : (productById.get(id)?.name ?? 'Product')
                    }
                    onChange={(next) => saveItems(key, next)}
                    className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                    renderItem={(id, { index, dragging, handle }) => {
                      const thumb = isCategories
                        ? categoryThumb(categoryById.get(id))
                        : productThumb(productById.get(id), key === 'on_sale')
                      return (
                        <Card
                          {...thumb}
                          index={index}
                          dragging={dragging}
                          handle={<DragHandle handle={handle} className="bg-paper/90 backdrop-blur-sm" />}
                          onRemove={() => saveItems(key, items[key].filter((x) => x !== id))}
                        />
                      )
                    }}
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setPicker(key)}
                      disabled={items[key].length >= limits[key]}
                      className="btn btn-primary btn-sm"
                    >
                      + Add {isCategories ? 'categories' : 'products'}
                    </button>
                    <span className="text-sm tabular-nums text-muted">
                      {items[key].length} of {limits[key]}
                    </span>
                  </div>
                </>
              )}
            </div>
          </section>
        )
      })}

      {picker && (
        <Picker
          title={`Add to ${TITLES[picker]}`}
          onClose={() => setPicker(null)}
          room={limits[picker] - items[picker].length}
          options={
            picker === 'categories'
              ? categories
                  .filter((c) => !items.categories.includes(c.id))
                  .map((c) => ({ id: c.id, ...categoryThumb(c), blocked: null }))
              : products
                  .filter((p) => !items[picker].includes(p.id))
                  .map((p) => ({
                    id: p.id,
                    ...productThumb(p),
                    blocked: !p.isActive
                      ? 'Hidden from the shop'
                      : picker === 'on_sale' && !p.isOnSale
                        ? 'Not reduced, give it a sale price first'
                        : null,
                  }))
          }
          onAdd={(ids) => {
            const key = picker
            setPicker(null)
            void saveItems(key, [...items[key], ...ids].slice(0, limits[key]))
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------ thumbnails -- */

type ThumbData = { title: string; sub: string; image: string | null; note: string | null }

function productThumb(p: PickerProduct | undefined, mustBeOnSale = false): ThumbData {
  if (!p) return { title: 'Removed product', sub: '', image: null, note: 'No longer exists' }
  return {
    title: p.name,
    sub: p.category,
    image: p.image,
    note: !p.isActive
      ? 'Hidden from the shop, not shown'
      : mustBeOnSale && !p.isOnSale
        ? 'Sale ended, not shown'
        : null,
  }
}

function categoryThumb(c: PickerCategory | undefined): ThumbData {
  if (!c) return { title: 'Removed category', sub: '', image: null, note: 'No longer exists' }
  return { title: c.name, sub: c.department, image: c.image, note: null }
}

function Thumb({ title, sub, image }: ThumbData) {
  return (
    <div>
      <div className="aspect-3/4 overflow-hidden border border-line bg-paper-2">
        {image && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <p className="mt-1.5 truncate text-xs">{title}</p>
      <p className="truncate text-[11px] text-muted">{sub}</p>
    </div>
  )
}

function Card({
  title,
  sub,
  image,
  note,
  index,
  dragging,
  handle,
  onRemove,
}: ThumbData & {
  index: number
  dragging: boolean
  handle: React.ReactNode
  onRemove: () => void
}) {
  return (
    <div className={`group h-full border bg-paper p-2 ${dragging ? 'border-ink' : 'border-line'}`}>
      <div className="relative aspect-3/4 overflow-hidden bg-paper-2">
        {image && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={image} alt="" draggable={false} className="h-full w-full select-none object-cover" />
        )}
        <span className="absolute bottom-1.5 left-1.5 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-paper">
          {index + 1}
        </span>
        <div className="absolute top-1.5 left-1.5">{handle}</div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          title="Remove"
          className="absolute top-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-sm bg-paper/90 text-muted opacity-100 backdrop-blur-sm transition hover:text-sale md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-medium">{title}</p>
      <p className="line-clamp-1 text-xs text-muted">{sub}</p>
      {note && <p className="mt-1 text-xs text-sale">{note}</p>}
    </div>
  )
}

/* ---------------------------------------------------------------- picker -- */

function Picker({
  title,
  options,
  room,
  onAdd,
  onClose,
}: {
  title: string
  options: (ThumbData & { id: string; blocked: string | null })[]
  room: number
  onAdd: (ids: string[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const shown = options.filter((o) =>
    `${o.title} ${o.sub}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < room ? [...c, id] : c))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col bg-paper shadow-2xl">
        <div className="flex items-center gap-4 border-b border-line px-5 py-4">
          <h3 className="flex-1 font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="label text-muted hover:text-ink">
            Close
          </button>
        </div>
        <div className="border-b border-line px-5 py-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full border border-line px-3.5 py-2.5 outline-none focus:border-accent"
          />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 md:grid-cols-5">
          {shown.map((o) => {
            const on = chosen.includes(o.id)
            return (
              <button
                key={o.id}
                type="button"
                disabled={Boolean(o.blocked)}
                onClick={() => toggle(o.id)}
                aria-pressed={on}
                className={`relative border p-2 text-left transition ${
                  on ? 'border-ink ring-1 ring-accent' : 'border-line hover:border-ink'
                } disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-line`}
              >
                <div className="aspect-3/4 overflow-hidden bg-paper-2">
                  {o.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={o.image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-2 line-clamp-1 text-sm">{o.title}</p>
                <p className="line-clamp-1 text-xs text-muted">{o.blocked ?? o.sub}</p>
                {on && (
                  <span className="absolute top-3 right-3 grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-paper">
                    ✓
                  </span>
                )}
              </button>
            )
          })}
          {shown.length === 0 && (
            <p className="col-span-full text-sm text-muted">
              {options.length === 0 ? 'Everything is already in this section.' : 'Nothing matches that.'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-5 py-4">
          <span className="flex-1 text-sm text-muted">
            {chosen.length ? `${chosen.length} selected` : 'Click to select'} · room for {room}
          </span>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => onAdd(chosen)}
            className="btn btn-primary"
          >
            Add {chosen.length || ''}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ controls -- */

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex items-center gap-2 text-sm text-muted"
    >
      <span className="w-14 text-right">{label}</span>
      <span
        className={`relative inline-block h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-line'}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform ${
            on ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}

function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V
  options: { value: V; label: string }[]
  onChange: (v: V) => void
}) {
  return (
    <div role="radiogroup" className="inline-flex border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-4 py-2 label transition ${
            value === o.value ? 'bg-accent text-paper' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SaveBar({ status }: { status: Status }) {
  /* Fixed to the corner rather than the top of the page: the owner is usually
     halfway down, dragging, when the answer arrives. */
  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed right-5 bottom-5 z-[90] max-w-sm border px-4 py-3 text-sm shadow-lg transition-opacity duration-300 ${
        status.state === 'idle' ? 'opacity-0' : 'opacity-100'
      } ${status.state === 'error' ? 'border-sale/40 bg-paper text-sale' : 'border-line bg-paper text-ink'}`}
    >
      {status.state === 'saving' && 'Saving…'}
      {status.state === 'saved' && '✓ Saved, live on the homepage'}
      {status.state === 'error' && `Not saved: ${status.message} It has been put back as it was.`}
    </div>
  )
}
