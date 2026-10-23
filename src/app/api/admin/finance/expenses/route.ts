/* POST: a new expense. */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { saveExpense } from '@/lib/expenses'
import { run } from '../_shared'
import { expenseSchema } from '../_schemas'

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, expenseSchema)
  if ('response' in b) return b.response
  return run(async () => ({ id: await saveExpense(b.data, g.user.id) }))
}
