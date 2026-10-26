'use client'

/* Wholesale prices before VAT, for every retailer (general) or one of them.
   Empty means "use the next rule": the general price, then the discount. */

import { useMemo, useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { euros, fmt, toCents, useApi } from './shared'
import { ADMIN_PAGE_SIZE, PageButtons } from '@/components/admin/Paged'

type Row = { variantId: string; label: string; sku: string; retailGrossCents: number; netRetailCents: number; avgCostCents: number; fixedCents: number | null; fallbackCents: number; fallbackLabel: string }

export function PriceEditor({ retailerId, rows }: { retailerId: string | null; rows: Row[] }) {
  const { busy, msg, call } = useApi()
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.variantId, r.fixedCents === null ? '' : euros(r.fixedCents)])))
  const [q, setQ] = useState('')
  const shown = useMemo(() => rows.filter((r) => `${r.label} ${r.sku}`.toLowerCase().includes(q.toLowerCase())), [rows, q])
  const [rawPage, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(shown.length / ADMIN_PAGE_SIZE))
  const page = Math.min(rawPage, pages)
  const pageRows = shown.slice((page - 1) * ADMIN_PAGE_SIZE, page * ADMIN_PAGE_SIZE)
  const changed = rows.filter((r) => (vals[r.variantId] ?? '') !== (r.fixedCents === null ? '' : euros(r.fixedCents)))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className={`${input} max-w-xs`} value={q} onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }} placeholder="Find a product" />
        <button
          type="button"
          className={btn.primary}
          disabled={busy || changed.length === 0}
          onClick={() =>
            void call('/api/admin/finance/wholesale-prices', 'PUT', { retailerId, prices: changed.map((r) => ({ variantId: r.variantId, unitNetCents: vals[r.variantId] ? toCents(vals[r.variantId]) : null })) }, { okText: 'Prices saved.' })
          }
        >
          Save {changed.length || ''} price{changed.length === 1 ? '' : 's'}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 text-right font-medium">Website (with VAT)</th>
              <th className="px-4 py-3 text-right font-medium">Website before VAT</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 text-right font-medium">Without a fixed price</th>
              <th className="w-36 px-4 py-3 text-right font-medium">Fixed price €</th>
              <th className="px-4 py-3 text-right font-medium">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">
            {pageRows.map((r) => {
              const typed = vals[r.variantId] ? toCents(vals[r.variantId]) : null
              const price = typed ?? r.fallbackCents
              const margin = price > 0 && r.avgCostCents > 0 ? (price - r.avgCostCents) / price : null
              return (
                <tr key={r.variantId}>
                  <td className="px-4 py-2.5">
                    {r.label} <span className="font-mono text-[11px] text-muted">{r.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(r.retailGrossCents)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{fmt(r.netRetailCents)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{r.avgCostCents ? fmt(Math.round(r.avgCostCents)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">
                    {fmt(r.fallbackCents)} <span className="block text-[10px]">{r.fallbackLabel}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <input className={`${input} !py-1.5 text-right tabular-nums`} inputMode="decimal" value={vals[r.variantId] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [r.variantId]: e.target.value }))} placeholder="none" />
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${margin !== null && margin < 0.1 ? 'text-sale' : ''}`}>{margin === null ? '—' : `${Math.round(margin * 100)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <PageButtons page={page} pages={pages} total={shown.length} size={ADMIN_PAGE_SIZE} onPage={setPage} />
    </div>
  )
}
