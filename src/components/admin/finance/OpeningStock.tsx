'use client'

/* Load today's stock and what it cost, once: download the sheet, fill in the
   counted quantity and unit cost, upload it, check, apply. */

import { useRef, useState } from 'react'
import { btn } from '@/components/admin/ui'
import { fmt } from './shared'

type Row = { row: number; sku: string; label: string; quantity: number; unitCostCents: number; problem?: string }

const TEMPLATE = '/api/admin/finance/purchases/opening'

export function OpeningStock() {
  const ref = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(apply: boolean) {
    if (!file) return
    setBusy(true)
    setMsg(null)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/admin/finance/purchases/opening${apply ? '?apply=1' : ''}`, { method: 'POST', body: form })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; rows?: Row[]; applied?: number; skipped?: number }
    setBusy(false)
    if (!res.ok || !data.ok) return setMsg({ ok: false, text: data.message ?? 'That did not work.' })
    if (apply) {
      setMsg({ ok: true, text: `Done: ${data.applied} products set${data.skipped ? `, ${data.skipped} rows skipped` : ''}. Stock and costs are now in place.` })
      setRows(null)
      setFile(null)
    } else setRows(data.rows ?? [])
  }

  const good = rows?.filter((r) => !r.problem) ?? []
  const value = good.reduce((n, r) => n + r.quantity * r.unitCostCents, 0)

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 1</p>
          <p className="mt-2 text-sm">Download the sheet with every product, its stock now and its cost so far.</p>
          <a href={TEMPLATE} className={`${btn.primary} mt-4`}>
            Download the sheet
          </a>
        </li>
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 2</p>
          <p className="mt-2 text-sm">
            Fill in <b>Counted quantity</b> (what is on the shelves) and <b>Unit cost</b> (what one unit cost you, before VAT, with shipping). Leave the SKU column as it is.
          </p>
        </li>
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 3</p>
          <p className="mt-2 text-sm">Upload it, check what will change, then apply.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btn.secondary} onClick={() => ref.current?.click()}>
              {file ? file.name : 'Choose the filled sheet'}
            </button>
            <input
              ref={ref}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setRows(null)
              }}
            />
            <button type="button" className={btn.primary} disabled={!file || busy} onClick={() => void send(false)}>
              Check
            </button>
          </div>
        </li>
      </ol>
      {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}
      {rows && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {good.length} products ready, stock value {fmt(value)}.{rows.length - good.length > 0 && <span className="text-sale"> {rows.length - good.length} rows have a problem and will be skipped.</span>}
            </p>
            <button
              type="button"
              className={btn.primary}
              disabled={busy || good.length === 0}
              onClick={() => window.confirm(`Set the stock and cost of ${good.length} products to what is in the sheet?`) && void send(true)}
            >
              Apply to {good.length} products
            </button>
          </div>
          <div className="mt-4 max-h-[28rem] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-2">Row</th>
                  <th>Product</th>
                  <th className="text-right">Quantity</th>
                  <th className="text-right">Unit cost</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className="border-t border-line">
                    <td className="py-2 text-muted">{r.row}</td>
                    <td>{r.label}</td>
                    <td className="text-right tabular-nums">{r.quantity >= 0 ? r.quantity : '—'}</td>
                    <td className="text-right tabular-nums">{r.unitCostCents >= 0 ? fmt(r.unitCostCents) : '—'}</td>
                    <td className="pl-3 text-xs text-sale">{r.problem}</td>
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
