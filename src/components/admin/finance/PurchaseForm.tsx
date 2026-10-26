'use client'

/* A supplier invoice, typed in fast:
   · "Repeat last order" fills in the supplier's last products and prices
   · "Paste from Excel" and "Upload a file" read the supplier's own list
   · the true cost of each unit (with its share of shipping) shows as you type */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useMemo, useRef, useState } from 'react'
import { SearchSelect } from '@/components/admin/SearchSelect'
import { btn, input } from '@/components/admin/ui'
import { euros, fmt, toCents, todayIso, useApi } from './shared'

export type PickVariant = { variantId: string; label: string; sku: string; supplierCode?: string | null; avgCostCents: number; onHand: number }
export type PickSupplier = { id: string; name: string; vatTreatment: string; country: string }
type Line = { key: number; variantId: string; qty: string; free: string; price: string }

export type PurchaseInitial = {
  id: string
  supplierId: string
  supplierInvoiceNo: string | null
  invoiceDate: string
  vatTreatment: string
  shippingCents: number
  otherFeesCents: number
  vatCents: number
  note: string | null
  lines: { variantId: string | null; quantity: number; freeQuantity: number; unitNetCents: number }[]
}

const TREATMENTS = [
  ['DOMESTIC', 'Cyprus VAT (on the invoice, reclaimed)'],
  ['EU_REVERSE', 'EU supplier, reverse charge (no VAT on the invoice)'],
  ['IMPORT', 'Import from outside the EU (import VAT paid on arrival)'],
  ['NONE', 'No VAT'],
] as const

let seq = 1

export function PurchaseForm({
  suppliers,
  variants,
  vatRateBp,
  initial,
}: {
  suppliers: PickSupplier[]
  variants: PickVariant[]
  vatRateBp: number
  initial?: PurchaseInitial
}) {
  const { busy, msg, setMsg, call, router } = useApi()
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? suppliers[0]?.id ?? '')
  const [invoiceNo, setInvoiceNo] = useState(initial?.supplierInvoiceNo ?? '')
  const [date, setDate] = useState(initial?.invoiceDate ?? todayIso())
  const [treatment, setTreatment] = useState(initial?.vatTreatment ?? suppliers[0]?.vatTreatment ?? 'DOMESTIC')
  const [lines, setLines] = useState<Line[]>(
    initial?.lines.length
      ? initial.lines.map((l) => ({ key: seq++, variantId: l.variantId ?? '', qty: String(l.quantity), free: l.freeQuantity ? String(l.freeQuantity) : '', price: euros(l.unitNetCents) }))
      : [{ key: seq++, variantId: '', qty: '', free: '', price: '' }],
  )
  const [shipping, setShipping] = useState(initial ? euros(initial.shippingCents) : '')
  const [fees, setFees] = useState(initial ? euros(initial.otherFeesCents) : '')
  const [vatTyped, setVatTyped] = useState(initial && (initial.vatTreatment === 'DOMESTIC' || initial.vatTreatment === 'IMPORT') ? euros(initial.vatCents) : '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [paste, setPaste] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const byId = useMemo(() => new Map(variants.map((v) => [v.variantId, v])), [variants])
  const options = useMemo(() => variants.map((v) => ({ value: v.variantId, label: v.label, hint: `${v.sku}${v.supplierCode ? ` · ${v.supplierCode}` : ''} · ${v.onHand} in stock` })), [variants])

  const parsed = lines.map((l) => {
    const q = Math.max(0, Math.round(Number(l.qty) || 0))
    const f = Math.max(0, Math.round(Number(l.free) || 0))
    const p = toCents(l.price) ?? 0
    return { ...l, q, f, p, net: q * p }
  })
  const goods = parsed.reduce((n, l) => n + l.net, 0)
  const ship = toCents(shipping) ?? 0
  const fee = toCents(fees) ?? 0
  const base = goods + ship + fee
  const vatAuto = Math.round((base * vatRateBp) / 10_000)
  const vat = treatment === 'DOMESTIC' ? (toCents(vatTyped) ?? vatAuto) : treatment === 'IMPORT' ? (toCents(vatTyped) ?? 0) : 0
  const reverse = treatment === 'EU_REVERSE' ? vatAuto : 0
  const total = base + vat
  const landed = (l: (typeof parsed)[number]) => {
    const u = l.q + l.f
    if (u <= 0) return 0
    const share = goods > 0 ? ((ship + fee) * l.net) / goods : 0
    return (l.net + share) / u
  }

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLines = (more: Omit<Line, 'key'>[]) =>
    setLines((ls) => [...ls.filter((l) => l.variantId || l.qty || l.price), ...more.map((m) => ({ ...m, key: seq++ }))])

  function pickSupplier(id: string) {
    setSupplierId(id)
    const s = suppliers.find((x) => x.id === id)
    if (s) setTreatment(s.vatTreatment)
  }

  async function repeatLast() {
    if (!supplierId) return
    setMsg(null)
    const res = await fetch(`/api/admin/finance/purchases/import?supplierId=${supplierId}`)
    const data = (await res.json()) as { found?: boolean; number?: string; lines?: { variantId: string | null; quantity: number; freeQuantity: number; unitNetCents: number }[]; shippingCents?: number }
    if (!data.found || !data.lines) {
      setMsg({ ok: false, text: 'No earlier purchase from this supplier yet.' })
      return
    }
    addLines(data.lines.filter((l) => l.variantId).map((l) => ({ variantId: l.variantId!, qty: String(l.quantity), free: l.freeQuantity ? String(l.freeQuantity) : '', price: euros(l.unitNetCents) })))
    if (!shipping && data.shippingCents) setShipping(euros(data.shippingCents))
    setMsg({ ok: true, text: `Filled in from ${data.number}. Change what is different this time.` })
  }

  async function imported(res: Response) {
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; lines?: { variantId: string | null; quantity: number; freeQuantity: number; unitNetCents: number; problem?: string; row: number; sku: string }[] }
    if (!res.ok || !data.lines) {
      setMsg({ ok: false, text: data.message ?? 'That could not be read.' })
      return
    }
    const good = data.lines.filter((l) => !l.problem)
    addLines(good.map((l) => ({ variantId: l.variantId!, qty: String(l.quantity), free: l.freeQuantity ? String(l.freeQuantity) : '', price: euros(l.unitNetCents) })))
    setProblems(data.lines.filter((l) => l.problem).map((l) => `Row ${l.row}${l.sku ? ` (${l.sku})` : ''}: ${l.problem}`))
    setMsg({ ok: good.length > 0, text: `${good.length} line${good.length === 1 ? '' : 's'} added.` })
  }

  async function doPaste() {
    const res = await fetch('/api/admin/finance/purchases/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: paste }) })
    await imported(res)
    setPasteOpen(false)
    setPaste('')
  }
  async function doFile(f: File) {
    const form = new FormData()
    form.append('file', f)
    await imported(await fetch('/api/admin/finance/purchases/import', { method: 'POST', body: form }))
    if (fileRef.current) fileRef.current.value = ''
  }

  async function save(receive: boolean) {
    const body = {
      supplierId,
      supplierInvoiceNo: invoiceNo || null,
      invoiceDate: date,
      vatTreatment: treatment,
      shippingCents: ship,
      otherFeesCents: fee,
      vatCents: treatment === 'DOMESTIC' || treatment === 'IMPORT' ? toCents(vatTyped) : null,
      note: note || null,
      receive,
      lines: parsed.filter((l) => l.variantId && (l.q > 0 || l.f > 0)).map((l) => ({ variantId: l.variantId, quantity: l.q, freeQuantity: l.f, unitNetCents: l.p })),
    }
    const data = await call<{ id: string }>(initial ? `/api/admin/finance/purchases/${initial.id}` : '/api/admin/finance/purchases', initial ? 'PUT' : 'POST', body, { refresh: false })
    if (data?.id) router.push(`/admin/purchases/${data.id}`)
  }

  const cell = `${input} !px-2.5 !py-2 text-right tabular-nums`

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs text-muted">
          Supplier
          <SearchSelect className="mt-1" options={suppliers.map((s) => ({ value: s.id, label: s.name, hint: s.country }))} value={supplierId} onChange={pickSupplier} placeholder="Choose the supplier" />
        </label>
        <label className="block text-xs text-muted">
          Supplier’s invoice number
          <input className={`${input} mt-1`} value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. FV/2026/10/123" />
        </label>
        <label className="block text-xs text-muted">
          Invoice date
          <DateTimeField mode="date" clearable={false} value={date} onChange={(v) => setDate(v)} className="mt-1" />
        </label>
        <label className="block text-xs text-muted">
          VAT
          <select className={`${input} mt-1`} value={treatment} onChange={(e) => setTreatment(e.target.value)}>
            {TREATMENTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="label text-muted">Products</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} onClick={() => void repeatLast()} disabled={!supplierId}>
              Repeat last order
            </button>
            <button type="button" className={btn.secondary} onClick={() => setPasteOpen((v) => !v)}>
              Paste from Excel
            </button>
            <button type="button" className={btn.secondary} onClick={() => fileRef.current?.click()}>
              Upload a file
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void doFile(e.target.files[0])} />
          </div>
        </div>
        {pasteOpen && (
          <div className="mb-4 rounded-xl border border-line bg-paper-2 p-4">
            <p className="text-xs text-muted">
              Copy the rows from the supplier’s Excel and paste them here. Columns: <b>code</b> (the supplier’s code saved on the product, or our SKU), <b>quantity</b>, <b>unit price</b> (before VAT), and optionally <b>free</b> units. A header row is fine.
            </p>
            <textarea className={`${input} mt-2 h-36 font-mono text-xs`} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'SKU\tQty\tPrice\nOLIMP-WHEY-2KG\t100\t15,50'} />
            <div className="mt-2 flex gap-2">
              <button type="button" className={btn.primary} onClick={() => void doPaste()} disabled={!paste.trim()}>
                Add these lines
              </button>
              <button type="button" className={btn.quiet} onClick={() => setPasteOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {problems.length > 0 && (
          <ul className="mb-4 rounded-xl border border-sale/40 bg-sale/5 px-4 py-3 text-xs text-sale">
            {problems.slice(0, 12).map((p) => (
              <li key={p}>{p}</li>
            ))}
            {problems.length > 12 && <li>and {problems.length - 12} more</li>}
          </ul>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="pb-2 pr-2 font-medium">Product</th>
                <th className="w-24 pb-2 pr-2 text-right font-medium">Qty</th>
                <th className="w-20 pb-2 pr-2 text-right font-medium">Free</th>
                <th className="w-32 pb-2 pr-2 text-right font-medium">Unit price €</th>
                <th className="w-28 pb-2 pr-2 text-right font-medium">Line</th>
                <th className="w-32 pb-2 pr-2 text-right font-medium" title="Price plus its share of shipping and fees, per unit">
                  True cost / unit
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {parsed.map((l) => {
                const v = byId.get(l.variantId)
                const lc = landed(l)
                const change = v && v.avgCostCents > 0 && lc > 0 ? (lc - v.avgCostCents) / v.avgCostCents : null
                return (
                  <tr key={l.key} className="border-t border-line align-top">
                    <td className="py-2 pr-2">
                      <SearchSelect options={options} value={l.variantId} onChange={(id) => setLine(l.key, { variantId: id })} placeholder="Choose a product" searchPlaceholder="Name or SKU" />
                    </td>
                    <td className="py-2 pr-2">
                      <input className={cell} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, '') })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input className={cell} inputMode="numeric" value={l.free} onChange={(e) => setLine(l.key, { free: e.target.value.replace(/\D/g, '') })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input className={cell} inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} placeholder="0,00" />
                    </td>
                    <td className="py-4 pr-2 text-right tabular-nums">{fmt(l.net)}</td>
                    <td className="py-4 pr-2 text-right tabular-nums">
                      {lc > 0 ? fmt(Math.round(lc)) : '—'}
                      {change !== null && Math.abs(change) >= 0.005 && (
                        <span className={`block text-[11px] ${change > 0 ? 'text-sale' : 'text-ok'}`}>
                          {change > 0 ? '+' : ''}
                          {Math.round(change * 1000) / 10}% vs now
                        </span>
                      )}
                    </td>
                    <td className="py-3 text-right">
                      <button type="button" aria-label="Remove line" className="text-muted hover:text-sale" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button type="button" className={`${btn.quiet} mt-3`} onClick={() => addLines([{ variantId: '', qty: '', free: '', price: '' }])}>
          + Add a line
        </button>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid grid-cols-1 content-start gap-4 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Shipping €
            <input className={`${input} mt-1`} inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0,00" />
          </label>
          <label className="block text-xs text-muted">
            Other fees € <span className="text-muted">(customs duty, handling, bank charges)</span>
            <input className={`${input} mt-1`} inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0,00" />
          </label>
          {(treatment === 'DOMESTIC' || treatment === 'IMPORT') && (
            <label className="block text-xs text-muted">
              {treatment === 'IMPORT' ? 'Import VAT paid €' : 'VAT on the invoice €'}
              <input className={`${input} mt-1`} inputMode="decimal" value={vatTyped} onChange={(e) => setVatTyped(e.target.value)} placeholder={treatment === 'DOMESTIC' ? euros(vatAuto) : '0,00'} />
              {treatment === 'DOMESTIC' && <span className="mt-1 block">Leave empty to work it out at {vatRateBp / 100}%.</span>}
            </label>
          )}
          <label className="block text-xs text-muted sm:col-span-2">
            Note
            <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          <p className="text-xs text-muted sm:col-span-2">Shipping and fees are shared over the products by value, so every unit carries its true cost. Reclaimable VAT is never part of the cost.</p>
        </div>
        <div className="space-y-2 rounded-2xl border border-line bg-paper p-5 text-sm">
          <Row label="Products" value={fmt(goods)} />
          <Row label="Shipping and fees" value={fmt(ship + fee)} />
          {treatment === 'EU_REVERSE' ? (
            <Row label={`Reverse charge VAT ${vatRateBp / 100}% (not paid)`} value={fmt(reverse)} muted />
          ) : (
            <Row label="VAT" value={fmt(vat)} />
          )}
          <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
            <span>To pay the supplier</span>
            <span className="tabular-nums">{fmt(total)}</span>
          </div>
          <div className="flex flex-col gap-2 pt-4">
            <button type="button" className={btn.primary} disabled={busy || !supplierId} onClick={() => void save(true)}>
              {busy ? 'Saving…' : 'Save and receive the goods'}
            </button>
            <button type="button" className={btn.secondary} disabled={busy || !supplierId} onClick={() => void save(false)}>
              Save as draft (not arrived yet)
            </button>
          </div>
          {msg && <p className={`pt-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}
        </div>
      </section>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
