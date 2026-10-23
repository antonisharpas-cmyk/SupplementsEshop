/* POST { name, id?, isActive? }: add or rename a category. */
import { z } from 'zod'
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { saveCategory } from '@/lib/expenses'
import { run } from '../_shared'

const schema = z.object({ name: z.string().trim().min(1).max(80), id: z.string().uuid().optional(), isActive: z.boolean().optional() })

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, schema)
  if ('response' in b) return b.response
  return run(async () => ({ id: await saveCategory(b.data.name, b.data.id, b.data.isActive ?? true) }))
}
