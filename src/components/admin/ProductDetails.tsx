'use client'

/* ============================================================================
 * A product's words: name, summary, description, nutrition and usage, and
 * the search engine text, in English, Greek and Russian; its category and
 * web address. Also the "new product" form and the delete button.
 *
 * English is required; Greek and Russian fall back to English in the shop
 * when left empty, so a product can go live before its translations do.
 * ========================================================================== */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'
import { SearchSelect } from './SearchSelect'

type L = { en: string; el: string; ru: string }
const empty: L = { en: '', el: '', ru: '' }
const toL = (v: Record<string, string> | null | undefined): L => ({ en: v?.en ?? '', el: v?.el ?? '', ru: v?.ru ?? '' })

export type CategoryGroup = { rangeId: string; range: string; options: { id: string; label: string; group?: boolean }[] }

const LANGS: { code: keyof L; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'ru', label: 'Русский' },
]

function CategorySelect({ groups, value, onChange }: { groups: CategoryGroup[]; value: string; onChange: (v: string) => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    const r = await send('/api/admin/categories', 'POST', { parentId: parentId || null, name: { en: name } })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    const created = (r.data as { category?: { id: string; parentId: string | null } }).category
    setOpen(false)
    setName('')
    router.refresh()
    /* A brand new range cannot hold products itself; pick the new category
       only when it can. */
    if (created?.parentId) onChange(created.id)
  }

  return (
    <div>
      <SearchSelect
        value={value}
        onChange={onChange}
        required
        placeholder="Choose a category"
        searchPlaceholder="Search categories"
        options={groups.flatMap((g) => [
          { value: `h:${g.rangeId}`, label: g.range, header: true },
          ...g.options.map((o) => ({ value: o.id, label: o.label, hint: g.range })),
        ])}
      />
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-1.5 text-xs font-medium text-accent hover:underline">
          + New category
        </button>
      ) : (
        <div className="mt-2 space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <SearchSelect
            value={parentId}
            onChange={setParentId}
            searchPlaceholder="Search where to put it"
            options={[
              { value: '', label: 'A new range (main menu)' },
              ...groups.flatMap((g) => [
                { value: `h:${g.rangeId}`, label: g.range, header: true },
                { value: g.rangeId, label: `Inside ${g.range}` },
                ...g.options.filter((o) => o.group).map((o) => ({ value: o.id, label: `Inside ${g.range} › ${o.label}` })),
              ]),
            ]}
          />
          <input className={input} placeholder="Name in English, e.g. Socks" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p className="text-xs text-sale">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" className={btn.primary} disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? 'Adding' : 'Add category'}
            </button>
            <button type="button" className={btn.quiet} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted">Greek and Russian names, order and hiding: Catalogue, Categories.</p>
        </div>
      )}
    </div>
  )
}

function Labelled({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  )
}

async function send(url: string, method: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; id?: string; slug?: string }
    return res.ok && data.ok ? { ok: true as const, data } : { ok: false as const, message: data.message ?? 'Could not save that.' }
  } catch {
    return { ok: false as const, message: 'Could not reach the server.' }
  }
}

/* --------------------------------------------------------------- details -- */

export function DetailsEditor({
  productId,
  groups,
  initial,
}: {
  productId: string
  groups: CategoryGroup[]
  initial: {
    name: Record<string, string>
    summary: Record<string, string> | null
    description: Record<string, string> | null
    usage: Record<string, string> | null
    seoTitle: Record<string, string> | null
    seoDescription: Record<string, string> | null
    categoryId: string
    slug: string
  }
}) {
  const router = useRouter()
  const [lang, setLang] = useState<keyof L>('en')
  const [f, setF] = useState({
    name: toL(initial.name),
    summary: toL(initial.summary),
    description: toL(initial.description),
    usage: toL(initial.usage),
    seoTitle: toL(initial.seoTitle),
    seoDescription: toL(initial.seoDescription),
  })
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [slug, setSlug] = useState(initial.slug)
  const [state, setState] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: keyof typeof f, value: string) => setF((p) => ({ ...p, [field]: { ...p[field], [lang]: value } }))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setState(null)
    const r = await send(`/api/admin/products/${productId}/details`, 'PUT', { ...f, categoryId, slug })
    setBusy(false)
    if (!r.ok) return setState({ tone: 'bad', text: r.message })
    if (r.data.slug) setSlug(r.data.slug)
    setState({ tone: 'ok', text: 'Saved. The shop shows the new text now.' })
    router.refresh()
  }

  const missing = (code: keyof L) => code !== 'en' && !f.name[code]

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className="label text-muted">Category</span>
          <div className="mt-1.5">
            <CategorySelect groups={groups} value={categoryId} onChange={setCategoryId} />
          </div>
        </div>
        <Labelled label="Web address" hint={`Shop address: /en/products/${slug || '…'}`}>
          <input className={`${input} font-mono`} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </Labelled>
      </div>

      <div>
        <div role="tablist" aria-label="Language" className="flex gap-1 border-b border-line">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              role="tab"
              aria-selected={lang === l.code}
              onClick={() => setLang(l.code)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                lang === l.code ? 'border-accent text-heading' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {l.label}
              {missing(l.code) && <span className="ml-1.5 text-xs text-muted">(empty, shows English)</span>}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          <Labelled label="Product name">
            <input className={input} value={f.name[lang]} onChange={(e) => set('name', e.target.value)} required={lang === 'en'} maxLength={200} />
          </Labelled>
          <Labelled label="Short line" hint="Under the name on the product page, e.g. 27g protein per serving.">
            <input className={input} value={f.summary[lang]} onChange={(e) => set('summary', e.target.value)} maxLength={300} />
          </Labelled>
          <Labelled label="Description">
            <textarea rows={5} className={input} value={f.description[lang]} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </Labelled>
          <Labelled label="Nutrition & usage" hint="Directions, serving size and nutrition values. Shown under Nutrition & usage.">
            <textarea rows={4} className={input} value={f.usage[lang]} onChange={(e) => set('usage', e.target.value)} maxLength={3000} />
          </Labelled>
          <details className="border-t border-line pt-4">
            <summary className="cursor-pointer label text-muted">Google and link previews</summary>
            <div className="mt-4 space-y-4">
              <Labelled label="Title for search engines" hint="Leave empty to use the product name.">
                <input className={input} value={f.seoTitle[lang]} onChange={(e) => set('seoTitle', e.target.value)} maxLength={200} />
              </Labelled>
              <Labelled label="Description for search engines" hint="About 150 characters. Leave empty to use the short line.">
                <textarea rows={2} className={input} value={f.seoDescription[lang]} onChange={(e) => set('seoDescription', e.target.value)} maxLength={400} />
              </Labelled>
            </div>
          </details>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button className={btn.primary} disabled={busy}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
        {state && (
          <p role={state.tone === 'bad' ? 'alert' : 'status'} className={`text-sm ${state.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>
            {state.text}
          </p>
        )}
      </div>
    </form>
  )
}

/* ----------------------------------------------------------- new product -- */

export function NewProductForm({ groups }: { groups: CategoryGroup[] }) {
  const router = useRouter()
  const [name, setName] = useState<L>(empty)
  const [categoryId, setCategoryId] = useState('')
  const [price, setPrice] = useState('')
  const [size, setSize] = useState('')
  const [flavour, setFlavour] = useState('')
  const [stock, setStock] = useState('0')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = price.trim().replace(',', '.')
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed) || Number(trimmed) <= 0) return setError('Enter the price in euros, e.g. 39.90.')
    if (!size.trim()) return setError('Enter the pack size, e.g. 1kg or 90 caps.')
    if (!/^\d+$/.test(stock.trim())) return setError('Enter how many are on the shelf, e.g. 20.')
    setBusy(true)
    setError(null)
    const r = await send('/api/admin/products', 'POST', {
      name,
      categoryId,
      priceCents: Math.round(Number(trimmed) * 100),
      firstSize: size,
      firstFlavour: flavour,
      firstStock: Number(stock.trim()),
    })
    if (!r.ok) {
      setBusy(false)
      return setError(r.message)
    }
    router.push(`/admin/products/${r.data.id}?created=1`)
  }

  return (
    <form onSubmit={create} className="max-w-2xl space-y-5 rounded-2xl border border-line bg-paper p-6">
      <Labelled label="Name in English">
        <input className={input} value={name.en} onChange={(e) => setName({ ...name, en: e.target.value })} required autoFocus />
      </Labelled>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Labelled label="Name in Greek (optional)">
          <input className={input} value={name.el} onChange={(e) => setName({ ...name, el: e.target.value })} />
        </Labelled>
        <Labelled label="Name in Russian (optional)">
          <input className={input} value={name.ru} onChange={(e) => setName({ ...name, ru: e.target.value })} />
        </Labelled>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className="label text-muted">Category</span>
          <div className="mt-1.5">
            <CategorySelect groups={groups} value={categoryId} onChange={setCategoryId} />
          </div>
        </div>
        <Labelled label="Price (€)" hint="The price of the smallest size. Each size can have its own price later.">
          <input className={`${input} tabular-nums`} inputMode="decimal" placeholder="39.90" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </Labelled>
      </div>
      <fieldset className="rounded-2xl border border-line bg-paper-2/60 p-4">
        <legend className="label px-1 text-muted">First size and stock</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Labelled label="Pack size">
            <input className={input} placeholder="1kg or 90 caps" value={size} onChange={(e) => setSize(e.target.value)} required />
          </Labelled>
          <Labelled label="Flavour (optional)">
            <input className={input} placeholder="Chocolate" value={flavour} onChange={(e) => setFlavour(e.target.value)} />
          </Labelled>
          <Labelled label="On the shelf">
            <input className={`${input} tabular-nums`} inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} />
          </Labelled>
        </div>
        <p className="mt-3 text-xs text-muted">More sizes and flavours can be added on the product page under Flavours and stock.</p>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-sale">
          {error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <button className={btn.primary} disabled={busy}>
          {busy ? 'Creating…' : 'Create product'}
        </button>
        <p className="text-sm text-muted">It starts Hidden. Add photos, then set it to Available.</p>
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------- delete -- */

export function DeleteProduct({ productId, name }: { productId: string; name: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!window.confirm(`Delete “${name}” for good? Its photos, flavours and stock go with it.`)) return
    setBusy(true)
    setError(null)
    const r = await send(`/api/admin/products/${productId}`, 'DELETE', undefined)
    if (!r.ok) {
      setBusy(false)
      return setError(r.message)
    }
    router.push('/admin/products?deleted=1')
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" className={btn.danger} onClick={() => void remove()} disabled={busy}>
        {busy ? 'Deleting…' : 'Delete product'}
      </button>
      <p className="text-sm text-muted">Only possible for a product nobody has ordered. To take an ordered product off the shop, set it to Hidden.</p>
      {error && (
        <p role="alert" className="w-full text-sm text-sale">
          {error}
        </p>
      )}
    </div>
  )
}
