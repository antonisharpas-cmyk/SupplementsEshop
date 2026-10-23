'use client'

/* An expense as it is on the receipt: the amount paid with VAT; the VAT is
   worked out and can be corrected. A photo of the receipt goes with it. */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useRef, useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { euros, fmt, PAY_METHODS, toCents, todayIso, uploadFiles, useApi } from './shared'

export type ExpenseInitial = {
  id: string
  expenseDate: string
  categoryId: string
  payee: string
  description: string | null
  reference: string | null
  vatTreatment: string
  netCents: number
  vatCents: number
  paymentMethod: string | null
}

export function ExpenseForm({ categories, vatRateBp, initial, payees = [] }: { categories: { id: string; name: string }[]; vatRateBp: number; initial?: ExpenseInitial; payees?: string[] }) {
  const { busy, msg, setMsg, call, router } = useApi()
  const [date, setDate] = useState(initial?.expenseDate ?? todayIso())
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categories[0]?.id ?? '')
  const [payee, setPayee] = useState(initial?.payee ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [reference, setReference] = useState(initial?.reference ?? '')
  const [treatment, setTreatment] = useState(initial?.vatTreatment ?? 'DOMESTIC')
  const [amount, setAmount] = useState(initial ? euros(initial.netCents + initial.vatCents) : '')
  const [vatTyped, setVatTyped] = useState(initial && initial.vatTreatment === 'DOMESTIC' ? euros(initial.vatCents) : '')
  const [method, setMethod] = useState(initial?.paymentMethod ?? 'card')
  const [receipt, setReceipt] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const total = toCents(amount) ?? 0
  const vatAuto = treatment === 'DOMESTIC' ? Math.round((total * vatRateBp) / (10_000 + vatRateBp)) : 0
  const vat = treatment === 'DOMESTIC' ? (toCents(vatTyped) ?? vatAuto) : 0
  const net = total - vat
  const reverse = treatment === 'EU_REVERSE' ? Math.round((total * vatRateBp) / 10_000) : 0

  async function save() {
    const body = { expenseDate: date, categoryId, payee, description: description || null, reference: reference || null, vatTreatment: treatment, netCents: net, vatCents: vat, paymentMethod: method }
    const data = await call<{ id: string }>(initial ? `/api/admin/finance/expenses/${initial.id}` : '/api/admin/finance/expenses', initial ? 'PUT' : 'POST', body, { refresh: false })
    if (!data) return
    if (receipt && data.id) {
      const e = await uploadFiles('expense', data.id, [receipt])
      if (e) return setMsg({ ok: false, text: `Saved, but the receipt did not upload: ${e}` })
    }
    if (initial) router.refresh()
    else {
      setPayee('')
      setDescription('')
      setReference('')
      setAmount('')
      setVatTyped('')
      setReceipt(null)
      setMsg({ ok: true, text: 'Saved.' })
      router.refresh()
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <label className="block text-xs text-muted">
        Date
        <DateTimeField mode="date" clearable={false} value={date} onChange={(v) => setDate(v)} className="mt-1" />
      </label>
      <label className="block text-xs text-muted">
        Category
        <select className={`${input} mt-1`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted lg:col-span-2">
        Paid to
        <input className={`${input} mt-1`} list="payees" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="e.g. EAC, Meta, BOX NOW" />
        <datalist id="payees">
          {payees.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </label>
      <label className="block text-xs text-muted lg:col-span-2">
        What for
        <input className={`${input} mt-1`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
      </label>
      <label className="block text-xs text-muted">
        VAT
        <select className={`${input} mt-1`} value={treatment} onChange={(e) => setTreatment(e.target.value)}>
          <option value="DOMESTIC">Cyprus VAT on the receipt</option>
          <option value="EU_REVERSE">EU service, no VAT (reverse charge)</option>
          <option value="NONE">No VAT, or cannot be reclaimed</option>
        </select>
      </label>
      <label className="block text-xs text-muted">
        {treatment === 'DOMESTIC' ? 'Total paid, with VAT €' : 'Amount paid €'}
        <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </label>
      {treatment === 'DOMESTIC' && (
        <label className="block text-xs text-muted">
          of which VAT €
          <input className={`${input} mt-1`} inputMode="decimal" value={vatTyped} onChange={(e) => setVatTyped(e.target.value)} placeholder={euros(vatAuto)} />
        </label>
      )}
      <label className="block text-xs text-muted">
        Paid by
        <select className={`${input} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
          {PAY_METHODS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        Receipt number
        <input className={`${input} mt-1`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
      </label>
      {!initial && (
        <label className="block text-xs text-muted">
          Receipt
          <button type="button" className={`${input} mt-1 truncate text-left`} onClick={() => fileRef.current?.click()}>
            {receipt ? receipt.name : 'Photo or PDF'}
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-6">
        <button type="button" className={btn.primary} disabled={busy || !payee.trim() || (total <= 0 && !initial) || !categoryId} onClick={() => void save()}>
          {busy ? 'Saving…' : initial ? 'Save' : 'Add expense'}
        </button>
        <span className="pb-2 text-xs text-muted">
          Cost {fmt(net)}
          {vat > 0 && ` · VAT to reclaim ${fmt(vat)}`}
          {reverse > 0 && ` · reverse charge VAT ${fmt(reverse)} (due and reclaimed)`}
        </span>
        {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
