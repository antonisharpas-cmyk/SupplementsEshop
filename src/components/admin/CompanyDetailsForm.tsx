'use client'

/* The seller details printed on invoices. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { btn, input } from '@/components/admin/ui'

type Values = {
  company_legal_name: string
  company_vat_number: string
  company_tax_id: string
  company_address: string
  invoice_footer: string
}

export function CompanyDetailsForm({ initial }: { initial: Values }) {
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((x) => ({ ...x, [k]: e.target.value }))
    setState('idle')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState('saving')
    setError(null)
    const res = await fetch('/api/admin/accounting/company', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res?.ok || !data?.ok) {
      setError(data?.message ?? 'Could not save. Try again.')
      setState('idle')
      return
    }
    setState('saved')
    router.refresh()
  }

  const field = 'text-sm'
  const lab = 'label mb-1.5 block text-muted'
  return (
    <form onSubmit={save} className="mt-5 grid gap-4 md:grid-cols-2">
      <label className={field}>
        <span className={lab}>Legal company name</span>
        <input value={v.company_legal_name} onChange={set('company_legal_name')} placeholder="AIONIX Trading Ltd" className={input} maxLength={160} />
      </label>
      <label className={field}>
        <span className={lab}>VAT number</span>
        <input value={v.company_vat_number} onChange={set('company_vat_number')} placeholder="CY10000000X" className={input} maxLength={40} />
      </label>
      <label className={field}>
        <span className={lab}>Tax ID (TIC)</span>
        <input value={v.company_tax_id} onChange={set('company_tax_id')} placeholder="Optional" className={input} maxLength={40} />
      </label>
      <label className={`${field} md:row-span-2`}>
        <span className={lab}>Address, one line per row</span>
        <textarea
          value={v.company_address}
          onChange={set('company_address')}
          rows={4}
          placeholder={'Street 1\n6017 Larnaca\nCyprus'}
          className={input}
          maxLength={500}
        />
      </label>
      <label className={field}>
        <span className={lab}>Note at the bottom of invoices</span>
        <input value={v.invoice_footer} onChange={set('invoice_footer')} className={input} maxLength={500} />
      </label>
      <div className="flex items-center gap-4 md:col-span-2">
        <button type="submit" disabled={state === 'saving'} className={btn.primary}>
          {state === 'saving' ? 'Saving' : 'Save details'}
        </button>
        {state === 'saved' && <span className="text-sm text-ok">Saved</span>}
        {error && <span className="text-sm text-sale">{error}</span>}
      </div>
    </form>
  )
}
