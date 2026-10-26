'use client'

/* Many products from one sheet: make the sheet from the supplier's invoice
   (or start empty), fill in Category and Selling price, upload, check,
   create. */

import { useRef, useState } from 'react'
import Link from 'next/link'
import { btn, input } from '@/components/admin/ui'
import { fmt } from '@/components/admin/finance/shared'

type Row = {
  row: number
  name: string
  flavour: string
  size: string
  category: string
  priceCents: number | null
  ean: string
  action: 'new product' | 'new flavour' | 'already there'
  saveCode?: boolean
  nameEl?: string
  nameRu?: string
  flavourEl?: string
  flavourRu?: string
  texts?: Record<string, Record<string, string>>
  problem?: string
  note?: string
}
type Result = { products: number; flavours: number; codes: number; translated?: number; skipped: number; failed: { row: number; problem: string }[] }

const TEMPLATE = '/api/admin/products/import'

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ProductImport() {
  const ref = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function fromInvoice() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/products/import/invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        return setMsg({ ok: false, text: data.message ?? 'That did not work.' })
      }
      save(await res.blob(), 'products-from-invoice.xlsx')
      setMsg({ ok: true, text: `Sheet made with ${res.headers.get('X-Lines') ?? 'the'} lines. Check the names, flavours and sizes, and fill in Category and Selling price.` })
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  async function send(apply: boolean) {
    if (!file) return
    setBusy(true)
    setMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/admin/products/import${apply ? '?apply=1' : ''}`, { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; rows?: Row[] } & Partial<Result>
      if (!res.ok || !data.ok) return setMsg({ ok: false, text: data.message ?? 'That did not work.' })
      if (apply) {
        setResult(data as Result)
        setRows(null)
        setFile(null)
      } else {
        setResult(null)
        setRows(data.rows ?? [])
      }
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  const good = rows?.filter((r) => !r.problem) ?? []
  const hasText = (r: Row) => Boolean(r.nameEl || r.nameRu || r.flavourEl || r.flavourRu || r.texts)
  const todo = good.filter((r) => r.action !== 'already there' || r.saveCode || hasText(r))
  const newProducts = new Set(good.filter((r) => r.action === 'new product').map((r) => r.name.toLowerCase())).size
  const newFlavours = good.filter((r) => r.action !== 'already there').length

  return (
    <div className="space-y-6">
      <ol className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 1</p>
          <p className="mt-2 text-sm">
            Copy the lines of the supplier&apos;s invoice (from the PDF) and paste them here. Every line with a barcode becomes a row, with name, size, flavour, EAN, cost and quantity filled in.
          </p>
          <textarea
            className={`${input} mt-3 h-28 font-mono text-xs`}
            placeholder="1 AAKG 7500 25ml Shot S GL grapefr 5901330098765 1.21 EUR 36 PCE"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={busy || !text.trim()} onClick={() => void fromInvoice()}>
              Make the sheet
            </button>
            <a href={TEMPLATE} className={btn.secondary}>
              Or an empty sheet
            </a>
          </div>
        </li>
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 2</p>
          <p className="mt-2 text-sm">Open it in Excel. One row per flavour and size. Check the guessed names, then fill in:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            <li>
              <b>Product name</b>: the same name on every row of one product, so its flavours and sizes join
            </li>
            <li>
              <b>Category</b>: a name from the Categories tab of the sheet
            </li>
            <li>
              <b>Selling price</b>: with VAT, as customers pay it
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted">Greek and Russian names are optional. Products are created hidden with stock 0.</p>
        </li>
        <li className="rounded-2xl border border-line bg-paper p-5">
          <p className="label text-accent">Step 3</p>
          <p className="mt-2 text-sm">Upload it, check what will be created, then create.</p>
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
                setResult(null)
                e.target.value = ''
              }}
            />
            <button type="button" className={btn.primary} disabled={!file || busy} onClick={() => void send(false)}>
              Check
            </button>
          </div>
        </li>
      </ol>

      {msg && <p className={`text-sm ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</p>}

      {result && (
        <section className="rounded-2xl border border-ok/40 bg-ok/10 p-5 text-sm">
          <p className="font-medium text-ok">
            Done: {result.products} new product{result.products === 1 ? '' : 's'}, {result.flavours} flavour{result.flavours === 1 ? '' : 's'} and sizes
            {result.codes ? `, ${result.codes} barcodes saved on flavours you had` : ''}
            {result.translated ? `, names and texts filled in on ${result.translated} products and flavours you had` : ''}.
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-1 text-sale">
              {result.failed.map((f) => (
                <li key={f.row}>
                  Row {f.row}: {f.problem}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2">
            They are hidden for now. Add the photos below, then the stock comes in with the supplier&apos;s purchase (upload the same sheet there). Switch each one to Available in{' '}
            <Link href="/admin/products?status=hidden" className="underline">
              Products
            </Link>
            .
          </p>
        </section>
      )}

      {rows && (
        <section className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {newProducts} new product{newProducts === 1 ? '' : 's'} and {newFlavours} flavour{newFlavours === 1 ? '' : 's'} and sizes ready.
              {good.some((r) => r.action === 'already there' && hasText(r)) && ' Products already in the shop get the Greek and Russian names, and any texts they do not have yet, from the sheet (nothing already written is changed).'}
              {rows.length - good.length > 0 && <span className="text-sale"> {rows.length - good.length === 1 ? '1 row has a problem and will be skipped' : `${rows.length - good.length} rows have a problem and will be skipped`}; fix it in the sheet and check again.</span>}
            </p>
            <button
              type="button"
              className={btn.primary}
              disabled={busy || todo.length === 0}
              onClick={() =>
                window.confirm(
                  newFlavours > 0
                    ? `Create ${newProducts} products and ${newFlavours} flavours and sizes? They start hidden.`
                    : 'Fill in the Greek and Russian names and the missing texts of the products already in the shop?',
                ) && void send(true)
              }
            >
              {busy ? 'Saving…' : newFlavours > 0 ? 'Create them' : 'Update them'}
            </button>
          </div>
          <div className="mt-4 max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="py-2">Row</th>
                  <th>Product</th>
                  <th>Flavour</th>
                  <th>Size</th>
                  <th>Category</th>
                  <th className="text-right">Price</th>
                  <th className="pl-3">EAN</th>
                  <th className="pl-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row} className="border-t border-line align-top">
                    <td className="py-2 text-muted">{r.row}</td>
                    <td>{r.name}</td>
                    <td>{r.flavour}</td>
                    <td className="whitespace-nowrap">{r.size}</td>
                    <td>{r.category}</td>
                    <td className="text-right tabular-nums">{r.priceCents !== null ? fmt(r.priceCents) : ''}</td>
                    <td className="pl-3 font-mono text-xs">{r.ean}</td>
                    <td className="pl-3 text-xs">
                      {r.problem ? (
                        <span className="text-sale">{r.problem}</span>
                      ) : r.action === 'already there' ? (
                        <span className="text-muted">Already there{r.note ? `: ${r.note}` : ''}</span>
                      ) : (
                        <span className="text-ok">{r.action === 'new product' ? 'New product' : 'New flavour'}</span>
                      )}
                    </td>
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
