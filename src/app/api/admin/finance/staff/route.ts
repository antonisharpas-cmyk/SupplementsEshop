/* PUT { userId, financeAccess }: make a staff member a manager, or not.
   The owner (SUPER_ADMIN) only. */
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { requireAdminApi } from '@/lib/admin'
import { readJson } from '@/lib/api'
import { audit } from '@/lib/audit'
import { run } from '../_shared'

export async function PUT(request: Request) {
  const g = await requireAdminApi('SUPER_ADMIN')
  if ('response' in g) return g.response
  const b = await readJson(request, z.object({ userId: z.string().uuid(), financeAccess: z.boolean() }))
  if ('response' in b) return b.response
  return run(async () => {
    await db.update(users).set({ financeAccess: b.data.financeAccess, updatedAt: new Date() }).where(and(eq(users.id, b.data.userId), eq(users.role, 'ADMIN')))
    await audit({ actor: g.user, action: 'staff.finance_access', entity: 'user', entityId: b.data.userId, diff: b.data })
  })
}
