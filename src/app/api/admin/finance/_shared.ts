/* Finance routes: one way to turn a refused action into a sentence. */

import { FinanceError } from '@/lib/finance'
import { StockError } from '@/lib/stock'
import { fail, json } from '@/lib/api'

export async function run(fn: () => Promise<unknown>) {
  try {
    const out = await fn()
    return json({ ok: true, ...(out && typeof out === 'object' ? out : {}) })
  } catch (err) {
    if (err instanceof FinanceError || err instanceof StockError) return fail(422, 'REFUSED', err.message)
    console.error('[api/admin/finance] failed', err)
    return fail(500, 'FAILED', 'That did not work. Please try again.')
  }
}

export const cents = (euros: number) => Math.round(euros * 100)
