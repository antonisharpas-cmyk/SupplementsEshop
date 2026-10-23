'use client'

/* Add or change a supplier. The VAT follows the country unless chosen. */

import { useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { useApi } from './shared'

export type SupplierValues = {
  id?: string
  name: string
  kind: string
  country: string
  vatNumber: string | null
  vatTreatment: string
  email: string | null
  phone: string | null
  address: string | null
  note: string | null
  isActive: boolean
}

const EU = ['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']
const suggest = (c: string) => (c === 'CY' ? 'DOMESTIC' : EU.includes(c) ? 'EU_REVERSE' : 'IMPORT')
export const COUNTRIES: [string, string][] = [
  ['CY', 'Cyprus'],
  ['GR', 'Greece'],
  ['PL', 'Poland'],
  ['DE', 'Germany'],
  ['NL', 'Netherlands'],
  ['IT', 'Italy'],
  ['ES', 'Spain'],
  ['FR', 'France'],
  ['BG', 'Bulgaria'],
  ['RO', 'Romania'],
  ['GB', 'United Kingdom'],
  ['US', 'United States'],
  ['AE', 'United Arab Emirates'],
  ['IL', 'Israel'],
  ['TR', 'Turkey'],
]

export function SupplierForm({ initial, onDone }: { initial?: SupplierValues; onDone?: () => void }) {
  const { busy, msg, call } = useApi()
  const [v, setV] = useState<SupplierValues>(
    initial ?? { name: '', kind: 'manufacturer', country: 'CY', vatNumber: '', vatTreatment: 'DOMESTIC', email: '', phone: '', address: '', note: '', isActive: true },
  )
  const set = (patch: Partial<SupplierValues>) => setV((x) => ({ ...x, ...patch }))

  async function save() {
    const ok = await call(initial?.id ? `/api/admin/finance/suppliers/${initial.id}` : '/api/admin/finance/suppliers', initial?.id ? 'PUT' : 'POST', v, { okText: 'Saved.' })
    if (ok) {
      if (!initial) setV({ name: '', kind: 'manufacturer', country: 'CY', vatNumber: '', vatTreatment: 'DOMESTIC', email: '', phone: '', address: '', note: '', isActive: true })
      onDone?.()
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="block text-xs text-muted">
        Name
        <input className={`${input} mt-1`} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Olimp Laboratories" />
      </label>
      <label className="block text-xs text-muted">
        Kind
        <select className={`${input} mt-1`} value={v.kind} onChange={(e) => set({ kind: e.target.value })}>
          <option value="manufacturer">Manufacturer or brand</option>
          <option value="retailer">Retailer or distributor</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block text-xs text-muted">
        Country
        <select className={`${input} mt-1`} value={v.country} onChange={(e) => set({ country: e.target.value, vatTreatment: suggest(e.target.value) })}>
          {COUNTRIES.map(([c, n]) => (
            <option key={c} value={c}>
              {n}
            </option>
          ))}
          {!COUNTRIES.some(([c]) => c === v.country) && <option value={v.country}>{v.country}</option>}
        </select>
      </label>
      <label className="block text-xs text-muted">
        Their invoices
        <select className={`${input} mt-1`} value={v.vatTreatment} onChange={(e) => set({ vatTreatment: e.target.value })}>
          <option value="DOMESTIC">Cyprus VAT</option>
          <option value="EU_REVERSE">EU reverse charge</option>
          <option value="IMPORT">Import (outside the EU)</option>
          <option value="NONE">No VAT</option>
        </select>
      </label>
      <label className="block text-xs text-muted">
        VAT number
        <input className={`${input} mt-1`} value={v.vatNumber ?? ''} onChange={(e) => set({ vatNumber: e.target.value })} placeholder="e.g. PL1234567890" />
      </label>
      <label className="block text-xs text-muted">
        Email
        <input className={`${input} mt-1`} value={v.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Phone
        <input className={`${input} mt-1`} value={v.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
      </label>
      <label className="block text-xs text-muted">
        Address
        <input className={`${input} mt-1`} value={v.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
      </label>
      <label className="block text-xs text-muted sm:col-span-2 lg:col-span-3">
        Note
        <input className={`${input} mt-1`} value={v.note ?? ''} onChange={(e) => set({ note: e.target.value })} placeholder="Account manager, payment terms, anything useful" />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {initial && (
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
            Active
          </label>
        )}
        <button type="button" className={btn.primary} disabled={busy || !v.name.trim()} onClick={() => void save()}>
          {initial ? 'Save' : 'Add supplier'}
        </button>
        {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
