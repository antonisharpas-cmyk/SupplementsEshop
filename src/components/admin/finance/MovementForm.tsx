'use client'

/* Stock that leaves without a sale (samples, gifts, own use, damaged,
   expired), free goods from a supplier, or a stock count. A photo can go
   with it. */

import { DateTimeField } from '@/components/admin/DateTimeField'
import { useMemo, useRef, useState } from 'react'
import { SearchSelect } from '@/components/admin/SearchSelect'
import { btn, input } from '@/components/admin/ui'
import { todayIso, uploadFiles, useApi } from './shared'

const KINDS = [
  ['SAMPLE', 'Sample', 'Given to try: gyms, events, customers'],
  ['GIFT', 'Gift or sponsorship', 'Athletes, influencers, giveaways'],
  ['OWN_USE', 'Own or staff use', 'Taken for the business or staff'],
  ['DAMAGED', 'Damaged', 'Broken, leaking, unsellable'],
  ['EXPIRED', 'Expired', 'Past its date'],
  ['SUPPLIER_EXTRA', 'Free goods from a supplier', 'Extra units at no cost: lowers the average cost'],
  ['COUNT', 'Stock count', 'Type what is on the shelf; the difference is recorded'],
] as const

export function MovementForm({ variants }: { variants: { variantId: string; label: string; sku: string; onHand: number }[] }) {
  const { busy, msg, setMsg, call } = useApi()
  const [variantId, setVariantId] = useState('')
  const [kind, setKind] = useState<string>('SAMPLE')
  const [qty, setQty] = useState('')
  const [on, setOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const options = useMemo(() => variants.map((v) => ({ value: v.variantId, label: v.label, hint: `${v.sku} · ${v.onHand} in stock` })), [variants])
  const v = variants.find((x) => x.variantId === variantId)
  const isCount = kind === 'COUNT'

  async function save() {
    const data = await call<{ id?: string }>('/api/admin/finance/movements', 'POST', { variantId, kind, quantity: Number(qty) || 0, note: note || null, occurredOn: on }, { refresh: false })
    if (!data) return
    if (photo && data.id) {
      const e = await uploadFiles('movement', data.id, [photo])
      if (e) setMsg({ ok: false, text: `Saved, but the photo did not upload: ${e}` })
    }
    setQty('')
    setNote('')
    setPhoto(null)
    setMsg({ ok: true, text: 'Recorded.' })
    window.location.reload()
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <label className="block text-xs text-muted lg:col-span-2">
        Product
        <SearchSelect className="mt-1" options={options} value={variantId} onChange={setVariantId} placeholder="Choose a product" searchPlaceholder="Name or SKU" />
      </label>
      <label className="block text-xs text-muted">
        What happened
        <select className={`${input} mt-1`} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        {isCount ? 'Counted on the shelf' : 'How many'}
        <input className={`${input} mt-1`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} placeholder={isCount && v ? `system says ${v.onHand}` : ''} />
      </label>
      <label className="block text-xs text-muted">
        Date
        <DateTimeField mode="date" clearable={false} value={on} onChange={(v) => setOn(v)} className="mt-1" />
      </label>
      <label className="block text-xs text-muted">
        Photo (optional)
        <button type="button" className={`${input} mt-1 truncate text-left`} onClick={() => fileRef.current?.click()}>
          {photo ? photo.name : 'Add a photo'}
        </button>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      </label>
      <label className="block text-xs text-muted sm:col-span-2 lg:col-span-4">
        Note
        <input className={`${input} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who it went to, why, batch number" />
      </label>
      <div className="flex items-end gap-3 lg:col-span-2">
        <button type="button" className={btn.primary} disabled={busy || !variantId || qty === ''} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Record'}
        </button>
        {msg && <span className={`pb-2 text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
      <p className="text-xs text-muted sm:col-span-2 lg:col-span-6">{KINDS.find((k) => k[0] === kind)?.[2]}. Every movement is kept with its cost, so the reports show what left the shelves without being sold.</p>
    </div>
  )
}
