'use client'

/* Download every document of a period in one ZIP: shop and retailer
   invoices and credit notes (money in), supplier invoices and receipts
   (money out). Choose the period and what to include. */

import { useState } from 'react'
import { DateTimeField } from '@/components/admin/DateTimeField'
import { btn } from '@/components/admin/ui'

const KINDS = [
  ['online', 'Shop invoices and credit notes', 'in'],
  ['wholesale', 'Retailer invoices and credit notes', 'in'],
  ['purchases', 'Supplier invoices', 'out'],
  ['expenses', 'Expense receipts', 'out'],
  ['stock', 'Photos of stock written off', 'other'],
] as const

export function DocumentsDownload({ from: f0, to: t0, periods }: { from: string; to: string; periods: { label: string; from: string; to: string }[] }) {
  const [from, setFrom] = useState(f0)
  const [to, setTo] = useState(t0)
  const [kinds, setKinds] = useState<string[]>(KINDS.slice(0, 4).map((k) => k[0]))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toggle = (k: string) => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))
  const group = (g: string) => {
    const keys = KINDS.filter((k) => k[2] === g).map((k) => k[0] as string)
    const all = keys.every((k) => kinds.includes(k))
    setKinds((ks) => (all ? ks.filter((k) => !keys.includes(k)) : [...new Set([...ks, ...keys])]))
  }

  async function download() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/finance/documents?from=${from}&to=${to}&kinds=${kinds.join(',')}`)
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        setErr(data.message ?? 'The download did not work.')
        return
      }
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'documents.zip'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setErr('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
      <h2 className="label text-muted">Download documents</h2>
      <p className="mt-1 text-xs text-muted">Every invoice, credit note, supplier invoice and receipt of a period in one ZIP, in folders, with an Excel index of what is inside and what has no file yet.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {periods.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              setFrom(p.from)
              setTo(p.to)
            }}
            className={`rounded-full border px-3.5 py-1.5 text-xs transition-colors ${from === p.from && to === p.to ? 'border-transparent bg-gold text-black' : 'border-line hover:border-line-strong'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[13rem_13rem_1fr_auto] lg:items-end">
        <label className="block text-xs text-muted">
          From
          <DateTimeField mode="date" clearable={false} value={from} onChange={setFrom} className="mt-1" />
        </label>
        <label className="block text-xs text-muted">
          To
          <DateTimeField mode="date" clearable={false} value={to} min={from} onChange={setTo} className="mt-1" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(['in', 'out', 'other'] as const).map((g) => (
            <div key={g}>
              <button type="button" className="label mb-1.5 text-muted hover:text-accent" onClick={() => group(g)}>
                {g === 'in' ? 'Money in' : g === 'out' ? 'Money out' : 'Other'}
              </button>
              {KINDS.filter((k) => k[2] === g).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={kinds.includes(k)} onChange={() => toggle(k)} />
                  {label}
                </label>
              ))}
            </div>
          ))}
        </div>
        <button type="button" className={btn.primary} disabled={busy || kinds.length === 0 || !from || !to} onClick={() => void download()}>
          {busy ? 'Preparing…' : 'Download ZIP'}
        </button>
      </div>
      {err && <p className="mt-3 text-xs text-sale">{err}</p>}
    </section>
  )
}
