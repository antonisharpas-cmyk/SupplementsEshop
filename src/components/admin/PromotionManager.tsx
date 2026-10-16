'use client'

/* Promotions: every automatic discount, what it reaches, when it runs, and
   the controls to pause, end, change or start one. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminPromotion } from '@/lib/admin-promotions'
import { btn, input } from '@/components/admin/ui'
import { SearchSelect } from '@/components/admin/SearchSelect'
import { DateTimeField } from '@/components/admin/DateTimeField'

type Option = { id: string; label: string }

const STATE: Record<AdminPromotion['state'], { label: string; cls: string }> = {
  live: { label: 'Live now', cls: 'bg-ok/15 text-ok' },
  scheduled: { label: 'Scheduled', cls: 'bg-accent/15 text-accent' },
  ended: { label: 'Ended', cls: 'bg-line text-muted' },
  paused: { label: 'Paused', cls: 'bg-line text-muted' },
}

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

/** A Date as the value a datetime-local box wants, in the browser's time. */
function local(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const off = (p: Pick<AdminPromotion, 'discountType' | 'discountValue'>) =>
  p.discountType === 'PERCENTAGE' ? `${p.discountValue}% off` : `€${(p.discountValue / 100).toFixed(2)} off`

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null)
  const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
  return res?.ok && data?.ok ? null : (data?.message ?? 'Something went wrong. Check the fields and try again.')
}

/* ------------------------------------------------------------- form --- */

function PromotionForm({
  initial,
  products,
  categories,
  onDone,
}: {
  initial?: AdminPromotion
  products: Option[]
  categories: Option[]
  onDone: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(initial?.name ?? '')
  const [scope, setScope] = useState<'PRODUCT' | 'CATEGORY' | 'ALL'>(
    initial?.scope === 'SUBCATEGORY' ? 'CATEGORY' : (initial?.scope ?? 'CATEGORY'),
  )
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [productId, setProductId] = useState(initial?.productId ?? products[0]?.id ?? '')
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED'>(initial?.discountType ?? 'PERCENTAGE')
  const [amount, setAmount] = useState(
    initial ? (initial.discountType === 'PERCENTAGE' ? String(initial.discountValue) : (initial.discountValue / 100).toFixed(2)) : '',
  )
  const [startsAt, setStartsAt] = useState(local(initial?.startsAt ?? new Date().toISOString()))
  const [endsAt, setEndsAt] = useState(local(initial?.endsAt ?? null))
  const [badge, setBadge] = useState(initial?.badge ?? { en: '', el: '', ru: '' })
  const [homepage, setHomepage] = useState(initial?.showOnHomepage ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const n = Number(amount.replace(',', '.'))
  const value = type === 'PERCENTAGE' ? Math.round(n) : Math.round(n * 100)

  return (
    <form
      className="space-y-5 rounded-2xl border border-accent/40 bg-accent/5 p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!startsAt) return setError('Choose when it starts.')
        setBusy(true)
        setError(null)
        const promotion = {
          name,
          scope,
          productId: scope === 'PRODUCT' ? productId : null,
          categoryId: scope === 'CATEGORY' ? categoryId : null,
          discountType: type,
          discountValue: value,
          badge,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
          showOnHomepage: homepage,
          isActive: initial?.isActive ?? true,
        }
        const err = initial
          ? await call(`/api/admin/promotions/${initial.id}`, 'PATCH', { action: 'update', promotion })
          : await call('/api/admin/promotions', 'POST', promotion)
        setBusy(false)
        if (err) return setError(err)
        onDone()
        router.refresh()
      }}
    >
      <p className="font-display text-base font-semibold text-heading">{initial ? `Change ${initial.name}` : 'New promotion'}</p>

      <label className="block">
        <span className="mb-1.5 block text-xs text-muted">Name (only you see this)</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer protein deal" required />
      </label>

      <div>
        <span className="mb-1.5 block text-xs text-muted">Applies to</span>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['CATEGORY', 'A category'],
              ['PRODUCT', 'One product'],
              ['ALL', 'The whole shop'],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              aria-pressed={scope === v}
              onClick={() => setScope(v)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${scope === v ? 'bg-gold border-transparent text-paper' : 'border-line bg-paper hover:border-accent'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {scope === 'CATEGORY' && (
          <SearchSelect
            className="mt-3"
            value={categoryId}
            onChange={setCategoryId}
            ariaLabel="Category"
            searchPlaceholder="Search categories"
            options={categories.map((c) => ({ value: c.id, label: c.label }))}
          />
        )}
        {scope === 'PRODUCT' && (
          <SearchSelect
            className="mt-3"
            value={productId}
            onChange={setProductId}
            ariaLabel="Product"
            searchPlaceholder="Search products"
            options={products.map((p) => ({ value: p.id, label: p.label }))}
          />
        )}
        {scope === 'CATEGORY' && <p className="mt-1.5 text-xs text-muted">Everything inside the category is included too.</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-xs text-muted">Discount</span>
          <div className="flex gap-2">
            <select className={`${input} w-36`} value={type} onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FIXED')}>
              <option value="PERCENTAGE">Percent off</option>
              <option value="FIXED">Euros off</option>
            </select>
            <input
              className={input}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={type === 'PERCENTAGE' ? '15' : '5.00'}
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="mb-1.5 block text-xs text-muted">Starts</span>
            <DateTimeField value={startsAt} onChange={setStartsAt} ariaLabel="Starts" />
          </div>
          <div>
            <span className="mb-1.5 block text-xs text-muted">Ends (empty for no end)</span>
            <DateTimeField value={endsAt} onChange={setEndsAt} ariaLabel="Ends" placeholder="No end" />
          </div>
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-xs text-muted">Badge on product cards (optional)</span>
        <div className="grid gap-2 sm:grid-cols-3">
          <input className={input} placeholder="English, e.g. 15% OFF" value={badge.en} onChange={(e) => setBadge({ ...badge, en: e.target.value })} />
          <input className={input} placeholder="Greek" value={badge.el} onChange={(e) => setBadge({ ...badge, el: e.target.value })} />
          <input className={input} placeholder="Russian" value={badge.ru} onChange={(e) => setBadge({ ...badge, ru: e.target.value })} />
        </div>
      </div>

      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={homepage} onChange={(e) => setHomepage(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        Show it in the promotion strip on the homepage
      </label>

      {error && <p className="text-sm text-sale">{error}</p>}
      <div className="flex gap-2">
        <button className={btn.primary} disabled={busy || !name.trim() || !(value > 0)}>
          {busy ? 'Saving' : initial ? 'Save changes' : 'Start promotion'}
        </button>
        <button type="button" className={btn.quiet} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* -------------------------------------------------------------- row --- */

function Row({ p, products, categories }: { p: AdminPromotion; products: Option[]; categories: Option[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = async (method: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    const err = await call(`/api/admin/promotions/${p.id}`, method, body)
    setBusy(false)
    if (err) setError(err)
    else router.refresh()
  }
  const s = STATE[p.state]

  if (editing) return <PromotionForm initial={p} products={products} categories={categories} onDone={() => setEditing(false)} />

  return (
    <li className={`rounded-2xl border border-line bg-paper p-5 ${p.state === 'ended' || p.state === 'paused' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="font-display text-lg font-semibold text-heading">{p.name}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${s.cls}`}>{s.label}</span>
          </div>
          <p className="mt-1 text-sm">
            <span className="font-semibold text-accent">{off(p)}</span>
            <span className="text-muted"> on </span>
            <span className="text-ink">{p.target}</span>
            <span className="text-muted">
              {' '}
              · {p.products} product{p.products === 1 ? '' : 's'}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">
            From {when(p.startsAt)} {p.endsAt ? `until ${when(p.endsAt)}` : 'with no end date'}
            {p.badge.en && ` · badge "${p.badge.en}"`}
            {p.showOnHomepage && ' · on the homepage'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Change
          </button>
          {p.state !== 'ended' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('PATCH', { action: p.isActive ? 'pause' : 'resume' })}>
              {p.isActive ? 'Pause' : 'Resume'}
            </button>
          )}
          {(p.state === 'live' || p.state === 'scheduled') && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act('PATCH', { action: 'end' })}>
              End now
            </button>
          )}
          {!confirm ? (
            <button type="button" className="btn btn-ghost btn-sm text-sale" onClick={() => setConfirm(true)}>
              Delete
            </button>
          ) : (
            <>
              <button type="button" className={btn.danger} disabled={busy} onClick={() => act('DELETE')}>
                Yes, delete
              </button>
              <button type="button" className={btn.quiet} onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-sale">{error}</p>}
    </li>
  )
}

export function PromotionManager({ promotions, products, categories }: { promotions: AdminPromotion[]; products: Option[]; categories: Option[] }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="space-y-4">
      {adding ? (
        <PromotionForm products={products} categories={categories} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
          + New promotion
        </button>
      )}
      {promotions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-paper px-6 py-12 text-center text-sm text-muted">No promotions yet.</p>
      ) : (
        <ul className="space-y-3">
          {promotions.map((p) => (
            <Row key={p.id} p={p} products={products} categories={categories} />
          ))}
        </ul>
      )}
    </div>
  )
}
