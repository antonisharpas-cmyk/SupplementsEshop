'use client'

/* A shop or gym the business sells to: details for the invoice, VAT,
   default discount and payment terms. */

import { useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { useApi } from './shared'
import { COUNTRIES } from './SupplierForm'

export type RetailerValues = {
  id?: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  vatNumber: string | null
  taxId: string | null
  address: string | null
  country: string
  vatTreatment: string
  defaultDiscountPercent: number
  paymentTermsDays: number
  note: string | null
  isActive: boolean
}

const EMPTY: RetailerValues = { name: '', contactName: '', email: '', phone: '', vatNumber: '', taxId: '', address: '', country: 'CY', vatTreatment: 'DOMESTIC', defaultDiscountPercent: 20, paymentTermsDays: 0, note: '', isActive: true }

export function RetailerForm({ initial }: { initial?: RetailerValues }) {
  const { busy, msg, call } = useApi()
  const [v, setV] = useState({ ...(initial ?? EMPTY), discount: String(initial?.defaultDiscountPercent ?? EMPTY.defaultDiscountPercent), terms: String(initial?.paymentTermsDays ?? 0) })
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))

  async function save() {
    const { discount, terms, ...rest } = v
    const body = { ...rest, defaultDiscountPercent: Number(discount.replace(',', '.')) || 0, paymentTermsDays: Number(terms) || 0 }
    const ok = await call(initial?.id ? `/api/admin/finance/retailers/${initial.id}` : '/api/admin/finance/retailers', initial?.id ? 'PUT' : 'POST', body, { okText: 'Saved.' })
    if (ok && !initial) setV({ ...EMPTY, discount: '20', terms: '0' })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block text-xs text-muted">
        Business name (for the invoice)
        <input className={`${input} mt-1`} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Power Gym Ltd" />
      </label>
      <label className="block text-xs text-muted">
        Contact person
        <input className={`${input} mt-1`} value={v.contactName ?? ''} onChange={(e) => set({ contactName: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Email (for invoices and reminders)
        <input className={`${input} mt-1`} type="email" value={v.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Phone
        <input className={`${input} mt-1`} value={v.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        VAT number
        <input className={`${input} mt-1`} value={v.vatNumber ?? ''} onChange={(e) => set({ vatNumber: e.target.value })} placeholder="CY10000000X" />
      </label>
      <label className="block text-xs text-muted">
        Tax ID (TIC)
        <input className={`${input} mt-1`} value={v.taxId ?? ''} onChange={(e) => set({ taxId: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Country
        <select className={`${input} mt-1`} value={v.country} onChange={(e) => set({ country: e.target.value, vatTreatment: e.target.value === 'CY' ? 'DOMESTIC' : v.vatTreatment })}>
          {COUNTRIES.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        VAT on our invoices
        <select className={`${input} mt-1`} value={v.vatTreatment} onChange={(e) => set({ vatTreatment: e.target.value })}>
          <option value="DOMESTIC">Cyprus VAT</option>
          <option value="EU_ZERO">0%, EU business (reverse charge)</option>
        </select>
      </label>
      <label className="block text-xs text-muted sm:col-span-2">
        Address (one line per row on the invoice)
        <textarea className={`${input} mt-1 h-20`} value={v.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Default discount off the website price (before VAT) %
        <input className={`${input} mt-1`} inputMode="decimal" value={v.discount} onChange={(e) => set({ discount: e.target.value })} />
        <span className="mt-1 block">Used for every product without a fixed wholesale price.</span>
      </label>
      <label className="block text-xs text-muted">
        Payment terms
        <select className={`${input} mt-1`} value={v.terms} onChange={(e) => set({ terms: e.target.value })}>
          <option value="0">Pays upfront</option>
          <option value="7">7 days</option>
          <option value="15">15 days</option>
          <option value="30">30 days</option>
          <option value="45">45 days</option>
          <option value="60">60 days</option>
          {!['0', '7', '15', '30', '45', '60'].includes(v.terms) && <option value={v.terms}>{v.terms} days</option>}
        </select>
      </label>
      <label className="block text-xs text-muted sm:col-span-2 lg:col-span-3">
        Note
        <input className={`${input} mt-1`} value={v.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {initial && (
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active
          </label>
        )}
        <button type="button" className={btn.primary} disabled={busy || !v.name.trim()} onClick={() => void save()}>
          {initial ? 'Save' : 'Add retailer'}
        </button>
        {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
