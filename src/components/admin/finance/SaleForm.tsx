'use client'

/* A sale to a retailer. Choosing the retailer loads their prices; each line
   shows the margin over what the stock cost. Saving takes the stock and
   issues the invoice. */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useMemo, useState } from 'react'
import { SearchSelect } from '@/components/admin/SearchSelect'
import { btn, input } from '@/components/admin/ui'
import { euros, fmt, PAY_METHODS, toCents, todayIso, useApi } from './shared'

export type Price = { variantId: string; label: string; sku: string; unitNetCents: number; source: string; avgCostCents: number }
type Line = { key: number; variantId: string; qty: string; price: string }
let seq = 1

export function SaleForm({
  retailers,
  stock,
  vatRateBp,
  preselect,
  preselectPrices = [],
}: {
  retailers: { id: string; name: string; paymentTermsDays: number; vatTreatment: string; defaultDiscountPercent: number }[]
  stock: Record<string, number>
  vatRateBp: number
  preselect?: string
  /** The preselected retailer's prices, loaded on the server. */
  preselectPrices?: Price[]
}) {
  const { busy, msg, setMsg, call, router } = useApi()
  const [retailerId, setRetailerId] = useState(preselect ?? '')
  const [prices, setPrices] = useState<Price[]>(preselectPrices)
  const [lines, setLines] = useState<Line[]>([{ key: seq++, variantId: '', qty: '', price: '' }])
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [paidNow, setPaidNow] = useState(retailers.find((x) => x.id === preselect)?.paymentTermsDays === 0)
  const [method, setMethod] = useState('bank')
  const r = retailers.find((x) => x.id === retailerId)
  const pMap = useMemo(() => new Map(prices.map((p) => [p.variantId, p])), [prices])
  const options = useMemo(() => prices.map((p) => ({ value: p.variantId, label: p.label, hint: `${p.sku} · ${stock[p.variantId] ?? 0} in stock · ${fmt(p.unitNetCents)}` })), [prices, stock])

  async function loadPrices(id: string) {
    const res = await fetch(`/api/admin/finance/retailers/${id}`)
    const data = (await res.json().catch(() => ({}))) as { prices?: Price[] }
    const list = data.prices ?? []
    setPrices(list)
    const map = new Map(list.map((p) => [p.variantId, p]))
    setLines((ls) => ls.map((l) => (l.variantId && map.get(l.variantId) ? { ...l, price: euros(map.get(l.variantId)!.unitNetCents) } : l)))
  }
  function pick(id: string) {
    setRetailerId(id)
    setMsg(null)
    setPaidNow(retailers.find((x) => x.id === id)?.paymentTermsDays === 0)
    void loadPrices(id)
  }

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const parsed = lines.map((l) => {
    const q = Math.max(0, Math.round(Number(l.qty) || 0))
    const p = toCents(l.price) ?? 0
    const cost = pMap.get(l.variantId)?.avgCostCents ?? 0
    return { ...l, q, p, net: q * p, cost: q * cost, margin: p > 0 ? (p - cost) / p : null, have: stock[l.variantId] ?? 0 }
  })
  const net = parsed.reduce((n, l) => n + l.net, 0)
  const cost = parsed.reduce((n, l) => n + l.cost, 0)
  const rate = r?.vatTreatment === 'EU_ZERO' ? 0 : vatRateBp
  const vat = Math.round((net * rate) / 10_000)
  const short = parsed.filter((l) => l.variantId && l.q > l.have)

  async function save() {
    const data = await call<{ id: string }>(
      '/api/admin/finance/wholesale',
      'POST',
      {
        retailerId,
        saleDate: date,
        note: note || null,
        paidNow: paidNow ? { method } : null,
        lines: parsed.filter((l) => l.variantId && l.q > 0).map((l) => ({ variantId: l.variantId, quantity: l.q, unitNetCents: l.p })),
      },
      { refresh: false },
    )
    if (data?.id) router.push(`/admin/wholesale/${data.id}`)
  }

  const cell = `${input} !px-2.5 !py-2 text-right tabular-nums`
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-3">
        <label className="block text-xs text-muted">
          Retailer
          <SearchSelect className="mt-1" options={retailers.map((x) => ({ value: x.id, label: x.name, hint: x.paymentTermsDays ? `${x.paymentTermsDays} days` : 'upfront' }))} value={retailerId} onChange={pick} placeholder="Choose the retailer" />
        </label>
        <label className="block text-xs text-muted">
          Date
          <DateTimeField mode="date" clearable={false} value={date} onChange={(v) => setDate(v)} className="mt-1" />
        </label>
        <p className="self-end pb-2 text-xs text-muted">
          {r ? (
            <>
              {r.paymentTermsDays ? `Pays within ${r.paymentTermsDays} days.` : 'Pays upfront.'} Default {r.defaultDiscountPercent}% off the website price before VAT. {r.vatTreatment === 'EU_ZERO' ? 'VAT 0% (EU business).' : `VAT ${vatRateBp / 100}% added.`}
            </>
          ) : (
            'Prices load when you choose the retailer.'
          )}
        </p>
      </section>

      {retailerId && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[50rem] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="pb-2 pr-2 font-medium">Product</th>
                  <th className="w-24 pb-2 pr-2 text-right font-medium">Qty</th>
                  <th className="w-32 pb-2 pr-2 text-right font-medium">Price before VAT €</th>
                  <th className="w-28 pb-2 pr-2 text-right font-medium">Line</th>
                  <th className="w-24 pb-2 pr-2 text-right font-medium">Margin</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {parsed.map((l) => (
                  <tr key={l.key} className="border-t border-line align-top">
                    <td className="py-2 pr-2">
                      <SearchSelect
                        options={options}
                        value={l.variantId}
                        onChange={(id) => setLine(l.key, { variantId: id, price: euros(pMap.get(id)?.unitNetCents ?? 0) })}
                        placeholder="Choose a product"
                        searchPlaceholder="Name or SKU"
                      />
                      {l.variantId && l.q > l.have && <p className="mt-1 text-[11px] text-sale">Only {l.have} in stock</p>}
                    </td>
                    <td className="py-2 pr-2">
                      <input className={cell} inputMode="numeric" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/\D/g, '') })} />
                    </td>
                    <td className="py-2 pr-2">
                      <input className={cell} inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    </td>
                    <td className="py-4 pr-2 text-right tabular-nums">{fmt(l.net)}</td>
                    <td className={`py-4 pr-2 text-right tabular-nums ${l.margin !== null && l.margin < 0.1 ? 'text-sale' : ''}`}>{l.margin === null || !l.variantId ? '—' : `${Math.round(l.margin * 100)}%`}</td>
                    <td className="py-3 text-right">
                      <button type="button" aria-label="Remove line" className="text-muted hover:text-sale" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={`${btn.quiet} mt-3`} onClick={() => setLines((ls) => [...ls, { key: seq++, variantId: '', qty: '', price: '' }])}>
            + Add a line
          </button>
        </section>
      )}

      {retailerId && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="space-y-4 rounded-2xl border border-line bg-paper p-5">
            <label className="block text-xs text-muted">
              Note on the invoice
              <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. their order number" />
            </label>
            <label className="flex flex-wrap items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} />
              Paid now, by
              <select className={`${input} !w-auto !py-1.5`} value={method} onChange={(e) => setMethod(e.target.value)} disabled={!paidNow}>
                {PAY_METHODS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {short.length > 0 && <p className="text-xs text-sale">Some lines ask for more than is in stock. Lower them, or receive a purchase first.</p>}
          </div>
          <div className="space-y-2 rounded-2xl border border-line bg-paper p-5 text-sm">
            <div className="flex justify-between">
              <span>Net</span>
              <span className="tabular-nums">{fmt(net)}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT {rate / 100}%</span>
              <span className="tabular-nums">{fmt(vat)}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
              <span>Invoice total</span>
              <span className="tabular-nums">{fmt(net + vat)}</span>
            </div>
            <div className="flex justify-between pt-1 text-xs text-muted">
              <span>Profit on this sale</span>
              <span className="tabular-nums">
                {fmt(net - cost)} {net > 0 && `(${Math.round(((net - cost) / net) * 100)}%)`}
              </span>
            </div>
            <button type="button" className={`${btn.primary} mt-4 w-full`} disabled={busy || net <= 0 || short.length > 0} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Make the sale and issue the invoice'}
            </button>
            {msg && <p className={`pt-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}
          </div>
        </section>
      )}
    </div>
  )
}
