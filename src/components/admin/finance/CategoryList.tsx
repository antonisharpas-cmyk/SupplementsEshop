'use client'

/* Expense categories: add, rename, switch off. */

import { useState } from 'react'
import { btn, input } from '@/components/admin/ui'
import { useApi } from './shared'
import { Paged } from '@/components/admin/Paged'

export function CategoryList({ categories }: { categories: { id: string; name: string; isActive: boolean; count: number }[] }) {
  const { busy, msg, call } = useApi()
  const [name, setName] = useState('')
  const [names, setNames] = useState(Object.fromEntries(categories.map((c) => [c.id, c.name])))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input className={`${input} max-w-xs`} value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Insurance" />
        <button type="button" className={btn.primary} disabled={busy || !name.trim()} onClick={async () => (await call('/api/admin/finance/expense-categories', 'POST', { name })) && setName('')}>
          Add
        </button>
        {msg && <span className={`self-center text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
      </div>
      <Paged as="ul" className="divide-y divide-[var(--color-line)] rounded-2xl border border-line bg-paper">
        {categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <input className={`${input} max-w-xs !py-2`} value={names[c.id]} onChange={(e) => setNames((n) => ({ ...n, [c.id]: e.target.value }))} />
            <span className="text-xs text-muted">{c.count} expenses</span>
            <button type="button" className={btn.secondary} disabled={busy || names[c.id] === c.name} onClick={() => void call('/api/admin/finance/expense-categories', 'POST', { id: c.id, name: names[c.id], isActive: c.isActive })}>
              Rename
            </button>
            <button type="button" className={btn.quiet} disabled={busy} onClick={() => void call('/api/admin/finance/expense-categories', 'POST', { id: c.id, name: c.name, isActive: !c.isActive })}>
              {c.isActive ? 'Switch off' : 'Switch on'}
            </button>
            {!c.isActive && <span className="text-xs text-muted">off: not offered for new expenses</span>}
          </li>
        ))}
      </Paged>
    </div>
  )
}
