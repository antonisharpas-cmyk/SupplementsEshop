'use client'

import { btn } from '@/components/admin/ui'
import { useApi } from './shared'

export function DeleteExpense({ id, month }: { id: string; month: string }) {
  const { busy, msg, call, router } = useApi()
  return (
    <span className="flex items-center gap-2">
      {msg && <span className="text-xs text-sale">{msg.text}</span>}
      <button
        type="button"
        className={btn.quiet}
        disabled={busy}
        onClick={async () => {
          if (!window.confirm('Delete this expense and its receipt?')) return
          if (await call(`/api/admin/finance/expenses/${id}`, 'DELETE', undefined, { refresh: false })) router.push(`/admin/expenses?month=${month}`)
        }}
      >
        Delete expense
      </button>
    </span>
  )
}
