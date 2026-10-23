/* POST: a new repeating expense (written for every due month at once). */
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { saveRecurring, writeRecurring } from '@/lib/expenses'
import { run } from '../_shared'
import { recurringSchema } from '../_schemas'

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, recurringSchema)
  if ('response' in b) return b.response
  return run(async () => {
    const id = await saveRecurring(b.data)
    return { id, written: await writeRecurring() }
  })
}
