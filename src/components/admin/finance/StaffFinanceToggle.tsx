'use client'

/* The owner makes a staff member a manager: they then see costs, profit,
   purchases, wholesale, expenses, reports and accounting. */

import { useApi } from './shared'

export function StaffFinanceToggle({ userId, on }: { userId: string; on: boolean }) {
  const { busy, msg, call } = useApi()
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-accent)]"
          checked={on}
          disabled={busy}
          onChange={(e) => void call('/api/admin/finance/staff', 'PUT', { userId, financeAccess: e.target.checked })}
        />
        Manager: can see costs, profit and the finance area
      </label>
      <span className="text-xs text-muted">Without it, staff still sell, receive deliveries and record stock movements, without seeing any cost.</span>
      {msg && <span className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
    </div>
  )
}
