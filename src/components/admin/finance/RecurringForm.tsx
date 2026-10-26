'use client'

/* A repeating expense: written by itself every month on its day. */

import { MonthField } from '@/components/admin/DateTimeField'
import { useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { euros, PAY_METHODS, toCents, useApi } from './shared'

export type RecurringInitial = {
  id: string
  categoryId: string
  payee: string
  description: string | null
  vatTreatment: string
  netCents: number
  vatCents: number
  paymentMethod: string | null
  dayOfMonth: number
  startMonth: string
  endMonth: string | null
  isActive: boolean
}

export function RecurringForm({ categories, vatRateBp, initial, month }: { categories: { id: string; name: string }[]; vatRateBp: number; initial?: RecurringInitial; month: string }) {
  const { busy, msg, call } = useApi()
  const [v, setV] = useState({
    categoryId: initial?.categoryId ?? categories[0]?.id ?? '',
    payee: initial?.payee ?? '',
    description: initial?.description ?? '',
    vatTreatment: initial?.vatTreatment ?? 'NONE',
    amount: initial ? euros(initial.netCents + initial.vatCents) : '',
    paymentMethod: initial?.paymentMethod ?? 'bank',
    dayOfMonth: String(initial?.dayOfMonth ?? 1),
    startMonth: initial?.startMonth ?? month,
    endMonth: initial?.endMonth ?? '',
    isActive: initial?.isActive ?? true,
  })
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const total = toCents(v.amount) ?? 0
  const vat = v.vatTreatment === 'DOMESTIC' ? Math.round((total * vatRateBp) / (10_000 + vatRateBp)) : 0

  async function save() {
    const body = {
      categoryId: v.categoryId,
      payee: v.payee,
      description: v.description || null,
      vatTreatment: v.vatTreatment,
      netCents: total - vat,
      vatCents: vat,
      paymentMethod: v.paymentMethod,
      dayOfMonth: Number(v.dayOfMonth) || 1,
      startMonth: v.startMonth,
      endMonth: v.endMonth || null,
      isActive: v.isActive,
    }
    const r = await call<{ written: number }>(initial ? `/api/admin/finance/recurring/${initial.id}` : '/api/admin/finance/recurring', initial ? 'PUT' : 'POST', body)
    if (r && !initial) set({ payee: '', description: '', amount: '' })
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="block text-xs text-muted lg:col-span-2">
        Paid to
        <input className={`${input} mt-1`} value={v.payee} onChange={(e) => set({ payee: e.target.value })} placeholder="e.g. Landlord" />
      </label>
      <label className="block text-xs text-muted">
        Category
        <select className={`${input} mt-1`} value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        VAT
        <select className={`${input} mt-1`} value={v.vatTreatment} onChange={(e) => set({ vatTreatment: e.target.value })}>
          <option value="NONE">No VAT</option>
          <option value="DOMESTIC">Cyprus VAT included</option>
          <option value="EU_REVERSE">EU service, reverse charge</option>
        </select>
      </label>
      <label className="block text-xs text-muted">
        Amount each month €
        <input className={`${input} mt-1`} inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value })} />
      </label>
      <label className="block text-xs text-muted lg:col-span-2">
        What for
        <input className={`${input} mt-1`} value={v.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Shop rent" />
      </label>
      <label className="block text-xs text-muted">
        Day of the month
        <input className={`${input} mt-1`} inputMode="numeric" value={v.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
      </label>
      <label className="block text-xs text-muted">
        From month
        <MonthField value={v.startMonth} onChange={(v) => set({ startMonth: v })} className="mt-1" />
      </label>
      <label className="block text-xs text-muted">
        Until month (optional)
        <MonthField value={v.endMonth} onChange={(v) => set({ endMonth: v })} clearable placeholder="No end" className="mt-1" />
      </label>
      <label className="block text-xs text-muted">
        Paid by
        <select className={`${input} mt-1`} value={v.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}>
          {PAY_METHODS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-end gap-3 lg:col-span-4">
        {initial && (
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active
          </label>
        )}
        <button type="button" className={btn.primary} disabled={busy || !v.payee.trim() || total <= 0} onClick={() => void save()}>
          {initial ? 'Save' : 'Add repeating expense'}
        </button>
        {initial && (
          <button
            type="button"
            className={btn.quiet}
            onClick={() => window.confirm('Stop this repeating expense? Months already written stay.') && void call(`/api/admin/finance/recurring/${initial.id}`, 'DELETE')}
          >
            Delete
          </button>
        )}
        {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
