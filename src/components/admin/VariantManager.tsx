'use client'

/* ============================================================================
 * A product's variants: every flavour in every pack size, each one a line
 * with its own SKU, stock and (optionally) its own price.
 *
 *  · Edit a line and press Save on that line. Stock saves on its own when you
 *    press Enter or leave the box, like the Stock screen.
 *  · Add a flavour: type it once, tick the sizes it comes in, and one line is
 *    made per size.
 *  · Remove a line that is not in anyone's bag; switch it off otherwise.
 *
 * The flavour colour is the dot on the product page and in the filters. Two
 * flavours of the same product need different colours.
 * ========================================================================== */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from './ui'

export type VariantRow = {
  id: string
  sku: string
  supplierCode: string | null
  size: string
  flavour: Record<string, string> | null
  colorHex: string | null
  priceCents: number | null
  salePriceCents: number | null
  isActive: boolean
  onHand: number
  reserved: number
}

const euros = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2))
function cents(v: string): number | null | 'bad' {
  const t = v.trim().replace(',', '.')
  if (!t) return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return 'bad'
  return Math.round(Number(t) * 100)
}

async function call(url: string, method: string, body?: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
    return res.ok && data.ok ? null : (data.message ?? 'Could not save that.')
  } catch {
    return 'Could not reach the server.'
  }
}

const cell = 'border border-line bg-paper px-2.5 py-2 text-sm outline-none focus:border-accent'

function Line({ productId, row, basePrice }: { productId: string; row: VariantRow; basePrice: number }) {
  const router = useRouter()
  const [f, setF] = useState({
    en: row.flavour?.en ?? '',
    el: row.flavour?.el ?? '',
    ru: row.flavour?.ru ?? '',
    hex: row.colorHex ?? '#2e2e2e',
    size: row.size,
    supplierCode: row.supplierCode ?? '',
    price: euros(row.priceCents),
    sale: euros(row.salePriceCents),
    active: row.isActive,
  })
  const [stock, setStock] = useState(String(row.onHand))
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const dirty =
    f.en !== (row.flavour?.en ?? '') ||
    f.el !== (row.flavour?.el ?? '') ||
    f.ru !== (row.flavour?.ru ?? '') ||
    f.hex !== (row.colorHex ?? '#2e2e2e') ||
    f.size !== row.size ||
    f.supplierCode !== (row.supplierCode ?? '') ||
    f.price !== euros(row.priceCents) ||
    f.sale !== euros(row.salePriceCents) ||
    f.active !== row.isActive

  async function save() {
    const price = cents(f.price)
    const sale = cents(f.sale)
    if (price === 'bad' || sale === 'bad') return setNote({ tone: 'bad', text: 'Prices are in euros, e.g. 39.90.' })
    setBusy(true)
    const error = await call(`/api/admin/products/${productId}/variants/${row.id}`, 'PATCH', {
      size: f.size,
      flavour: { en: f.en, el: f.el, ru: f.ru },
      colorHex: f.hex,
      supplierCode: f.supplierCode,
      priceCents: price,
      salePriceCents: sale,
      isActive: f.active,
    })
    setBusy(false)
    if (error) return setNote({ tone: 'bad', text: error })
    setNote({ tone: 'ok', text: 'Saved' })
    router.refresh()
  }

  async function saveStock() {
    const n = Number(stock)
    if (String(row.onHand) === stock) return
    if (!Number.isInteger(n) || n < 0) return setNote({ tone: 'bad', text: 'Stock is a whole number.' })
    const error = await call('/api/admin/stock', 'POST', { variantId: row.id, onHand: n })
    if (error) {
      setStock(String(row.onHand))
      return setNote({ tone: 'bad', text: error })
    }
    setNote({ tone: 'ok', text: 'Stock saved' })
    router.refresh()
  }

  async function remove() {
    if (!window.confirm(`Remove ${f.en} ${f.size}? Its stock goes with it.`)) return
    setBusy(true)
    const error = await call(`/api/admin/products/${productId}/variants/${row.id}`, 'DELETE')
    setBusy(false)
    if (error) return setNote({ tone: 'bad', text: error })
    router.refresh()
  }

  const available = Math.max(0, row.onHand - row.reserved)

  return (
    <>
      <tr className={f.active ? '' : 'opacity-60'}>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={f.hex}
              onChange={(e) => setF({ ...f, hex: e.target.value })}
              aria-label="Flavour colour"
              className="h-8 w-8 shrink-0 cursor-pointer border border-line bg-paper p-0.5"
            />
            <input className={`${cell} w-40`} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} aria-label="Flavour (English)" />
          </div>
        </td>
        <td className="px-3 py-2">
          <input className={`${cell} w-24`} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} aria-label="Size" />
        </td>
        <td className="px-3 py-2">
          <input
            className={`${cell} w-24 text-right tabular-nums`}
            value={f.price}
            placeholder={euros(basePrice)}
            onChange={(e) => setF({ ...f, price: e.target.value })}
            aria-label="Price for this size"
            inputMode="decimal"
          />
        </td>
        <td className="px-3 py-2">
          <input
            className={`${cell} w-24 text-right tabular-nums`}
            value={f.sale}
            placeholder="none"
            onChange={(e) => setF({ ...f, sale: e.target.value })}
            aria-label="Sale price for this size"
            inputMode="decimal"
          />
        </td>
        <td className="px-3 py-2">
          <input
            className={`${cell} w-20 text-right tabular-nums`}
            value={stock}
            onChange={(e) => setStock(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => void saveStock()}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void saveStock())}
            aria-label="On the shelf"
            inputMode="numeric"
          />
          <span className="mt-1 block text-[11px] text-muted">
            {available} available{row.reserved ? `, ${row.reserved} in bags` : ''}
          </span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <div className="flex items-center gap-2">
            <button type="button" className={btn.secondary} onClick={() => void save()} disabled={!dirty || busy}>
              Save
            </button>
            <button type="button" className={btn.quiet} onClick={() => setOpen(!open)} aria-expanded={open}>
              More
            </button>
          </div>
          {note && <span className={`mt-1 block text-xs ${note.tone === 'bad' ? 'text-sale' : 'text-ok'}`}>{note.text}</span>}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-paper-2 px-3 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <label className="text-xs text-muted">
                Flavour in Greek
                <input className={`${input} mt-1`} value={f.el} onChange={(e) => setF({ ...f, el: e.target.value })} />
              </label>
              <label className="text-xs text-muted">
                Flavour in Russian
                <input className={`${input} mt-1`} value={f.ru} onChange={(e) => setF({ ...f, ru: e.target.value })} />
              </label>
              <div className="text-xs text-muted">
                SKU (made by the system)
                <p className="mt-1 rounded-xl border border-line bg-paper-2 px-3.5 py-2.5 font-mono text-sm text-ink" title="AX + product + flavour + size. It never changes, so orders, invoices and stock always match.">
                  {row.sku}
                </p>
              </div>
              <label className="text-xs text-muted">
                Supplier code
                <input className={`${input} mt-1 font-mono`} value={f.supplierCode} onChange={(e) => setF({ ...f, supplierCode: e.target.value })} placeholder="Olimp’s code on their invoice" />
              </label>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm">
                <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="h-4 w-4 accent-[var(--color-accent)]" />
                On sale in the shop
              </label>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <button type="button" className={btn.secondary} onClick={() => void save()} disabled={!dirty || busy}>
                Save
              </button>
              <button type="button" className="label text-sale hover:underline" onClick={() => void remove()} disabled={busy}>
                Remove this variant
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function AddFlavour({ productId, sizes }: { productId: string; sizes: string[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ en: '', el: '', ru: '', hex: '#6b4129' })
  const [chosen, setChosen] = useState<string[]>(sizes.length ? sizes : [])
  const [newSize, setNewSize] = useState('')
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [stock, setStock] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const allSizes = [...new Set([...sizes, ...chosen])]

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!f.en.trim()) return setError('Name the flavour in English, e.g. Chocolate. Use Unflavoured or Standard for plain products.')
    if (!chosen.length) return setError('Tick at least one size.')
    setBusy(true)
    setError(null)
    for (const size of chosen) {
      const price = cents(prices[size] ?? '')
      if (price === 'bad') {
        setBusy(false)
        return setError(`The price for ${size} is not a valid amount.`)
      }
      const err = await call(`/api/admin/products/${productId}/variants`, 'POST', {
        size,
        flavour: { en: f.en, el: f.el, ru: f.ru },
        colorHex: f.hex,
        priceCents: price,
        onHand: Number(stock[size] || 0),
      })
      if (err) {
        setBusy(false)
        router.refresh()
        return setError(`${size}: ${err}`)
      }
    }
    setBusy(false)
    setOpen(false)
    setF({ en: '', el: '', ru: '', hex: '#6b4129' })
    router.refresh()
  }

  if (!open) {
    return (
      <button type="button" className={btn.primary} onClick={() => setOpen(true)}>
        Add a flavour
      </button>
    )
  }

  return (
    <form onSubmit={add} className="space-y-4 border border-line bg-paper-2 p-5">
      <p className="text-sm font-medium text-heading">New flavour</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr_1fr_1fr]">
        <label className="text-xs text-muted">
          Colour
          <input
            type="color"
            value={f.hex}
            onChange={(e) => setF({ ...f, hex: e.target.value })}
            className="mt-1 block h-10 w-12 cursor-pointer border border-line bg-paper p-0.5"
          />
        </label>
        <label className="text-xs text-muted">
          Flavour (English)
          <input className={`${input} mt-1`} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} placeholder="Chocolate" />
        </label>
        <label className="text-xs text-muted">
          Greek (optional)
          <input className={`${input} mt-1`} value={f.el} onChange={(e) => setF({ ...f, el: e.target.value })} placeholder="Σοκολάτα" />
        </label>
        <label className="text-xs text-muted">
          Russian (optional)
          <input className={`${input} mt-1`} value={f.ru} onChange={(e) => setF({ ...f, ru: e.target.value })} placeholder="Шоколад" />
        </label>
      </div>

      <fieldset>
        <legend className="text-xs text-muted">Sizes it comes in, each with its price and opening stock</legend>
        <div className="mt-2 space-y-2">
          {allSizes.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-3">
              <label className="flex w-28 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(size)}
                  onChange={(e) => setChosen(e.target.checked ? [...chosen, size] : chosen.filter((s) => s !== size))}
                  className="h-4 w-4 accent-[var(--color-accent)]"
                />
                {size}
              </label>
              <input
                className={`${cell} w-28 text-right`}
                placeholder="price €"
                inputMode="decimal"
                value={prices[size] ?? ''}
                onChange={(e) => setPrices({ ...prices, [size]: e.target.value })}
                aria-label={`Price for ${size}`}
              />
              <input
                className={`${cell} w-24 text-right`}
                placeholder="stock"
                inputMode="numeric"
                value={stock[size] ?? ''}
                onChange={(e) => setStock({ ...stock, [size]: e.target.value.replace(/[^0-9]/g, '') })}
                aria-label={`Stock for ${size}`}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              className={`${cell} w-40`}
              placeholder="another size, e.g. 2kg"
              value={newSize}
              onChange={(e) => setNewSize(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (newSize.trim()) setChosen([...new Set([...chosen, newSize.trim()])])
                  setNewSize('')
                }
              }}
            />
            <button
              type="button"
              className={btn.quiet}
              onClick={() => {
                if (newSize.trim()) setChosen([...new Set([...chosen, newSize.trim()])])
                setNewSize('')
              }}
            >
              Add size
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">Leave a price empty to use the product price.</p>
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-sale">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button className={btn.primary} disabled={busy}>
          {busy ? 'Adding…' : 'Add flavour'}
        </button>
        <button type="button" className={btn.secondary} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function VariantManager({ productId, rows, basePrice }: { productId: string; rows: VariantRow[]; basePrice: number }) {
  const sizes = [...new Set(rows.map((r) => r.size))]
  return (
    <div className="space-y-5">
      {rows.length ? (
        <div className="overflow-x-auto border border-line">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label px-3 py-3 text-muted">Flavour</th>
                <th className="label px-3 py-3 text-muted">Size</th>
                <th className="label px-3 py-3 text-muted">Price €</th>
                <th className="label px-3 py-3 text-muted">Sale €</th>
                <th className="label px-3 py-3 text-muted">On shelf</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((r) => (
                <Line key={`${r.id}:${r.sku}:${r.size}:${r.onHand}:${r.priceCents}:${r.salePriceCents}:${r.isActive}`} productId={productId} row={r} basePrice={basePrice} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">No flavours or sizes yet. Add the first one below; a product needs at least one before it can be bought.</p>
      )}
      <AddFlavour productId={productId} sizes={sizes} />
    </div>
  )
}
