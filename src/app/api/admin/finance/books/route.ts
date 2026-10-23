/* PUT { closedThrough: 'YYYY-MM' | '' }: close months for the accountant, or reopen. */
import { z } from 'zod'
import { requireFinanceApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { setSetting } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { run } from '../_shared'

const schema = z.object({ closedThrough: z.union([z.literal(''), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]) })

export async function PUT(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const b = await readJson(request, schema)
  if ('response' in b) return b.response
  return run(async () => {
    await setSetting('books_closed_through', b.data.closedThrough)
    await audit({ actor: g.user, action: 'books.close', entity: 'settings', entityId: 'books_closed_through', diff: b.data })
  })
}
